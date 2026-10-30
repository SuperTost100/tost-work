import { describe, expect, it } from "vitest";
import { clip } from "./Clipped";

// Every character is 10 wide, the "…" too.
const measure = (s: string) => s.length * 10;

describe("clip", () => {
  it("keeps a text that fits", () => {
    expect(clip("Pensandoti", 100, measure)).toBe("Pensandoti");
  });

  it("puts the … right after the last letter, never after a space", () => {
    // "Pensandoti " and the … would fit in 120: the space goes, and the … follows the i.
    expect(clip("Pensandoti al lavoro", 120, measure)).toBe("Pensandoti…");
    expect(clip("Pensandoti al lavoro", 130, measure)).toBe("Pensandoti a…");
    expect(clip("Pensandoti   al lavoro", 140, measure)).toBe("Pensandoti…");
  });

  it("cuts inside a word when that's what fits", () => {
    expect(clip("Pensandoti al lavoro", 60, measure)).toBe("Pensa…");
  });

  it("never splits an emoji or a letter from its accent", () => {
    // Measured in code units, so a cut by code units would land inside them.
    expect(clip("😀abc", 30, measure)).toBe("😀…");
    expect(clip("😀abc", 20, measure)).toBe("…");
    expect(clip("cafe\u0301 bar", 60, measure)).toBe("cafe\u0301…");
  });

  it("leaves only the … when nothing else fits", () => {
    expect(clip("Pensandoti", 5, measure)).toBe("…");
  });
});
