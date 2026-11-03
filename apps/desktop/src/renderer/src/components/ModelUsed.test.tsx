import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LanguageContext } from "@/lib/useT";
import { ModelUsed } from "./ModelPicker";

const shown = (task: Parameters<typeof ModelUsed>[0]["task"], lang: "en" | "it" = "it") => {
  const { container } = render(
    <LanguageContext.Provider value={lang}>
      <ModelUsed task={task} />
    </LanguageContext.Provider>,
  );
  return [container.querySelector(".k")?.textContent, container.querySelector(".v")?.textContent];
};

describe("what a started task runs on, in its side panel", () => {
  it("titles the row with the choice, and says the model and level behind it", () => {
    expect(shown({ choice: "balanced", model: "gpt-6.1-terra", effort: "medium" })).toEqual([
      "Equilibrato",
      "GPT-6.1 Terra · medio",
    ]);
    expect(shown({ choice: "thorough", model: "claude-opus-5-5", effort: "high" }, "en")).toEqual([
      "Thorough",
      "Claude Opus 5.5 · high",
    ]);
  });

  it("titles it Personalizzato for a model picked from the list", () => {
    expect(shown({ choice: "custom", model: "claude-sonnet-5-5", effort: "max" })).toEqual([
      "Personalizzato",
      "Claude Sonnet 5.5 · massimo",
    ]);
  });

  it("titles it Modello on a task from before choices were kept", () => {
    expect(shown({ model: "gpt-6-luna", effort: "low" })).toEqual(["Modello", "GPT-6 Luna · basso"]);
  });
});
