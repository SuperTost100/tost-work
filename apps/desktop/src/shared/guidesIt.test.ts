/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GUIDES_IT } from "./guidesIt";

const root = fileURLToPath(new URL("../../resources/skills/", import.meta.url));
const folders = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

/** What the Skills screen shows as the steps: the file's text after its frontmatter and first heading. */
function englishSteps(name: string): string {
  const text = readFileSync(`${root}${name}/SKILL.md`, "utf8");
  return (/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(text)?.[1] ?? text).replace(/^\s*#\s+.+\r?\n?/, "").trim();
}

/** Everything that must read the same in both languages: fenced blocks and inline code. Sorted, as word order may differ. */
function code(text: string): string[] {
  return [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => m[0]).sort();
}

/** The Markdown outline: each heading's level, and each list item's marker and indent. */
function shape(text: string): string[] {
  const lines: string[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced) {
      const mark = /^(\s*)(#{1,6}|-|\d+\.)\s/.exec(line);
      if (mark) lines.push(`${mark[1]}${mark[2]?.replace(/\d+/, "1")}`);
    }
  }
  return lines;
}

describe("the Italian guides", () => {
  it("cover every guide in resources/skills, and nothing else", () => {
    expect(Object.keys(GUIDES_IT).sort()).toEqual(folders);
    expect(folders).toEqual(["email", "excel", "pdf", "powerpoint", "word"]);
  });

  for (const name of folders) {
    describe(name, () => {
      const it_ = GUIDES_IT[name];
      const english = englishSteps(name);

      it("has a title, a description and steps", () => {
        expect(it_?.title).toBeTruthy();
        expect(it_?.description).toMatch(/^Crea /);
        // The title is shown apart, as for English, so the steps start below it.
        expect(it_?.steps).not.toMatch(/^#\s/);
        expect(it_?.steps.length).toBeGreaterThan(200);
      });

      it("keeps every command, file name and code block of the English guide", () => {
        expect(code(it_?.steps ?? "")).toEqual(code(english));
      });

      it("keeps the English guide's headings and list items in the same places", () => {
        expect(shape(it_?.steps ?? "")).toEqual(shape(english));
      });

      it("is Italian text, not a copy of the English", () => {
        expect(it_?.steps).not.toBe(english);
        expect(it_?.steps).toMatch(/\b(il|la|di|che|per|non)\b/);
        // No dashes used as punctuation, as the house style asks.
        expect(it_?.steps).not.toMatch(/[—–]/);
      });
    });
  }
});
