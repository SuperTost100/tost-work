import { describe, expect, it } from "vitest";
import { buttonsPosition, buttonsWidth, RAIL_WIDTH } from "./windowButtons";

describe("window buttons", () => {
  it("leaves the same space on both sides of the buttons on the rail", () => {
    for (const version of ["15.6.1", "26.1", "27.0"]) {
      const { x } = buttonsPosition(version);
      expect(Math.abs(RAIL_WIDTH - x - buttonsWidth(version) - x)).toBeLessThanOrEqual(1);
    }
  });

  it("knows macOS 26 draws them wider", () => {
    expect(buttonsPosition("15.6.1").x).toBe(14);
    expect(buttonsPosition("26.1").x).toBe(11);
  });
});
