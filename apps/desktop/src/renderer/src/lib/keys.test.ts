import { describe, expect, it } from "vitest";
import { keyed } from "./keys";

describe("keyed", () => {
  it("gives every item a distinct key, even when content looks like a numbered repeat", () => {
    const keys = keyed(["Draft", "Check", "Draft", "Draft#2", "Draft", '["Draft",2]'], (s) => s).map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the first keys the same when the list grows", () => {
    const before = keyed(["Draft", "Draft"], (s) => s).map(([k]) => k);
    const after = keyed(["Draft", "Draft", "Draft"], (s) => s).map(([k]) => k);
    expect(after.slice(0, 2)).toEqual(before);
  });
});
