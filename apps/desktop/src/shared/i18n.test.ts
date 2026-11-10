import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_TASK, LINES } from "./homeLines";
import { greeting, guideText, homeLine, languageFrom, translate, trashName } from "./i18n";

describe("i18n", () => {
  it("picks Italian for any Italian locale", () => {
    expect(languageFrom("it-IT")).toBe("it");
    expect(languageFrom("it")).toBe("it");
    expect(languageFrom("en-GB")).toBe("en");
    expect(languageFrom(undefined)).toBe("en");
  });

  it("keeps the tags in the sidebar's Recent short in every language, so they leave room for the title", () => {
    // The ones Sidebar.tsx shows beside a title. "da controllare" (14) left a few letters of the title in Italian.
    const keys = ["tag.needsYou", "tag.working", "tag.toReview", "tag.draft"] as const;
    for (const lang of ["en", "it"] as const)
      for (const key of keys) expect(translate(lang, key).length, `${lang} ${key}`).toBeLessThanOrEqual(10);
  });

  it("fills placeholders and keeps unknown ones visible", () => {
    expect(translate("en", "task.questionOf", { n: "1", total: "3" })).toBe("Question 1 of 3");
    expect(translate("it", "task.questionOf", { n: "2" })).toBe("Domanda 2 di {total}");
  });

  describe("the Trash", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("is the Recycle Bin on Windows and the Trash elsewhere, in English", () => {
      expect(trashName("win32")).toBe("Recycle Bin");
      expect(trashName("darwin")).toBe("Trash");
      expect(trashName("linux")).toBe("Trash");
    });

    it("follows the system the window runs on, and stays Cestino in Italian", () => {
      vi.stubGlobal("tostWork", { platform: "win32" });
      expect(translate("en", "approval.trash")).toBe("Move to Recycle Bin");
      expect(translate("en", "skills.removeDetail")).toBe("Its folder goes to the Recycle Bin.");
      expect(translate("it", "approval.trash")).toBe("Sposta nel Cestino");
      vi.stubGlobal("tostWork", { platform: "darwin" });
      expect(translate("en", "approval.trash")).toBe("Move to Trash");
    });

    it("follows Node's platform in the main process", () => {
      vi.stubGlobal("tostWork", undefined);
      expect(translate("en", "approval.trash")).toBe(`Move to ${trashName(process.platform)}`);
    });
  });

  it("names the built-in guides in Italian, and leaves English and unknown guides to their own files", () => {
    expect(guideText("it", "word")?.title).toBe("Documenti Word");
    expect(guideText("it", "powerpoint")?.title).toBe("Presentazioni PowerPoint");
    for (const name of ["excel", "pdf", "powerpoint", "word"]) {
      const text = guideText("it", name);
      expect(text?.title).toBeTruthy();
      expect(text?.description).toMatch(/^Crea /);
      expect(text?.steps).toBeTruthy();
    }
    expect(guideText("en", "word")).toBeNull();
    expect(guideText("it", "unknown")).toBeNull();
    // A name like this one lives on Object.prototype, but isn't a guide.
    expect(guideText("it", "constructor")).toBeNull();
  });

  it("switches greeting at noon and at six", () => {
    expect(greeting("en", 11, "Giulia")).toBe("Good morning, Giulia.");
    expect(greeting("en", 12, "Giulia")).toBe("Good afternoon, Giulia.");
    expect(greeting("it", 18, "Giulia")).toBe("Buonasera, Giulia.");
  });

  it("says good evening after midnight, and good morning from five", () => {
    expect(greeting("it", 0, "Tost")).toBe("Buonasera, Tost.");
    expect(greeting("it", 4, "Tost")).toBe("Buonasera, Tost.");
    expect(greeting("it", 5, "Tost")).toBe("Buongiorno, Tost.");
  });

  it("picks the line under the greeting along each language's own list", () => {
    for (const lang of ["en", "it"] as const) {
      expect(homeLine(lang, 0)).toBe(LINES[lang][0]);
      // 1 is the end of the range, still the last line rather than past it.
      expect(homeLine(lang, 1)).toBe(LINES[lang].at(-1));
      expect(homeLine(lang, 0.5)).toBe(LINES[lang][Math.floor(LINES[lang].length / 2)]);
      expect(homeLine(lang, 0.5, true)).toBe(FIRST_TASK[lang]);
      expect(new Set(LINES[lang]).size).toBe(LINES[lang].length);
    }
  });
});
