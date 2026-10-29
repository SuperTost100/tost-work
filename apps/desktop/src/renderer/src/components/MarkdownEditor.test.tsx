import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { LanguageContext } from "@/lib/useT";
import { MarkdownEditor, matches } from "./MarkdownEditor";

const SKILL =
  "## Steps\n\n1. Read the **brief**.\n2. Price each item:\n   - labour\n   - materials\n\n| Item | Price |\n| --- | --- |\n| Visit | 90 € |";

const started = async (name: string) => {
  const box = await screen.findByRole("textbox", { name });
  await waitFor(() => expect(box.getAttribute("contenteditable")).not.toBeNull());
  return box;
};

/** Selects the words of the text, as a drag over them does, with the text focused. */
const select = (editor: Editor | null, words: string) =>
  act(async () => {
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
      let from = -1;
      view.state.doc.descendants((node, pos) => {
        const at = node.isText ? (node.text ?? "").indexOf(words) : -1;
        if (from < 0 && at >= 0) from = pos + at;
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + words.length)));
    });
  });

/** Puts the caret just before the words. */
const caretAt = (editor: Editor | null, words: string) =>
  act(async () => {
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        const i = node.isText ? (node.text ?? "").indexOf(words) : -1;
        if (at < 0 && i >= 0) at = pos + i;
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    });
  });

/** Types the text a key at a time, through the editor's own input handling first, as the keyboard does. */
const type = (editor: Editor | null, text: string) =>
  act(async () => {
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
      for (const key of text) {
        const { from, to } = view.state.selection;
        const typed = () => view.state.tr.insertText(key, from, to);
        if (!view.someProp("handleTextInput", (f) => f(view, from, to, key, typed))) view.dispatch(typed());
      }
    });
  });

const press = (box: HTMLElement, key: string) =>
  act(async () => {
    fireEvent.keyDown(box, { key });
  });

const options = () => screen.queryAllByRole("option").map((o) => o.textContent);

const paste = (box: HTMLElement, text: string) =>
  act(async () => {
    fireEvent.paste(box, {
      clipboardData: { types: ["text/plain"], getData: (t: string) => (t === "text/plain" ? text : "") },
    });
  });

describe("MarkdownEditor", () => {
  // jsdom lays nothing out, and the editor measures the selection to scroll it into view after a toolbar button.
  beforeAll(() => {
    const none = () =>
      ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
    const rect = () => new DOMRect();
    Object.assign(Range.prototype, { getClientRects: none, getBoundingClientRect: rect });
    Object.assign(Element.prototype, { getClientRects: none });
  });

  it("shows Markdown formatted, without its marks", async () => {
    render(<MarkdownEditor value={SKILL} label="Steps" onChange={() => {}} />);
    const box = await started("Steps");
    expect(box.querySelector("h2")?.textContent).toBe("Steps");
    expect(box.querySelector("ol strong")?.textContent).toBe("brief");
    expect(box.querySelectorAll("ol ul li")).toHaveLength(2);
    expect(box.querySelector("td")?.textContent).toBe("Visit");
    expect(box.textContent).not.toContain("**");
  });

  it("gives the edited text back as Markdown, with bullets as dashes", async () => {
    const seen: string[] = [];
    render(<MarkdownEditor value={"* one\n* two"} label="Steps" onChange={(m) => seen.push(m)} />);
    await paste(await started("Steps"), "Hello ");
    expect(seen.at(-1)).toBe("- Hello one\n- two");
  });

  it("stays read-only for a guide, and shows another text when the value changes", async () => {
    const { rerender } = render(<MarkdownEditor value="# Word" label="Guide" readOnly onChange={() => {}} />);
    const box = await started("Guide");
    expect(box.getAttribute("contenteditable")).toBe("false");
    expect(screen.queryByRole("toolbar")).toBeNull();
    rerender(<MarkdownEditor value="# Excel" label="Guide" readOnly onChange={() => {}} />);
    await waitFor(() => expect(box.querySelector("h1")?.textContent).toBe("Excel"));
  });

  it("shows the bubble over selected text, and makes it bold", async () => {
    const seen: string[] = [];
    const editor = createRef<Editor>();
    render(<MarkdownEditor value="Be careful" label="Steps" editorRef={editor} onChange={(m) => seen.push(m)} />);
    await started("Steps");
    expect(screen.queryByRole("toolbar")).toBeNull();
    await select(editor.current, "careful");
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Bold" }));
    });
    expect(seen.at(-1)).toBe("Be **careful**");
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("strikes the selected text through, saved as ~~text~~", async () => {
    const seen: string[] = [];
    const editor = createRef<Editor>();
    render(<MarkdownEditor value="Be careful" label="Steps" editorRef={editor} onChange={(m) => seen.push(m)} />);
    const box = await started("Steps");
    await select(editor.current, "careful");
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Strikethrough" }));
    });
    expect(seen.at(-1)).toBe("Be ~~careful~~");
    expect(box.querySelector("del")?.textContent).toBe("careful");
    expect(screen.getByRole("button", { name: "Strikethrough" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the bubble when focus moves onto it, and puts it under a selection with no room above", async () => {
    const editor = createRef<Editor>();
    render(<MarkdownEditor value="Be careful" label="Steps" editorRef={editor} onChange={() => {}} />);
    const box = await started("Steps");
    await select(editor.current, "careful");
    const bold = await screen.findByRole("button", { name: "Bold" });
    // jsdom lays nothing out, so the selection sits at the very top of the box.
    expect(bold.closest(".md-bubble")?.classList.contains("below")).toBe(true);
    await act(async () => {
      fireEvent.blur(box, { relatedTarget: bold });
    });
    expect(screen.getByRole("toolbar")).toBeTruthy();
    await act(async () => {
      fireEvent.blur(box, { relatedTarget: document.body });
    });
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("keeps the bubble when a button is used from the keyboard, with bold, italic and strikethrough", async () => {
    const seen: string[] = [];
    const editor = createRef<Editor>();
    render(<MarkdownEditor value="- Read" label="Steps" editorRef={editor} onChange={(m) => seen.push(m)} />);
    await started("Steps");
    await select(editor.current, "Read");
    const italic = await screen.findByRole("button", { name: "Italic" });
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Bold",
      "Italic",
      "Strikethrough",
    ]);
    italic.focus();
    await act(async () => {
      fireEvent.click(italic);
    });
    expect(seen.at(-1)).toBe("- *Read*");
    expect(screen.getByRole("toolbar")).toBeTruthy();
  });

  it("takes an item out of the list with Backspace at its start", async () => {
    const seen: string[] = [];
    const editor = createRef<Editor>();
    render(
      <MarkdownEditor value={"1. Read\n2. Price"} label="Steps" editorRef={editor} onChange={(m) => seen.push(m)} />,
    );
    const box = await started("Steps");
    await act(async () => {
      editor.current?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        let at = -1;
        view.state.doc.descendants((node, pos) => {
          if (at < 0 && node.isText && node.text === "Price") at = pos;
        });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
      });
    });
    fireEvent.keyDown(box, { key: "Backspace" });
    expect(seen.at(-1)).toBe("1. Read\n\nPrice");
  });

  it("shows a new value without reporting its own tidying as an edit", async () => {
    const seen: string[] = [];
    const { rerender } = render(<MarkdownEditor value="one" label="Steps" onChange={(m) => seen.push(m)} />);
    const box = await started("Steps");
    rerender(<MarkdownEditor value={"* a\n* b"} label="Steps" onChange={(m) => seen.push(m)} />);
    await waitFor(() => expect(box.querySelectorAll("li")).toHaveLength(2));
    expect(seen).toEqual([]);
  });

  it("takes a value that changed while it was starting", async () => {
    const { rerender } = render(<MarkdownEditor value="first" label="Steps" onChange={() => {}} />);
    rerender(<MarkdownEditor value="restored" label="Steps" onChange={() => {}} />);
    const box = await started("Steps");
    await waitFor(() => expect(box.textContent).toBe("restored"));
  });

  it("opens the slash menu on an empty line, and Escape closes it, leaving the text", async () => {
    const seen: string[] = [];
    const editor = createRef<Editor>();
    render(<MarkdownEditor value="" label="Steps" editorRef={editor} onChange={(m) => seen.push(m)} />);
    const box = await started("Steps");
    await type(editor.current, "/");
    expect(screen.getByRole("listbox", { name: "Turn into" })).toBeTruthy();
    expect(options()).toEqual(["Heading", "Bulleted list", "Numbered list"]);
    const first = screen.getAllByRole("option")[0];
    expect(box.getAttribute("aria-activedescendant")).toBe(first?.id);
    await press(box, "ArrowUp");
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("Numbered list");
    await press(box, "Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box.getAttribute("aria-activedescendant")).toBeNull();
    await type(editor.current, "he");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(seen.at(-1)).toBe("/he");
  });

  it("opens only at a line's start or after a space, and closes on a space after the slash", async () => {
    const editor = createRef<Editor>();
    render(<MarkdownEditor value="" label="Steps" editorRef={editor} onChange={() => {}} />);
    await started("Steps");
    await type(editor.current, "and/or");
    expect(screen.queryByRole("listbox")).toBeNull();
    await type(editor.current, " /");
    expect(screen.getByRole("listbox")).toBeTruthy();
    await type(editor.current, " ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters the choices by the start of their words, and closes when none is left", async () => {
    const editor = createRef<Editor>();
    render(<MarkdownEditor value="" label="Steps" editorRef={editor} onChange={() => {}} />);
    await started("Steps");
    await type(editor.current, "/LIS");
    expect(options()).toEqual(["Bulleted list", "Numbered list"]);
    await type(editor.current, "t");
    expect(options()).toEqual(["Bulleted list", "Numbered list"]);
    await type(editor.current, "x");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("matches words without minding accents or case", () => {
    expect(matches("Elenco numerato", "num")).toBe(true);
    expect(matches("Elenco numerato", "elenco n")).toBe(true);
    expect(matches("Città", "CITTA")).toBe(true);
    expect(matches("Numbered list", "umb")).toBe(false);
  });

  it("turns the line into a heading with Enter, taking out the slash and what follows it", async () => {
    const seen: string[] = [];
    const editor = createRef<Editor>();
    render(<MarkdownEditor value="Plan" label="Steps" editorRef={editor} onChange={(m) => seen.push(m)} />);
    const box = await started("Steps");
    await caretAt(editor.current, "Plan");
    await type(editor.current, "/he");
    await press(box, "Enter");
    expect(seen.at(-1)).toBe("## Plan");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("makes a list from the menu, switches it to the other kind, and takes an item out as text", async () => {
    const seen: string[] = [];
    const editor = createRef<Editor>();
    render(<MarkdownEditor value={"Read\n\nPrice"} label="Steps" editorRef={editor} onChange={(m) => seen.push(m)} />);
    const box = await started("Steps");
    await caretAt(editor.current, "Read");
    await type(editor.current, "/bul");
    await press(box, "Enter");
    expect(seen.at(-1)).toBe("- Read\n\nPrice");
    await caretAt(editor.current, "Read");
    await type(editor.current, "/");
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: "Numbered list" }));
    });
    expect(seen.at(-1)).toBe("1. Read\n\nPrice");
    await caretAt(editor.current, "Read");
    await type(editor.current, "/text");
    await press(box, "Enter");
    expect(seen.at(-1)).toBe("Read\n\nPrice");
  });

  it("filters on the labels of the language in use", async () => {
    const editor = createRef<Editor>();
    render(
      <LanguageContext.Provider value="it">
        <MarkdownEditor value="" label="Passi" editorRef={editor} onChange={() => {}} />
      </LanguageContext.Provider>,
    );
    await started("Passi");
    await type(editor.current, "/elenco n");
    expect(options()).toEqual(["Elenco numerato"]);
  });

  it("hints at the slash only while the whole editor is empty", async () => {
    const editor = createRef<Editor>();
    const { container } = render(
      <MarkdownEditor value="" label="Steps" placeholder="The steps" editorRef={editor} onChange={() => {}} />,
    );
    const box = await started("Steps");
    expect(container.querySelector(".md-placeholder")?.textContent).toBe("The stepsType / for headings and lists");
    await type(editor.current, "- ");
    expect(box.querySelector("li")).toBeTruthy();
    expect(container.querySelector(".md-placeholder")).toBeNull();
    expect(box.querySelector("[data-hint]")).toBeNull();
    await type(editor.current, "a");
    expect(box.querySelector("[data-hint]")).toBeNull();
  });

  it("has no hint on an empty line in a text that has more", async () => {
    const editor = createRef<Editor>();
    const { container } = render(<MarkdownEditor value="Read" label="Steps" editorRef={editor} onChange={() => {}} />);
    const box = await started("Steps");
    await caretAt(editor.current, "Read");
    await act(async () => {
      editor.current?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.split(view.state.selection.from + 4));
        // The caret goes down to the new, empty line.
        view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
      });
    });
    expect(box.querySelectorAll("p")).toHaveLength(2);
    expect(box.querySelector("[data-hint]")).toBeNull();
    expect(container.querySelector(".md-placeholder")).toBeNull();
  });

  it("leaves out of the slash menu the kind of line the caret is already on", async () => {
    const editor = createRef<Editor>();
    render(
      <MarkdownEditor
        value={"Text\n\n## Plan\n\n- Bullet\n\n1. Number"}
        label="Steps"
        editorRef={editor}
        onChange={() => {}}
      />,
    );
    const box = await started("Steps");
    await caretAt(editor.current, "Text");
    await type(editor.current, "/");
    expect(options()).toEqual(["Heading", "Bulleted list", "Numbered list"]);
    await press(box, "Escape");
    await caretAt(editor.current, "Plan");
    await type(editor.current, "/");
    expect(options()).toEqual(["Text", "Bulleted list", "Numbered list"]);
    await press(box, "Escape");
    await caretAt(editor.current, "Bullet");
    await type(editor.current, "/");
    expect(options()).toEqual(["Text", "Heading", "Numbered list"]);
    await press(box, "Escape");
    await caretAt(editor.current, "Number");
    await type(editor.current, "/");
    expect(options()).toEqual(["Text", "Heading", "Bulleted list"]);
  });

  it("filters over the shortened slash menu, and closes when nothing is left", async () => {
    const editor = createRef<Editor>();
    render(<MarkdownEditor value="- Read" label="Steps" editorRef={editor} onChange={() => {}} />);
    await started("Steps");
    await caretAt(editor.current, "Read");
    await type(editor.current, "/LIS");
    expect(options()).toEqual(["Numbered list"]);
    await type(editor.current, "x");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves through the shortened slash menu with the arrows and picks with Enter", async () => {
    const seen: string[] = [];
    const editor = createRef<Editor>();
    render(<MarkdownEditor value="- Read" label="Steps" editorRef={editor} onChange={(m) => seen.push(m)} />);
    const box = await started("Steps");
    await caretAt(editor.current, "Read");
    await type(editor.current, "/");
    await press(box, "ArrowDown");
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("Heading");
    await press(box, "ArrowDown");
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("Numbered list");
    await press(box, "Enter");
    expect(seen.at(-1)).toBe("1. Read");
  });
});
