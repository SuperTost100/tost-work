/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { officeKind, pageSize, printable } from "./pdf-page";

// Excerpts of the HTML OfficeCLI 1.0.158 writes for each kind of file.
const DOCX = `<html><head><style>.page{}</style></head><body><div class="page-wrapper"><div class="page" data-page="1" style="width:595.3pt;min-height:841.9pt;padding:72pt 90pt 72pt 90pt;"></div></div><script>scale()</script></body></html>`;
const PPTX = `<html><head><style>:root{--slide-aspect:1.7778;--slide-design-w:960pt;--slide-design-h:540pt;}</style></head><body></body></html>`;

describe("PDF pages", () => {
  it("knows the Office kinds it can print", () => {
    expect(officeKind("/w/Proposta.DOCX")).toBe("docx");
    expect(officeKind("/w/slides.pptx")).toBe("pptx");
    expect(officeKind("/w/notes.txt")).toBeNull();
  });

  it("prints a Word file on its own page size, slides on theirs, and sheets across A4", () => {
    expect(pageSize(DOCX, "docx")).toEqual({ width: 595.3 / 72, height: 841.9 / 72 });
    expect(pageSize(PPTX, "pptx")).toEqual({ width: 960 / 72, height: 540 / 72 });
    expect(pageSize("<html></html>", "xlsx")).toEqual({ width: 11.69, height: 8.27 });
    // Without the size it expects, A4 upright.
    expect(pageSize("<html></html>", "docx")).toEqual({ width: 8.27, height: 11.69 });
  });

  it("takes the viewer's scripts out and puts the fonts and print rules in the head", () => {
    const page = printable(DOCX, "docx", "@font-face{}");
    expect(page).not.toContain("<script");
    expect(page).toMatch(/<style>@font-face\{\}\n[\s\S]*\.page \{ box-shadow: none[\s\S]*<\/style><\/head>/);
  });
});
