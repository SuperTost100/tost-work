import { describe, expect, it } from "vitest";
import { FIRST_TASK, LINES } from "./homeLines";
import { greeting, homeLine, languageFrom, translate } from "./i18n";

describe("i18n", () => {
  it("picks Italian for any Italian locale", () => {
    expect(languageFrom("it-IT")).toBe("it");
    expect(languageFrom("it")).toBe("it");
    expect(languageFrom("en-GB")).toBe("en");
    expect(languageFrom(undefined)).toBe("en");
  });

  it("fills placeholders and keeps unknown ones visible", () => {
    expect(translate("en", "task.questionOf", { n: "1", total: "3" })).toBe("Question 1 of 3");
    expect(translate("it", "task.questionOf", { n: "2" })).toBe("Domanda 2 di {total}");
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
