import { describe, expect, it } from "vitest";
import { matchesWords, searchWords } from "./search";

describe("search", () => {
  it("ignores case and accents", () => {
    expect(matchesWords("Perché il preventivo è fermo", searchWords("PERCHE e"))).toBe(true);
  });

  it("needs every word, in any order", () => {
    const text = "Preventivo per Rossi srl";
    expect(matchesWords(text, searchWords("rossi preventivo"))).toBe(true);
    expect(matchesWords(text, searchWords("rossi ferrari"))).toBe(false);
  });

  it("finds nothing for an empty query", () => {
    expect(searchWords("   ")).toEqual([]);
    expect(matchesWords("anything", [])).toBe(false);
  });
});
