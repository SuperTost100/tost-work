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

  it("takes notifications and starting at login, and refuses unknown kinds or levels", () => {
    expect(settingsPatch({ notifications: false, openAtLogin: true, notify: { failed: "quiet" } })).toEqual({
      notifications: false,
      openAtLogin: true,
      notify: { failed: "quiet" },
    });
    expect(() => settingsPatch({ notify: { email: "normal" } })).toThrow(/Unknown notification/);
    expect(() => settingsPatch({ notify: { done: "loud" } })).toThrow(/off, quiet or normal/);
    expect(() => settingsPatch({ openAtLogin: "yes" })).toThrow(/true or false/);
  });

  it("takes the profile's work and notes, trimmed", () => {
    expect(settingsPatch({ work: " Formatrice ", notes: " Documenti brevi. " })).toEqual({
      work: "Formatrice",
      notes: "Documenti brevi.",
    });
    expect(() => settingsPatch({ notes: "x".repeat(4001) })).toThrow();
  });

  it("takes sections, text size and theme, and refuses anything else in them", () => {
    expect(settingsPatch({ sections: { jobs: false, board: true }, textSize: "large", theme: "dark" })).toEqual({
      sections: { jobs: false, board: true },
      textSize: "large",
      theme: "dark",
    });
    expect(() => settingsPatch({ sections: { code: true } })).toThrow(/Unknown section/);
    expect(() => settingsPatch({ sections: { toString: true } })).toThrow(/Unknown section/);
    expect(() => settingsPatch({ sections: { jobs: "on" } })).toThrow(/on or off/);
    expect(() => settingsPatch({ sections: null })).toThrow(/object/);
    expect(() => settingsPatch({ textSize: "huge" })).toThrow(/small, normal or large/);
    expect(() => settingsPatch({ theme: "blue" })).toThrow(/light, dark or system/);
  });

  it("takes the default AI, or null for the first one signed in", () => {
    expect(settingsPatch({ defaultAi: "claude" })).toEqual({ defaultAi: "claude" });
    expect(settingsPatch({ defaultAi: null })).toEqual({ defaultAi: null });
    expect(() => settingsPatch({ defaultAi: "gemini" })).toThrow(/chatgpt, claude, key or null/);
  });

  it("refuses unknown keys and wrong values", () => {
    expect(() => settingsPatch({ admin: true })).toThrow(/Unknown setting/);
    expect(() => settingsPatch({ level: "guru" })).toThrow(/four levels/);
    expect(() => settingsPatch({ language: "fr" })).toThrow(/en, it or null/);
    expect(() => settingsPatch({ setupDone: "yes" })).toThrow(/true or false/);
    expect(() => settingsPatch(["name"])).toThrow(/object/);
  });
});
