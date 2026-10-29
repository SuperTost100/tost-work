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
import { commonmark, toggleEmphasisCommand, toggleStrongCommand } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { setBlockType } from "@milkdown/kit/prose/commands";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import { liftListItem, wrapInList } from "@milkdown/kit/prose/schema-list";
import { type Command, type EditorState, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose, callCommand, replaceAll } from "@milkdown/kit/utils";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import type { MessageKey } from "../../../shared/i18n";

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

/** What a line can become from the slash menu. */
type Block = "paragraph" | "heading" | ListKind;

/** The slash menu's choices, in the order it shows them. */
const BLOCKS: { block: Block; icon: string; label: MessageKey }[] = [
  { block: "paragraph", icon: "font-size", label: "editor.text" },
  { block: "heading", icon: "heading-2", label: "editor.heading" },
  { block: "bullet_list", icon: "list-check", label: "editor.bullets" },
  { block: "ordered_list", icon: "list-ordered", label: "editor.numbers" },
];

/** Lower case and without accents, so "citta" finds "Città". */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Whether what's typed after "/" starts one of the label's words, as "num" does in "Numbered list". */
export function matches(label: string, query: string): boolean {
  return ` ${fold(label)}`.includes(` ${fold(query)}`);
}

/** The open slash menu: where its "/" is, what's typed after it, and the choice it has highlighted. */
interface Slash {
  from: number;
  query: string;
  active: number;
}

const slashKey = new PluginKey<Slash | null>("slash");

/** Lines the slash menu and its hint work on: text at the top level or in a list, not in a table or code. */
function plainLine($pos: ResolvedPos): boolean {
  if ($pos.depth < 1 || $pos.parent.type.spec.code || !$pos.parent.isTextblock) return false;
  const holder = $pos.node($pos.depth - 1).type.name;
  return holder === "doc" || holder === "list_item";
}

/** "/" typed at the start of a line or after a space opens the slash menu. */
function openSlash(view: EditorView, from: number, to: number, text: string): boolean {
  const $from = view.state.doc.resolve(from);
  if (text !== "/" || !plainLine($from)) return false;
  const before = $from.parent.textBetween(0, $from.parentOffset);
  if (before !== "" && !/\s$/.test(before)) return false;
  view.dispatch(view.state.tr.insertText("/", from, to).setMeta(slashKey, { from, query: "", active: 0 }));
  return true;
}

/** What's typed after the menu's "/", or null once the caret has left it, the "/" is gone or a space follows it. */
function queryAt(state: EditorState, from: number): string | null {
  const { empty, head, $head } = state.selection;
  if (!empty || from < $head.start() || head <= from) return null;
  const typed = state.doc.textBetween(from, head);
  return typed.startsWith("/") && !typed.startsWith("/ ") ? typed.slice(1) : null;
}

/** Turns the caret's line into text, a heading or a list, taking out the slash menu's "/…" first. */
export function turnInto(view: EditorView, block: Block): void {
  const open = slashKey.getState(view.state);
  if (open) view.dispatch(view.state.tr.delete(open.from, view.state.selection.head).setMeta(slashKey, null));
  const { nodes } = view.state.schema;
  const run = (command: Command) => command(view.state, view.dispatch);
  const list = listAt(view.state);
  if (block === "bullet_list" || block === "ordered_list") {
    if (list) {
      if (list.kind !== block) switchList(view);
      return;
    }
    const type = nodes[block];
    const paragraph = nodes.paragraph;
    if (!type || !paragraph) return;
    if (view.state.selection.$from.parent.type !== paragraph) run(setBlockType(paragraph));
    run(wrapInList(type, block === "ordered_list" ? { order: 1 } : null));
    return;
  }
  const type = nodes[block];
  const item = nodes.list_item;
  if (!type || !item) return;
  // Text and headings stand on their own: out of the list, nested ones too.
  for (let i = 0; i < 8 && listAt(view.state); i++) if (!run(liftListItem(item))) break;
  run(setBlockType(type, block === "heading" ? { level: 2 } : null));
}

/** Only one paragraph, with nothing in it: what shows the placeholder. A list with an empty item isn't empty. */
function blank(doc: ProseNode): boolean {
  const only = doc.childCount === 1 ? doc.firstChild : null;
  return only?.type.name === "paragraph" && only.content.size === 0;
}

/** The bubble's height and its gap: with less than this above the selection, it goes under it. */
const BUBBLE_ROOM = 48;

/** Where the bubble sits over the selected text, and what the selection already is. */
interface Bubble {
  left: number;
  top: number;
  /** Under the selection, when there's no room above it inside the box. */
  below: boolean;
  strong: boolean;
  emphasis: boolean;
}

function bubbleFor(view: EditorView, box: HTMLElement): Bubble | null {
  const { state } = view;
  const { from, to, empty } = state.selection;
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
    strong: Boolean(strong && state.doc.rangeHasMark(from, to, strong)),
    emphasis: Boolean(emphasis && state.doc.rangeHasMark(from, to, emphasis)),
  };
}

/** The slash menu's width and the height of one choice, as app.css draws them, plus its padding and gap. */
const MENU_WIDTH = 220;
const MENU_ITEM = 32;
const MENU_EDGES = 16;

/** Where the slash menu sits, and what it offers. */
interface SlashMenu {
  left: number;
  top: number;
  /** Over the line, when there's no room for it below inside the window or the panel that scrolls. */
  above: boolean;
  blocks: typeof BLOCKS;
  active: number;
}

/** The lowest point the slash menu can reach without being cut off: the window's edge, or the scrolling panel's. */
function roomBottom(el: HTMLElement): number {
  for (let up = el.parentElement; up; up = up.parentElement) {
    const { overflowY } = getComputedStyle(up);
    if (overflowY === "auto" || overflowY === "scroll")
      return Math.min(up.getBoundingClientRect().bottom, window.innerHeight);
  }
  return window.innerHeight;
}

function slashFor(view: EditorView, box: HTMLElement, shown: (query: string) => typeof BLOCKS): SlashMenu | null {
  const open = slashKey.getState(view.state);
  if (!open) return null;
  const blocks = shown(open.query);
  const at = view.coordsAtPos(open.from);
  const frame = box.getBoundingClientRect();
  const height = blocks.length * MENU_ITEM + MENU_EDGES;
  const above = at.bottom + height > roomBottom(box) && at.top - height > 0;
  return {
    left: Math.max(0, Math.min(at.left - frame.left, frame.width - MENU_WIDTH)),
    top: above ? at.top - frame.top : at.bottom - frame.top,
    above,
    blocks,
    active: open.active,
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
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  // The Markdown the editor holds, so a value the editor itself sent isn't put back, which would move the caret.
  const last = useRef(value);
  const latest = useRef({ onChange, readOnly, label, id, editorRef, value, t, menuId });
  latest.current = { onChange, readOnly, label, id, editorRef, value, t, menuId };
  // Set while the editor puts in a new value itself: its own tidying of that text, such as "*" bullets becoming "-",
  // isn't an edit, so the draft keeps the text as it came.
  const replacing = useRef(false);
  const [empty, setEmpty] = useState(value.trim() === "");
  const body = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [slash, setSlash] = useState<SlashMenu | null>(null);

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
              if (doc.eq(prev.doc)) return;
              setEmpty(blank(doc));
              if (replacing.current) return;
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
    const shown = (query: string) => BLOCKS.filter((b) => matches(latest.current.t(b.label), query));
    // Headings and lists come from typing "/": a menu under the caret, filtered by what follows the "/".
    const slashes = $prose(
      () =>
        new Plugin<Slash | null>({
          key: slashKey,
          state: {
            init: () => null,
            apply: (tr, prev, _old, state) => {
              const meta = tr.getMeta(slashKey) as Slash | null | undefined;
              if (meta !== undefined) return meta;
              if (!prev || (!tr.docChanged && !tr.selectionSet)) return prev;
              const from = tr.mapping.map(prev.from);
              const query = queryAt(state, from);
              // Typing something no choice starts with closes the menu, and the text stays as typed.
              if (query === null || shown(query).length === 0) return null;
              return { from, query, active: query === prev.query ? prev.active : 0 };
            },
          },
          view: () => ({
            update: (view) => {
              const box = body.current;
              setSlash(box && !latest.current.readOnly ? slashFor(view, box, shown) : null);
            },
          }),
          props: {
            handleTextInput: (view, from, to, text) => !latest.current.readOnly && openSlash(view, from, to, text),
            handleDOMEvents: {
              blur: (view) => {
                if (slashKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(slashKey, null));
                return false;
              },
            },
            // Focus stays in the text, so the highlighted choice is announced from there.
            attributes: (state): Record<string, string> => {
              const open = slashKey.getState(state);
              const block = open && shown(open.query)[open.active]?.block;
              const menu = latest.current.menuId;
              return block ? { "aria-controls": menu, "aria-activedescendant": `${menu}-${block}` } : {};
            },
            // A hint on the empty line being written; an empty text shows the placeholder instead.
            decorations: (state) => {
              const { empty, $from } = state.selection;
              const line = $from.parent;
              if (latest.current.readOnly || !empty || line.type.name !== "paragraph" || line.content.size > 0)
                return null;
              if (!plainLine($from) || blank(state.doc)) return null;
              return DecorationSet.create(state.doc, [
                Decoration.node($from.before(), $from.after(), {
                  class: "md-hint",
                  "data-hint": latest.current.t("editor.slashHint"),
                }),
              ]);
            },
          },
        }),
    );
    // Up and Down move through the slash menu, Enter picks, Escape closes it and leaves the text as typed.
    const slashKeys = (view: EditorView, event: KeyboardEvent): boolean => {
      const open = slashKey.getState(view.state);
      if (!open || event.isComposing) return false;
      const blocks = shown(open.query);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : blocks.length - 1;
        view.dispatch(view.state.tr.setMeta(slashKey, { ...open, active: (open.active + step) % blocks.length }));
        return true;
      }
      const chosen = blocks[open.active];
      if (event.key === "Enter" && chosen) {
        turnInto(view, chosen.block);
        return true;
      }
      if (event.key === "Escape") {
        // Only the menu closes, not a dialog the editor is in.
        event.stopPropagation();
        view.dispatch(view.state.tr.setMeta(slashKey, null));
        return true;
      }
      return false;
    };
    const made = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, el);
        ctx.set(defaultValueCtx, last.current);
        // "-" for bullets and rules, as people and agents usually write them.
        ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, bullet: "-" as const, rule: "-" as const }));
        ctx.update(editorViewOptionsCtx, (o) => ({
          ...o,
          editable: () => !latest.current.readOnly,
          // The view's own handler comes before the presets' keymaps, which would split the line on Enter or join the
          // item to the one above on Backspace.
          handleKeyDown: (view, event) => slashKeys(view, event) || backspaceOutOfList(view, event),
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
      .use(bubbles)
      .use(slashes);
    made.create().then(
      () => {
        if (!alive) return void made.destroy();
        editor.current = made;
        if (editorRef) editorRef.current = made;
        // A value that changed while the editor was starting, such as a restore, goes in now.
        const now = latest.current.value;
        if (now !== last.current) {
          last.current = now;
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
    replaceQuietly(made, value, replacing);
  }, [value]);

  useEffect(() => {
    editor.current?.action((ctx) => ctx.get(editorViewCtx).setProps({ editable: () => !readOnly }));
  }, [readOnly]);

  const run = (command: Parameters<typeof callCommand>[0]) => () => {
    editor.current?.action(callCommand(command));
    editor.current?.action((ctx) => ctx.get(editorViewCtx).focus());
  };
  const pick = (block: Block) =>
    editor.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      turnInto(view, block);
      view.focus();
    });

  const tools: [icon: string, name: string, act: () => void, on: boolean][] = bubble
    ? [
        ["bold", t("editor.bold"), run(toggleStrongCommand.key), bubble.strong],
        ["italic", t("editor.italic"), run(toggleEmphasisCommand.key), bubble.emphasis],
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
        {slash && (
          <div
            id={menuId}
            className={slash.above ? "menu md-slash above" : "menu md-slash"}
            role="listbox"
            aria-label={t("editor.turnInto")}
            style={{ left: slash.left, top: slash.top }}
          >
            {slash.blocks.map(({ block, icon, label }, i) => (
              <div
                key={block}
                id={`${menuId}-${block}`}
                className="menu-item"
                role="option"
                aria-selected={i === slash.active}
                data-highlighted={i === slash.active ? "" : undefined}
                // Out of the Tab order: the keys work the menu from the text, through aria-activedescendant.
                tabIndex={-1}
                // Picked on press, which keeps the caret in the text instead of moving focus to the menu.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(block);
                }}
              >
                <Icon name={icon} />
                {t(label)}
              </div>
            ))}
          </div>
        )}
        {empty && !readOnly && (
          <span className="md-placeholder" aria-hidden="true">
            {placeholder}
            <span className="md-placeholder-hint">{t("editor.slashHint")}</span>
          </span>
        )}
        <div ref={root} />
      </div>
    </div>
  );
}
