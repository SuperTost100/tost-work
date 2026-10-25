import { describe, expect, it } from "vitest";
import { keyed } from "./keys";

describe("keyed", () => {
  it("numbers repeated items so every key is unique", () => {
    expect(keyed(["Draft", "Check", "Draft", "Draft"], (s) => s).map(([k]) => k)).toEqual([
      "Draft",
      "Check",
      "Draft#2",
      "Draft#3",
    ]);
  });
});
