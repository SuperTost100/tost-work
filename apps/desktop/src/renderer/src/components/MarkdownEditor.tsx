import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import {
  commonmark,
  liftListItemCommand,
  toggleEmphasisCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { liftListItem } from "@milkdown/kit/prose/schema-list";
import { type EditorState, Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose, callCommand, replaceAll } from "@milkdown/kit/utils";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";

/** Puts a new text in the editor without it counting as the user's edit. */
function replaceQuietly(made: Editor, text: string, replacing: { current: boolean }): void {
  replacing.current = true;
  try {
    made.action(replaceAll(text));
  } finally {
    replacing.current = false;
  }
}

type ListKind = "bullet_list" | "ordered_list";

/** The list the caret is in, the nearest one when lists are nested. */
function listAt(state: EditorState): { kind: ListKind; depth: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "bullet_list" || name === "ordered_list") return { kind: name, depth: d };
  }
  return null;
}

/** Turns the list the caret is in into the other kind, bullets to numbers or back, keeping its items. */
export function switchList(view: EditorView): boolean {
  const at = listAt(view.state);
  if (!at) return false;
  const { $from } = view.state.selection;
  const pos = $from.before(at.depth);
  const list = $from.node(at.depth);
  const ordered = at.kind === "bullet_list";
  const type = view.state.schema.nodes[ordered ? "ordered_list" : "bullet_list"];
  if (!type) return false;
  const tr = view.state.tr.setNodeMarkup(
    pos,
    type,
    ordered ? { ...list.attrs, order: 1 } : { spread: list.attrs.spread },
  );
  // Each item says which kind of list it's in, and its number; the editor renumbers ordered ones.
  list.forEach((item, offset, i) => {
    tr.setNodeMarkup(pos + 1 + offset, undefined, {
      ...item.attrs,
      listType: ordered ? "ordered" : "bullet",
      label: ordered ? `${i + 1}.` : "•",
    });
  });
  view.dispatch(tr);
  return true;
}

/**
 * Backspace at the very start of a list item takes it out of the list, as in Word or Notes, instead of joining it to
 * the item above.
 */
export function backspaceOutOfList(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== "Backspace" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
  const { empty, $from } = view.state.selection;
  const item = view.state.schema.nodes.list_item;
  if (!empty || !item || $from.parentOffset > 0 || $from.depth < 2) return false;
  if ($from.node(-1).type !== item || $from.index(-1) > 0) return false;
  return liftListItem(item)(view.state, view.dispatch);
}

/** The bubble's height and its gap: with less than this above the selection, it goes under it. */
const BUBBLE_ROOM = 48;

/** Where the bubble sits over the selected text, and what the selection already is. */
interface Bubble {
  left: number;
  top: number;
  /** Under the selection, when there's no room above it inside the box. */
  below: boolean;
  heading: boolean;
  strong: boolean;
  emphasis: boolean;
  list: ListKind | null;
}

function bubbleFor(view: EditorView, box: HTMLElement): Bubble | null {
  const { state } = view;
  const { from, to, empty, $from } = state.selection;
  // Focus on the bubble's own buttons, from the keyboard, still counts as being in the text.
  const focused = view.hasFocus() || Boolean(box.querySelector(".md-bubble")?.contains(document.activeElement));
  if (empty || !focused || !state.doc.textBetween(from, to).trim()) return null;
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  const frame = box.getBoundingClientRect();
  // Over the middle of the selection when it's on one line, over its start when it runs onto more.
  const middle = start.top === end.top ? (start.left + end.right) / 2 : start.left;
  const { strong, emphasis } = state.schema.marks;
  const below = start.top - frame.top < BUBBLE_ROOM;
  return {
    left: Math.min(Math.max(middle - frame.left, 70), Math.max(frame.width - 70, 70)),
    top: below ? end.bottom - frame.top : start.top - frame.top,
    below,
    heading: $from.parent.type.name === "heading",
    strong: Boolean(strong && state.doc.rangeHasMark(from, to, strong)),
    emphasis: Boolean(emphasis && state.doc.rangeHasMark(from, to, emphasis)),
    list: listAt(state)?.kind ?? null,
  };
}

/**
 * Markdown edited the way it looks, like in Word: headings, bold and lists show formatted and the Markdown marks stay
 * out of sight. The text going in and out is Markdown, so the file on disk stays a plain SKILL.md. Editing tidies the
 * file's spelling of the same formatting, such as `*` for bullets becoming `-`, without changing what it says.
 */
export function MarkdownEditor({
  id,
  value,
  onChange,
  readOnly = false,
  label,
  placeholder,
  editorRef,
}: {
  id?: string;
  value: string;
  onChange: (markdown: string) => void;
  readOnly?: boolean;
  label: string;
  placeholder?: string;
  /** The editor, once it's made: for the toolbar and for tests. */
  editorRef?: RefObject<Editor | null>;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  // The Markdown the editor holds, so a value the editor itself sent isn't put back, which would move the caret.
  const last = useRef(value);
  const latest = useRef({ onChange, readOnly, label, id, editorRef, value });
  latest.current = { onChange, readOnly, label, id, editorRef, value };
  // Set while the editor puts in a new value itself: its own tidying of that text, such as "*" bullets becoming "-",
  // isn't an edit, so the draft keeps the text as it came.
  const replacing = useRef(false);
  const [empty, setEmpty] = useState(value.trim() === "");
  const body = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<Bubble | null>(null);

  // Made once: changes to the value and to read-only reach it through the effects below.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { id, editorRef } = latest.current;
    let alive = true;
    // Every change as it happens, not Milkdown's listener, which waits 200 ms: a Save straight after typing has it all.
    const changes = $prose(
      (ctx) =>
        new Plugin({
          view: () => ({
            update: (view, prev) => {
              const doc = view.state.doc;
              if (doc.eq(prev.doc) || replacing.current) return;
              setEmpty(doc.textContent.trim() === "" && doc.childCount <= 1);
              // The file keeps its own ending: the editor's closing newline isn't a change.
              const markdown = ctx.get(serializerCtx)(doc).replace(/\n+$/, "");
              if (markdown === last.current) return;
              last.current = markdown;
              latest.current.onChange(markdown);
            },
          }),
        }),
    );
    // The formatting bubble follows the selection, and goes when the text loses focus.
    const bubbles = $prose(
      () =>
        new Plugin({
          view: () => ({
            update: (view) => {
              const box = body.current;
              setBubble(box && !latest.current.readOnly ? bubbleFor(view, box) : null);
            },
          }),
          props: {
            handleDOMEvents: {
              // Focus moving onto the bubble's own buttons, as Shift+Tab does, keeps it.
              blur: (_view, event) => {
                const to = (event as FocusEvent).relatedTarget;
                if (!(to instanceof Node && body.current?.querySelector(".md-bubble")?.contains(to))) setBubble(null);
                return false;
              },
            },
          },
        }),
    );
    const made = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, el);
        ctx.set(defaultValueCtx, last.current);
        // "-" for bullets and rules, as people and agents usually write them.
        ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, bullet: "-" as const, rule: "-" as const }));
        ctx.update(editorViewOptionsCtx, (o) => ({
          ...o,
          editable: () => !latest.current.readOnly,
          // The view's own handler comes before the presets' keymaps, which would join the item to the one above.
          handleKeyDown: backspaceOutOfList,
          attributes: {
            role: "textbox",
            "aria-multiline": "true",
            "aria-label": latest.current.label,
            ...(id ? { id } : {}),
          },
        }));
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(changes)
      .use(bubbles);
    made.create().then(
      () => {
        if (!alive) return void made.destroy();
        editor.current = made;
        if (editorRef) editorRef.current = made;
        // A value that changed while the editor was starting, such as a restore, goes in now.
        const now = latest.current.value;
        if (now !== last.current) {
          last.current = now;
          setEmpty(now.trim() === "");
          replaceQuietly(made, now, replacing);
        }
      },
      // A failed start leaves an empty box; Save stays off, as nothing changed, so the file is safe.
      () => alive && setEmpty(true),
    );
    return () => {
      alive = false;
      editor.current = null;
      if (editorRef) editorRef.current = null;
      void made.destroy();
    };
  }, []);

  // A different skill, or a restored version: the editor shows the new text. Before the editor has started, the
  // value waits for it: see above.
  useEffect(() => {
    const made = editor.current;
    if (!made || value === last.current) return;
    last.current = value;
    setEmpty(value.trim() === "");
    replaceQuietly(made, value, replacing);
  }, [value]);

  useEffect(() => {
    editor.current?.action((ctx) => ctx.get(editorViewCtx).setProps({ editable: () => !readOnly }));
  }, [readOnly]);

  const run = (command: Parameters<typeof callCommand>[0], payload?: unknown) => () => {
    editor.current?.action(callCommand(command, payload));
    editor.current?.action((ctx) => ctx.get(editorViewCtx).focus());
  };
  const inside = (name: string) =>
    editor.current?.action((ctx) => {
      const { $from } = ctx.get(editorViewCtx).state.selection;
      for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === name) return true;
      return false;
    }) ?? false;
  // A heading goes back to text. A list item becomes a heading of its own, out of the list.
  const heading = () => {
    if (inside("heading")) return run(turnIntoTextCommand.key)();
    for (let i = 0; i < 8 && inside("list_item"); i++) editor.current?.action(callCommand(liftListItemCommand.key));
    run(wrapInHeadingCommand.key, 2)();
  };
  const otherList = () => {
    editor.current?.action((ctx) => switchList(ctx.get(editorViewCtx)));
    editor.current?.action((ctx) => ctx.get(editorViewCtx).focus());
  };

  type Tool = [icon: string, name: string, act: () => void, on: boolean];
  const switchTool: Tool | null =
    bubble?.list === "bullet_list"
      ? ["list-ordered", t("editor.toNumbers"), otherList, false]
      : bubble?.list === "ordered_list"
        ? ["list-check", t("editor.toBullets"), otherList, false]
        : null;
  const tools: Tool[] = bubble
    ? [
        ["heading-2", t("editor.heading"), heading, bubble.heading],
        ["bold", t("editor.bold"), run(toggleStrongCommand.key), bubble.strong],
        ["italic", t("editor.italic"), run(toggleEmphasisCommand.key), bubble.emphasis],
        ...(switchTool ? [switchTool] : []),
      ]
    : [];

  return (
    <div className={readOnly ? "md-editor readonly" : "md-editor"}>
      <div className="md-body" ref={body}>
        {bubble && (
          <div
            className={bubble.below ? "md-bubble below" : "md-bubble"}
            role="toolbar"
            // Leaving the bubble for anywhere but the text closes it, as leaving the text does.
            onBlur={(e) => {
              const to = e.relatedTarget;
              if (!(to instanceof Node && (e.currentTarget.contains(to) || root.current?.contains(to))))
                setBubble(null);
            }}
            aria-label={t("editor.tools")}
            style={{ left: bubble.left, top: bubble.top }}
          >
            {tools.map(([icon, name, act, on]) => (
              <button
                key={icon}
                type="button"
                title={name}
                aria-label={name}
                aria-pressed={on}
                // Keeps the selection in the text, so the button applies to it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={act}
              >
                <Icon name={icon} />
              </button>
            ))}
          </div>
        )}
        {empty && placeholder && !readOnly && (
          <span className="md-placeholder" aria-hidden="true">
            {placeholder}
          </span>
        )}
        <div ref={root} />
      </div>
    </div>
  );
}
