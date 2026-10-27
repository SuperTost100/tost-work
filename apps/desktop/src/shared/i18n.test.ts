import { describe, expect, it } from "vitest";
import { greetingKey, HOME_LINES, homeLineKey, languageFrom, translate } from "./i18n";

describe("i18n", () => {
  it("picks Italian for any Italian locale", () => {
    expect(languageFrom("it-IT")).toBe("it");
    expect(languageFrom("it")).toBe("it");
    expect(languageFrom("en-GB")).toBe("en");
    expect(languageFrom(undefined)).toBe("en");
  });

  it("fills placeholders and keeps unknown ones visible", () => {
    expect(translate("en", "home.greeting.morning", { name: "Giulia" })).toBe("Good morning, Giulia.");
    expect(translate("it", "home.greeting.evening", {})).toBe("Buonasera, {name}.");
  });

  it("switches greeting at noon and at six", () => {
    expect(greetingKey(11)).toBe("home.greeting.morning");
    expect(greetingKey(12)).toBe("home.greeting.afternoon");
    expect(greetingKey(18)).toBe("home.greeting.evening");
  });

  it("says good evening after midnight, and good morning from five", () => {
    expect(greetingKey(0)).toBe("home.greeting.evening");
    expect(greetingKey(4)).toBe("home.greeting.evening");
    expect(greetingKey(5)).toBe("home.greeting.morning");
  });

  it("has every line under the greeting in both languages", () => {
    for (let i = 0; i < HOME_LINES; i++) {
      expect(translate("en", homeLineKey(i))).not.toMatch(/^home\./);
      expect(translate("it", homeLineKey(i))).not.toBe(translate("en", homeLineKey(i)));
    }
  });
});
