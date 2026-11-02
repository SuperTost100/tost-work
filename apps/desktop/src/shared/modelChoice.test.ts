import { describe, expect, it } from "vitest";
import {
  isModelPick,
  type ModelChoices,
  type ModelOption,
  modelName,
  nearestEffort,
  pickOn,
  providerDefault,
  resolvePreset,
  SAMPLE_CHOICES,
} from "./modelChoice";

const ALL = ["low", "medium", "high", "xhigh", "max"];
const model = (id: string, efforts = ALL, defaultEffort?: string): ModelOption => ({
  id,
  name: id,
  efforts,
  ...(defaultEffort ? { defaultEffort } : {}),
});

const codex = [model("gpt-6.1-sol", [...ALL, "ultra"], "low"), model("gpt-6.1-terra"), model("gpt-6-luna")];
const claude = [
  model("claude-opus-5-5"),
  model("claude-sonnet-5-5"),
  model("claude-haiku-5-5"),
  model("claude-fable-5-1"),
];

describe("the three choices", () => {
  it("map to the models and levels Tost chose", () => {
    const run = (preset: "fast" | "balanced" | "thorough", provider: "codex" | "claude") => {
      const found = resolvePreset(preset, provider, provider === "codex" ? codex : claude);
      return `${found?.model.id} ${found?.effort}`;
    };
    expect(run("fast", "codex")).toBe("gpt-6-luna medium");
    expect(run("balanced", "codex")).toBe("gpt-6.1-terra medium");
    expect(run("thorough", "codex")).toBe("gpt-6.1-sol high");
    expect(run("fast", "claude")).toBe("claude-haiku-5-5 medium");
    expect(run("balanced", "claude")).toBe("claude-sonnet-5-5 high");
    expect(run("thorough", "claude")).toBe("claude-opus-5-5 high");
  });

  it("falls back to Sonnet at xhigh when Opus isn't offered, as on a plan without it", () => {
    const withoutOpus = claude.filter((m) => m.id !== "claude-opus-5-5");
    const found = resolvePreset("thorough", "claude", withoutOpus);
    expect([found?.model.id, found?.effort]).toEqual(["claude-sonnet-5-5", "xhigh"]);
  });

  it("uses the nearest level Sonnet offers when it has no xhigh", () => {
    const sonnet = model("claude-sonnet-5-5", ["low", "medium", "high"]);
    const found = resolvePreset("thorough", "claude", [sonnet]);
    expect([found?.model.id, found?.effort]).toEqual(["claude-sonnet-5-5", "high"]);
  });

  it("uses the nearest level a mapped model offers when the wanted one is missing", () => {
    const luna = model("gpt-6-luna", ["low", "high"]);
    // Medium is as far from low as from high: the lower one wins.
    expect(resolvePreset("fast", "codex", [luna])?.effort).toBe("low");
    const terra = model("gpt-6.1-terra", ["high", "max"]);
    expect(resolvePreset("balanced", "codex", [terra])?.effort).toBe("high");
  });

  it("falls back to the AI's own default model when a mapped model isn't offered", () => {
    const only = [model("gpt-6-sol", ["low", "medium"], "medium")];
    const found = resolvePreset("fast", "codex", only);
    expect([found?.model.id, found?.effort]).toEqual(["gpt-6-sol", "medium"]);
    // Claude's default is Sonnet by name, not the largest model first in the list.
    const noHaiku = claude.filter((m) => m.id !== "claude-haiku-5-5");
    const fast = resolvePreset("fast", "claude", noHaiku);
    expect(fast?.model.id).toBe("claude-sonnet-5-5");
  });

  it("gives nothing when the AI lists no models", () => {
    expect(resolvePreset("balanced", "codex", [])).toBeNull();
    expect(providerDefault("claude", [])).toBeNull();
  });
});

describe("nearestEffort", () => {
  it("keeps a level that's offered, and ignores levels the picker leaves out", () => {
    expect(nearestEffort("high", ALL)).toBe("high");
    expect(nearestEffort("ultra", [...ALL, "ultra"])).toBe("low");
    expect(nearestEffort("max", ["ultra"])).toBeUndefined();
    expect(nearestEffort("xhigh", ["low", "medium", "high"])).toBe("high");
  });
});

describe("pickOn", () => {
  const choices: ModelChoices = {
    ai: "chatgpt",
    provider: "codex",
    lists: [
      { ai: "chatgpt", provider: "codex", models: codex },
      { ai: "claude", provider: "claude", models: claude },
    ],
  };

  it("runs a choice of the three on the default AI", () => {
    const found = pickOn({ preset: "thorough" }, choices);
    expect([found?.ai, found?.provider, found?.model.id, found?.effort]).toEqual([
      "chatgpt",
      "codex",
      "gpt-6.1-sol",
      "high",
    ]);
  });

  it("runs a model from the full list on the AI it was picked on", () => {
    const found = pickOn({ ai: "claude", model: "claude-opus-5-5", effort: "max" }, choices);
    expect([found?.ai, found?.provider, found?.model.id, found?.effort]).toEqual([
      "claude",
      "claude",
      "claude-opus-5-5",
      "max",
    ]);
    // A level the model doesn't offer becomes the nearest one.
    const lower = pickOn({ ai: "chatgpt", model: "gpt-6-luna", effort: "ultra" }, choices);
    expect(lower?.effort).toBe("low");
  });

  it("stands the middle choice in for a model or AI that's gone", () => {
    const gone = pickOn({ ai: "claude", model: "claude-opus-4-1", effort: "high" }, choices);
    expect(gone?.model.id).toBe("gpt-6.1-terra");
    const noAi = pickOn({ ai: "key", model: "gpt-6.1-terra", effort: "high" }, choices);
    expect([noAi?.ai, noAi?.effort]).toEqual(["chatgpt", "medium"]);
  });

  it("has sample models that carry every choice on both agents", () => {
    for (const preset of ["fast", "balanced", "thorough"] as const) {
      expect(pickOn({ preset }, SAMPLE_CHOICES)?.model.id).toBe(
        resolvePreset(preset, "codex", SAMPLE_CHOICES.lists[0]?.models ?? [])?.model.id,
      );
    }
    expect(SAMPLE_CHOICES.lists[1]?.models.map((m) => m.id)).toContain("claude-opus-5-5");
  });
});

describe("isModelPick", () => {
  it("accepts the three choices and a model on a known AI, and nothing else", () => {
    expect(isModelPick({ preset: "fast" })).toBe(true);
    expect(isModelPick({ ai: "claude", model: "claude-opus-5-5", effort: "high" })).toBe(true);
    expect(isModelPick({ preset: "slow" })).toBe(false);
    expect(isModelPick({ ai: "gemini", model: "x", effort: "high" })).toBe(false);
    expect(isModelPick({ ai: "claude", model: "", effort: "high" })).toBe(false);
    expect(isModelPick({ ai: "claude", model: "x" })).toBe(false);
    expect(isModelPick(null)).toBe(false);
    expect(isModelPick("balanced")).toBe(false);
  });
});

describe("modelName", () => {
  it("reads GPT-6.1-Terra as GPT-6.1 Terra and leaves other names alone", () => {
    expect(modelName({ id: "gpt-6.1-terra", name: "GPT-6.1-Terra" })).toBe("GPT-6.1 Terra");
    expect(modelName({ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" })).toBe("Claude Sonnet 5.5");
    expect(modelName({ id: "x", name: "" })).toBe("x");
  });
});
