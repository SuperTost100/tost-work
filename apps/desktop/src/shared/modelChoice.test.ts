import { describe, expect, it } from "vitest";
import {
  choiceFromModel,
  choiceOf,
  isModelPick,
  type ModelChoices,
  type ModelOption,
  modelName,
  nameFromId,
  nearestEffort,
  newestOfEachFamily,
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
  model("claude-fable-5-2"),
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

  it("falls back to the AI's own default model, at the choice's level, when nothing nearer is offered", () => {
    const only = [model("gpt-6-sol", ["low", "medium", "high"], "low")];
    const found = resolvePreset("fast", "codex", only);
    expect([found?.model.id, found?.effort]).toEqual(["gpt-6-sol", "medium"]);
    // Claude's default is Sonnet by name, not the largest model first in the list.
    const noHaiku = claude.filter((m) => m.id !== "claude-haiku-5-5");
    const fast = resolvePreset("fast", "claude", noHaiku);
    expect(fast?.model.id).toBe("claude-sonnet-5-5");
  });

  it("gives each choice a different model or level on a ChatGPT Go plan, which lacks GPT-6.1 Terra and Sol", () => {
    // What Codex 0.167.0's model/list gave a Go account on 2026-11-10, in its order.
    const go = [
      { ...model("gpt-6-luna", ALL, "medium"), name: "GPT-6-Luna" },
      { ...model("gpt-5.6-terra", [...ALL, "ultra"], "medium"), name: "GPT-5.6-Terra" },
      { ...model("gpt-5.6-luna", ALL, "medium"), name: "GPT-5.6-Luna" },
    ];
    const run = (preset: "fast" | "balanced" | "thorough") => {
      const found = resolvePreset(preset, "codex", go);
      return `${found?.model.id} ${found?.effort}`;
    };
    expect(run("fast")).toBe("gpt-6-luna medium");
    // GPT-6.1 Terra's place goes to the newest Terra on offer.
    expect(run("balanced")).toBe("gpt-5.6-terra medium");
    // No Sol at all: the balanced choice's model, at the thorough choice's own level.
    expect(run("thorough")).toBe("gpt-5.6-terra high");
  });

  it("takes the newest model of the family, newer than the one named too", () => {
    const named = (id: string, name: string) => ({ ...model(id), name });
    const list = [
      named("gpt-6-luna", "GPT-6-Luna"),
      named("gpt-5.6-sol", "GPT-5.6-Sol"),
      named("gpt-6-sol", "GPT-6-Sol"),
      named("gpt-6.2-terra", "GPT-6.2 Terra"),
    ];
    expect(resolvePreset("thorough", "codex", list)?.model.id).toBe("gpt-6-sol");
    expect(resolvePreset("balanced", "codex", list)?.model.id).toBe("gpt-6.2-terra");
  });

  it("finds the family of a model listed without a name, by its id", () => {
    // model() names each one by its id, as the app does when the list carries no names.
    const go = [model("gpt-6-luna"), model("gpt-5.6-terra"), model("gpt-5.6-luna")];
    expect(resolvePreset("balanced", "codex", go)?.model.id).toBe("gpt-5.6-terra");
  });

  it("takes another Opus before Sonnet when the named Opus isn't offered", () => {
    const list = [model("claude-opus-5-6"), model("claude-sonnet-5-5"), model("claude-haiku-5-5")];
    const found = resolvePreset("thorough", "claude", list);
    expect([found?.model.id, found?.effort]).toEqual(["claude-opus-5-6", "high"]);
  });

  it("keeps the thorough choice apart from the balanced one on a newer Sonnet alone", () => {
    const list = [model("claude-sonnet-5-6"), model("claude-haiku-5-5")];
    const balanced = resolvePreset("balanced", "claude", list);
    const thorough = resolvePreset("thorough", "claude", list);
    expect([balanced?.model.id, balanced?.effort]).toEqual(["claude-sonnet-5-6", "high"]);
    expect([thorough?.model.id, thorough?.effort]).toEqual(["claude-sonnet-5-6", "xhigh"]);
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

describe("the newest model of each family", () => {
  const named = (id: string, name: string): ModelOption => ({ ...model(id), name });
  const codexList = [
    named("gpt-6.1-sol", "GPT-6.1-Sol"),
    named("gpt-6-sol", "GPT-6-Sol"),
    named("gpt-5.6-sol", "GPT-5.6-Sol"),
    named("gpt-6-astra", "GPT-6-Astra"),
    named("gpt-6.1-terra", "GPT-6.1-Terra"),
    named("gpt-5.6-terra", "GPT-5.6-Terra"),
    named("gpt-6-luna", "GPT-6-Luna"),
    named("gpt-5.6-luna", "GPT-5.6-Luna"),
  ];
  // The list cli-funnel 0.9.1 gives.
  const claudeList = [
    named("claude-fable-5-2", "Claude Fable 5.2"),
    named("claude-fable-5-1", "Claude Fable 5.1"),
    named("claude-opus-5-5", "Claude Opus 5.5"),
    named("claude-opus-4-6", "Claude Opus 4.6"),
    named("claude-sonnet-5-5", "Claude Sonnet 5.5"),
    named("claude-sonnet-5", "Claude Sonnet 5"),
    named("claude-haiku-5-5", "Claude Haiku 5.5"),
    named("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
  ];
  const names = (list: ModelOption[]) => list.map((m) => modelName(m));

  it("keeps GPT-6.1 Sol, GPT-6 Astra, GPT-6.1 Terra and GPT-6 Luna", () => {
    expect(names(newestOfEachFamily(codexList))).toEqual(["GPT-6.1 Sol", "GPT-6 Astra", "GPT-6.1 Terra", "GPT-6 Luna"]);
  });

  it("keeps Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5", () => {
    expect(names(newestOfEachFamily(claudeList))).toEqual([
      "Claude Fable 5.2",
      "Claude Opus 5.5",
      "Claude Sonnet 5.5",
      "Claude Haiku 5.5",
    ]);
  });

  it("keeps the model that is picked, even when it's older", () => {
    expect(names(newestOfEachFamily(claudeList, "claude-opus-4-6"))).toContain("Claude Opus 4.6");
    expect(newestOfEachFamily(claudeList, "claude-opus-4-6")).toHaveLength(5);
  });

  it("keeps a name with no version, and works from the id when there's no name", () => {
    const list = [named("mini", "Mini"), named("other", "Mini"), model("gpt-6-luna"), model("gpt-5.6-luna")];
    expect(newestOfEachFamily(list).map((m) => m.id)).toEqual(["mini", "other", "gpt-6-luna"]);
  });
});

describe("the choice a task started on", () => {
  const codex = (model: string) => ({ provider: "codex" as const, model });
  it("is the middle choice when nothing was picked, and the preset when one was", () => {
    expect(choiceOf(undefined, codex("gpt-6.1-terra"))).toBe("balanced");
    expect(choiceOf({ preset: "thorough" }, { provider: "claude", model: "claude-sonnet-5-5" })).toBe("thorough");
  });

  it("is custom for a model picked from the list, unless it fell back to the middle choice", () => {
    const opus = { ai: "claude", model: "claude-opus-5-5", effort: "high" } as const;
    expect(choiceOf(opus, { provider: "claude", model: "claude-opus-5-5" })).toBe("custom");
    expect(choiceOf({ ...opus, model: "claude-opus-4-6" }, codex("gpt-6.1-terra"))).toBe("balanced");
  });

  it("counts the AI too: a key pick that fell back to the subscription's same model is the middle choice", () => {
    const keyPick = { ai: "key", model: "gpt-6.1-terra", effort: "medium" } as const;
    expect(choiceOf(keyPick, { provider: "codex", auth: "key", model: "gpt-6.1-terra" })).toBe("custom");
    expect(choiceOf(keyPick, codex("gpt-6.1-terra"))).toBe("balanced");
  });
});

describe("a model's name from its id", () => {
  it.each([
    ["gpt-6.1-terra", "GPT-6.1 Terra"],
    ["gpt-6-luna", "GPT-6 Luna"],
    ["claude-opus-5-5", "Claude Opus 5.5"],
    ["claude-fable-5-2", "Claude Fable 5.2"],
    ["claude-sonnet-5", "Claude Sonnet 5"],
    ["claude-haiku-4-5-20251001", "Claude Haiku 4.5"],
    ["o4-mini", "o4-mini"],
  ])("names %s as %s", (id, name) => {
    expect(nameFromId(id)).toBe(name);
  });
});

describe("choiceFromModel", () => {
  it("names the choice a task ran on, also for tasks saved before the choice changed", () => {
    expect(choiceFromModel("gpt-6.1-terra", "medium")).toBe("balanced");
    // Balanced ran at high in 0.0.24-dev only.
    expect(choiceFromModel("gpt-6.1-terra", "high")).toBe("balanced");
    expect(choiceFromModel("gpt-6.1-terra", "low")).toBe("custom");
  });
});
