/**
 * How a task's AI is chosen: three plain choices, each with a model and reasoning level behind it, or a model picked
 * from the full list. The main process starts tasks from this, and the interface shows the same result in the picker.
 */

import { type AgentProvider, AIS, type AiId } from "./model";

/** The three plain choices, from quickest to most thorough. */
export type Preset = "fast" | "balanced" | "thorough";
export const PRESETS: Preset[] = ["fast", "balanced", "thorough"];

/**
 * What a new task runs on: one of the three choices on the default AI, or a model picked from the full list, which
 * can be on another AI.
 */
export type ModelPick = { preset: Preset } | { ai: AiId; model: string; effort: string };
export const DEFAULT_PICK = { preset: "balanced" } as const satisfies ModelPick;

/** A model an AI offers, as the picker needs it. */
export interface ModelOption {
  id: string;
  name: string;
  /** The reasoning levels it offers, in cli-funnel's words ("low", "medium"…). */
  efforts: string[];
  defaultEffort?: string;
}

/** The models of one AI that can run tasks. */
export interface AiModels {
  ai: AiId;
  provider: AgentProvider;
  models: ModelOption[];
}

/** What the picker needs from the main process. */
export interface ModelChoices {
  /** The AI the three choices run on: the default from Settings, or the first one signed in. */
  ai: AiId;
  provider: AgentProvider;
  /** Every AI that can run a task, the default one included. */
  lists: AiModels[];
}

/** The reasoning levels the picker offers, lowest first. Others, such as "ultra", are left out. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** What each choice runs on (Tost's decision, #196). */
export const PRESET_MODELS: Record<Preset, Record<AgentProvider, { model: string; effort: string }>> = {
  fast: {
    codex: { model: "gpt-6-luna", effort: "medium" },
    claude: { model: "claude-haiku-5-5", effort: "medium" },
  },
  balanced: {
    codex: { model: "gpt-6.1-terra", effort: "medium" },
    claude: { model: "claude-sonnet-5-5", effort: "high" },
  },
  thorough: {
    codex: { model: "gpt-6.1-sol", effort: "high" },
    claude: { model: "claude-opus-5-5", effort: "high" },
  },
};

/**
 * Claude's default model, and the stand-in for Opus. Sonnet rather than Opus, because a Pro plan's limits run out
 * quickly on Opus and most office work doesn't need it.
 */
export const CLAUDE_MODEL = "claude-sonnet-5-5";

export interface Resolved {
  model: ModelOption;
  effort: string;
}

/**
 * The offered level nearest to the one wanted; on a tie, the lower one, which uses the subscription's limits more
 * slowly. Levels outside EFFORTS are never picked. Undefined when the model offers none of them.
 */
export function nearestEffort(wanted: string, offered: string[]): string | undefined {
  const known = EFFORTS.filter((e) => offered.includes(e));
  const levels: readonly string[] = EFFORTS;
  const target = levels.indexOf(wanted);
  if (target < 0) return known[0];
  return known.reduce<string | undefined>(
    (best, e) =>
      best === undefined || Math.abs(levels.indexOf(e) - target) < Math.abs(levels.indexOf(best) - target) ? e : best,
    undefined,
  );
}

/** A model at the level wanted, or at the nearest one it offers; its own default when it offers none of the usual. */
function withEffort(model: ModelOption, wanted: string): Resolved {
  return { model, effort: nearestEffort(wanted, model.efforts) ?? model.defaultEffort ?? model.efforts[0] ?? wanted };
}

/**
 * What a new task runs on when nothing is chosen: Codex's first listed model, or Claude's Sonnet, at the model's own
 * default level, else medium. Null when the AI lists no models.
 */
export function providerDefault(provider: AgentProvider, models: ModelOption[]): Resolved | null {
  // Codex lists its recommended model first. Claude's list starts with the largest model, so it's picked by name.
  const model = (provider === "claude" && models.find((m) => m.id === CLAUDE_MODEL)) || models[0];
  if (!model) return null;
  const medium = model.efforts.includes("medium") ? "medium" : undefined;
  return { model, effort: model.defaultEffort ?? medium ?? model.efforts[0] ?? "medium" };
}

/**
 * The model and level behind a choice on one AI, from the models it offers. A level the model doesn't offer becomes
 * the nearest one it does. A model that isn't offered, such as Opus on a plan without it, becomes Sonnet at
 * "xhigh" for Claude's thorough choice, and otherwise the AI's default. Null when the AI lists no models.
 */
export function resolvePreset(preset: Preset, provider: AgentProvider, models: ModelOption[]): Resolved | null {
  const want = PRESET_MODELS[preset][provider];
  const model = models.find((m) => m.id === want.model);
  if (model) return withEffort(model, want.effort);
  const sonnet = preset === "thorough" && provider === "claude" && models.find((m) => m.id === CLAUDE_MODEL);
  if (sonnet) return withEffort(sonnet, "xhigh");
  return providerDefault(provider, models);
}

/** A pick worked out against the models on offer: the AI, agent, model and level a task would run on. */
export interface Picked extends Resolved {
  ai: AiId;
  provider: AgentProvider;
}

/**
 * What a pick runs on. A model picked from the full list runs on the AI it was picked on, at the nearest level that
 * model offers. A choice of the three, or a pick whose AI or model is no longer on offer, runs on the default AI as the
 * middle choice. Null when the default AI lists no models.
 */
export function pickOn(pick: ModelPick, choices: ModelChoices): Picked | null {
  if ("ai" in pick) {
    const list = choices.lists.find((l) => l.ai === pick.ai);
    const model = list?.models.find((m) => m.id === pick.model);
    if (list && model)
      return {
        ai: list.ai,
        provider: list.provider,
        model,
        effort: nearestEffort(pick.effort, model.efforts) ?? model.defaultEffort ?? pick.effort,
      };
  }
  const list = choices.lists.find((l) => l.ai === choices.ai);
  const resolved = list && resolvePreset("preset" in pick ? pick.preset : "balanced", list.provider, list.models);
  return list && resolved ? { ai: list.ai, provider: list.provider, ...resolved } : null;
}

/** Models for trying the picker without an account (the fake engine, and the interface tests). */
export const SAMPLE_CHOICES: ModelChoices = (() => {
  const model = (id: string, name: string, efforts = ["low", "medium", "high", "xhigh", "max"]): ModelOption => ({
    id,
    name,
    efforts,
    defaultEffort: "medium",
  });
  return {
    ai: "chatgpt",
    provider: "codex",
    lists: [
      {
        ai: "chatgpt",
        provider: "codex",
        models: [
          model("gpt-6.1-terra", "GPT-6.1-Terra"),
          model("gpt-6-luna", "GPT-6-Luna"),
          model("gpt-6.1-sol", "GPT-6.1-Sol"),
        ],
      },
      {
        ai: "claude",
        provider: "claude",
        models: [
          model("claude-sonnet-5-5", "Claude Sonnet 5.5"),
          model("claude-haiku-5-5", "Claude Haiku 5.5"),
          model("claude-opus-5-5", "Claude Opus 5.5"),
        ],
      },
    ],
  };
})();

/** A model's name for the picker: "GPT-6.1-Terra" reads "GPT-6.1 Terra", and "Claude Sonnet 5.5" stays as it is. */
export const modelName = (model: Pick<ModelOption, "id" | "name">): string =>
  (model.name || model.id).replace(/^(GPT-[\d.]+)-/, "$1 ");

/** A model's family and version, from its display name: "GPT-6.1 Sol" is family "GPT Sol", version [6, 1]. */
function familyOf(model: Pick<ModelOption, "id" | "name">): { family: string; version: number[] } {
  const name = modelName(model);
  const found = /[-\s]?(\d+(?:[.-]\d+)*)/.exec(name);
  if (!found?.[1]) return { family: name, version: [] };
  const family = `${name.slice(0, found.index)} ${name.slice(found.index + found[0].length)}`
    .replace(/\s+/g, " ")
    .trim();
  return { family, version: found[1].split(/[.-]/).map(Number) };
}

/** Compares version numbers part by part, a missing part counting as 0: 6.1 is above 6, and 6 is above 5.6. */
function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The newest model of each family, for the picker's full list: "GPT-6 Sol" and "GPT-5.6 Sol" are one family, and only
 * the higher version stays. A name with no version number always stays, and so does the model in `keepId`, such as the
 * one picked earlier, even when it's older. The order is kept. This only filters what the picker shows: the engine
 * still runs any model it's given.
 */
export function newestOfEachFamily<T extends Pick<ModelOption, "id" | "name">>(models: T[], keepId?: string): T[] {
  const newest = new Map<string, number[]>();
  const parsed = models.map((m) => ({ m, ...familyOf(m) }));
  for (const { family, version } of parsed) {
    const best = newest.get(family);
    if (version.length > 0 && (!best || compareVersions(version, best) > 0)) newest.set(family, version);
  }
  return parsed
    .filter(({ m, family, version }) => {
      const best = newest.get(family);
      return m.id === keepId || version.length === 0 || (best !== undefined && compareVersions(version, best) === 0);
    })
    .map(({ m }) => m);
}

/** What a task was started on, as the user chose it: one of the three choices, or a model picked from the full list. */
export type Choice = Preset | "custom";

/** What a task got to run on: the agent, whether through the course key, and the model. */
export interface RanOn {
  provider: AgentProvider;
  auth?: "account" | "key";
  model: string;
}

/**
 * The choice a task started on, from the pick and what it got. No pick means the middle choice, as the engine reads
 * it. A model picked from the list that no longer runs as picked starts on the middle choice instead (see `defaults`
 * in the engine), so that is what the task says. The AI counts as well as the model: the course key and a ChatGPT
 * subscription share Codex's model ids.
 */
export function choiceOf(pick: ModelPick | undefined, ran: RanOn): Choice {
  if (!pick) return DEFAULT_PICK.preset;
  if ("preset" in pick) return pick.preset;
  const ai: AiId = ran.auth === "key" ? "key" : ran.provider === "claude" ? "claude" : "chatgpt";
  return pick.ai === ai && pick.model === ran.model ? "custom" : DEFAULT_PICK.preset;
}

/**
 * The choice a task from before choices were kept most likely ran on: the one whose model and level it ran on, or
 * "custom" for any other model or level.
 */
export function choiceFromModel(model: string, effort: string): Choice {
  const preset = PRESETS.find((p) =>
    Object.values(PRESET_MODELS[p]).some((m) => m.model === model && m.effort === effort),
  );
  return preset ?? "custom";
}

/**
 * A model's name from its id alone, for a task whose model list isn't at hand: "gpt-6.1-terra" is "GPT-6.1 Terra",
 * "claude-opus-5-5" is "Claude Opus 5.5" and "claude-haiku-4-5-20251001" is "Claude Haiku 4.5". Any other id shows
 * as it is.
 */
export function nameFromId(id: string): string {
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const gpt = /^gpt-(\d+(?:\.\d+)*)-([a-z][a-z-]*)$/.exec(id);
  if (gpt?.[1] && gpt[2]) return `GPT-${gpt[1]} ${gpt[2].split("-").map(cap).join(" ")}`;
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (claude?.[1] && claude[2]) return `Claude ${cap(claude[1])} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  return id;
}

/** Whether a value from outside is a pick this app could have made. */
export function isModelPick(v: unknown): v is ModelPick {
  if (typeof v !== "object" || v === null) return false;
  const pick = v as Record<string, unknown>;
  if ("preset" in pick) return PRESETS.includes(pick.preset as Preset);
  return (
    AIS.includes(pick.ai as AiId) &&
    typeof pick.model === "string" &&
    pick.model.length > 0 &&
    pick.model.length <= 200 &&
    typeof pick.effort === "string" &&
    pick.effort.length > 0 &&
    pick.effort.length <= 40
  );
}
