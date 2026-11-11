import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every rule whose selector list holds exactly `selector`. */
const rulesFor = (selector: string): string[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) =>
      (selectors ?? "")
        .split(",")
        .map((s) => s.trim())
        .includes(selector),
    )
    .map(([, , body]) => body ?? "");

describe("text the user wrote", () => {
  // Each one holds text with line breaks the user typed or pasted. Without pre-wrap the chat draws them as one line.
  it.each([
    ["the user's message in the chat", ".you"],
    ["an answer under an answered question", ".answered .a"],
    ["the brief in a task's side panel", ".bpanel .bbrief"],
  ])("keeps line breaks and blank lines in %s", (_name, selector) => {
    const rules = rulesFor(selector);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((body) => /white-space:\s*pre-wrap/.test(body))).toBe(true);
  });

  // A link has no spaces: without this it runs out of the bubble and over the task's panel.
  it("breaks a long link or word inside the user's message", () => {
    expect(rulesFor(".you").some((body) => /overflow-wrap:\s*anywhere/.test(body))).toBe(true);
  });
});
