import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

const SKILL =
  "## Steps\n\n1. Read the **brief**.\n2. Price each item:\n   - labour\n   - materials\n\n| Item | Price |\n| --- | --- |\n| Visit | 90 € |";

const started = async (name: string) => {
  const box = await screen.findByRole("textbox", { name });
  await waitFor(() => expect(box.getAttribute("contenteditable")).not.toBeNull());
  return box;
};

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

  it("makes the selected text bold from the toolbar", async () => {
    const seen: string[] = [];
    render(<MarkdownEditor value="" label="Steps" onChange={(m) => seen.push(m)} />);
    const box = await started("Steps");
    await paste(box, "careful");
    fireEvent.keyDown(box, { key: "a", ctrlKey: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    });
    expect(seen.at(-1)).toBe("**careful**");
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
});
