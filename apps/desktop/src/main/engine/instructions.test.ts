/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { Project, Task } from "../../shared/model";
import { instructionsFor, splitForCodex } from "./instructions";

const task = { workdir: "/Users/giulia/Proposte", attachments: [] } as unknown as Task;
const project = { name: "Proposte", instructions: "Use our template.\n" } as Project;

describe("instructionsFor", () => {
  it("names the folder, the language, the rules and the project's instructions", () => {
    const text = instructionsFor(task, project, "it");
    expect(text).toContain("/Users/giulia/Proposte");
    expect(text).toContain("plain Italian");
    expect(text).toContain("request_approval with action overwrite");
    expect(text).toContain("The project's instructions:\nUse our template.");
  });

  it("explains the quick edit's copies and lists the attachments", () => {
    const quick = { workdir: "/tmp/q", attachments: ["/tmp/q/letter.docx"] } as unknown as Task;
    const text = instructionsFor(quick, null, "en");
    expect(text).toContain("quick edit without a project");
    expect(text).toContain("- /tmp/q/letter.docx");
    expect(text).not.toContain("project's instructions");
  });
});

describe("splitForCodex", () => {
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");

  it("keeps short text whole", () => {
    expect(splitForCodex("one\n\ntwo")).toEqual(["one\n\ntwo"]);
  });

  it("splits at paragraph breaks under the limit, losing nothing", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `${i} ${"x".repeat(900)}`);
    const pieces = splitForCodex(paragraphs.join("\n\n"));
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(bytes(p)).toBeLessThanOrEqual(4000);
    expect(pieces.join("\n\n")).toBe(paragraphs.join("\n\n"));
  });

  it("cuts a paragraph longer than the limit without breaking a character", () => {
    const long = "è".repeat(3000); // 6,000 bytes
    const pieces = splitForCodex(long);
    for (const p of pieces) expect(bytes(p)).toBeLessThanOrEqual(4000);
    expect(pieces.join("")).toBe(long);
  });
});
