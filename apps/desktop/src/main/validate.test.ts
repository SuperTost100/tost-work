/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { absolutePath, paths, settingsPatch, text } from "./validate";

describe("IPC validation", () => {
  it("accepts absolute paths and rejects empty or relative ones", () => {
    expect(absolutePath("/Users/giulia/Proposals", "folder")).toBe("/Users/giulia/Proposals");
    expect(() => absolutePath("", "folder")).toThrow(/absolute/);
    expect(() => absolutePath("Proposals", "folder")).toThrow(/absolute/);
    expect(() => absolutePath(42, "folder")).toThrow(/text/);
  });

  it("checks attachment lists", () => {
    expect(paths(undefined, "attachments")).toEqual([]);
    expect(paths(["/a.docx"], "attachments")).toEqual(["/a.docx"]);
    expect(() => paths("/a.docx", "attachments")).toThrow(/list/);
    expect(() => paths(["notes.docx"], "attachments")).toThrow(/absolute/);
    expect(() =>
      paths(
        Array.from({ length: 21 }, (_, i) => `/f${i}`),
        "attachments",
      ),
    ).toThrow(/at most 20/);
  });

  it("limits text length", () => {
    expect(() => text("x".repeat(11), "name", 10)).toThrow(/too long/);
  });
});

describe("settingsPatch", () => {
  it("keeps known settings and trims the name", () => {
    expect(settingsPatch({ name: " Giulia ", level: "expert", language: null, setupDone: true })).toEqual({
      name: "Giulia",
      level: "expert",
      language: null,
      setupDone: true,
    });
  });

  it("refuses unknown keys and wrong values", () => {
    expect(() => settingsPatch({ admin: true })).toThrow(/Unknown setting/);
    expect(() => settingsPatch({ level: "guru" })).toThrow(/four levels/);
    expect(() => settingsPatch({ language: "fr" })).toThrow(/en, it or null/);
    expect(() => settingsPatch({ setupDone: "yes" })).toThrow(/true or false/);
    expect(() => settingsPatch(["name"])).toThrow(/object/);
  });
});
