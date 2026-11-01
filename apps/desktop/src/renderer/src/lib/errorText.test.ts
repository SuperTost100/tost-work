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

  it("says which file is missing, in the app's language", () => {
    const err = new Error(
      "Error invoking remote method 'tasks:decide': Error: ENOENT: no such file or directory, realpath '/Users/g/Work/TEST file.txt'",
    );
    const t = (key: string, vars?: Record<string, string>) => `${key}:${vars?.name}`;
    expect(errorText(err, t)).toBe("error.missing:TEST file.txt");
    // A name with an apostrophe. A copy names two paths and either can be the missing one, so it stays as it is.
    expect(errorText(new Error("ENOENT: no such file or directory, realpath '/Users/g/Luca's notes.txt'"), t)).toBe(
      "error.missing:Luca's notes.txt",
    );
    expect(
      errorText(new Error("ENOENT: no such file or directory, copyfile '/a/prezzi.csv' -> '/q/prezzi.csv'"), t),
    ).toMatch(/^ENOENT/);
    // Without the language, the system's message is all there is.
    expect(errorText(err)).toMatch(/^ENOENT/);
  });
});
