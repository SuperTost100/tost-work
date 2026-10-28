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
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Plugin } from "@milkdown/kit/prose/state";
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
    const made = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, el);
        ctx.set(defaultValueCtx, last.current);
        // "-" for bullets and rules, as people and agents usually write them.
        ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, bullet: "-" as const, rule: "-" as const }));
        ctx.update(editorViewOptionsCtx, (o) => ({
          ...o,
          editable: () => !latest.current.readOnly,
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
      .use(changes);
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
  const heading = () => (inside("heading") ? run(turnIntoTextCommand.key) : run(wrapInHeadingCommand.key, 2))();
  const list = (kind: "bullet_list" | "ordered_list") => () =>
    (inside(kind)
      ? run(liftListItemCommand.key)
      : run(kind === "bullet_list" ? wrapInBulletListCommand.key : wrapInOrderedListCommand.key))();

  const tools: [string, string, () => void][] = [
    ["heading-2", t("editor.heading"), heading],
    ["bold", t("editor.bold"), run(toggleStrongCommand.key)],
    ["italic", t("editor.italic"), run(toggleEmphasisCommand.key)],
    ["list-check", t("editor.bullets"), list("bullet_list")],
    ["list-ordered", t("editor.numbers"), list("ordered_list")],
  ];

  return (
    <div className={readOnly ? "md-editor readonly" : "md-editor"}>
      {!readOnly && (
        <div className="md-tools" role="toolbar" aria-label={t("editor.tools")}>
          {tools.map(([icon, name, act]) => (
            <button
              key={icon}
              type="button"
              className="iconbtn"
              title={name}
              aria-label={name}
              // Keeps the selection in the text, so the button applies to it.
              onMouseDown={(e) => e.preventDefault()}
              onClick={act}
            >
              <Icon name={icon} />
            </button>
          ))}
        </div>
      )}
      <div className="md-body">
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
