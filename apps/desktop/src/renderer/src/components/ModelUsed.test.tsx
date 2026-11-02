import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LanguageContext } from "@/lib/useT";
import { ModelUsed } from "./ModelPicker";

const shown = (task: Parameters<typeof ModelUsed>[0]["task"], lang: "en" | "it" = "it") =>
  render(
    <LanguageContext.Provider value={lang}>
      <ModelUsed task={task} />
    </LanguageContext.Provider>,
  ).container.textContent;

describe("what a started task runs on, in its side panel", () => {
  it("says the choice, then the model and level behind it", () => {
    expect(shown({ choice: "balanced", model: "gpt-6.1-terra", effort: "medium" })).toBe(
      "Equilibrato · GPT-6.1 Terra · medio",
    );
    expect(shown({ choice: "thorough", model: "claude-opus-5-5", effort: "high" }, "en")).toBe(
      "Thorough · Claude Opus 5.5 · high",
    );
  });

  it("says Personalizzato for a model picked from the list", () => {
    expect(shown({ choice: "custom", model: "claude-sonnet-5-5", effort: "max" })).toBe(
      "Personalizzato · Claude Sonnet 5.5 · massimo",
    );
  });

  it("shows only the model on a task from before choices were kept", () => {
    expect(shown({ model: "gpt-6-luna", effort: "low" })).toBe("GPT-6 Luna · basso");
  });
});
