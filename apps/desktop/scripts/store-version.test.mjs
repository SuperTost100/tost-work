import { describe, expect, it } from "vitest";
import { storeVersion } from "./store-version.mjs";

describe("the Microsoft Store version", () => {
  it("starts at 1 and keeps growing through every stage", () => {
    const order = [
      "0.0.30-dev",
      "0.0.31-dev",
      "0.1.0-alpha",
      "0.1.2-alpha",
      "0.5.0-alpha",
      "0.6.0-beta",
      "1.0.0",
      "1.0.1",
    ];
    const store = order.map(storeVersion);
    expect(store.slice(0, 3)).toEqual(["1.0.30", "1.0.31", "1.0.100"]);
    expect(storeVersion("1.0.0")).toBe("1.1.0");
    const asNumber = (v) => v.split(".").reduce((n, part) => n * 100_000 + Number(part), 0);
    for (let i = 1; i < store.length; i++) expect(asNumber(store[i])).toBeGreaterThan(asNumber(store[i - 1]));
  });

  it("refuses a version it can't number", () => {
    expect(() => storeVersion("0.1.100")).toThrow("under 100");
    expect(() => storeVersion("v0.1.0")).toThrow("Not a Tost Work version");
    expect(() => storeVersion("65536.0.0")).toThrow("too large");
  });
});
