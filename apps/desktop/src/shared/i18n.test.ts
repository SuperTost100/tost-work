import { describe, expect, it } from "vitest";
import { greetingKey, languageFrom, translate } from "./i18n";

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
});
