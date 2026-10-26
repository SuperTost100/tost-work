import { describe, expect, it } from "vitest";
import { errorText } from "./errorText";

describe("errorText", () => {
  it("drops the IPC wrapper and the error class", () => {
    expect(errorText(new Error("Error invoking remote method 'tasks:start': Error: Write what to change first"))).toBe(
      "Write what to change first",
    );
    expect(errorText(new Error("That task doesn't exist"))).toBe("That task doesn't exist");
    expect(errorText("plain")).toBe("plain");
  });
});
