import { isAbsolute } from "node:path";
import type { Level, Settings } from "../shared/model";

/** Checks for values that come from the interface, because IPC is a trust boundary. */
export const text = (v: unknown, field: string, max = 20_000): string => {
  if (typeof v !== "string") throw new Error(`${field} must be text`);
  if (v.length > max) throw new Error(`${field} is too long`);
  return v;
};

/** Absolute paths only: a relative or empty path would resolve against wherever the app happens to run. */
export const absolutePath = (v: unknown, field: string): string => {
  const path = text(v, field, 4096);
  if (!isAbsolute(path)) throw new Error(`${field} must be an absolute path`);
  return path;
};

export const paths = (v: unknown, field: string, max = 20): string[] => {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error(`${field} must be a list`);
  if (v.length > max) throw new Error(`${field} can have at most ${max} files`);
  return v.map((p) => absolutePath(p, field));
};

const LEVELS: Level[] = ["beginner", "intermediate", "advanced", "expert"];

/** Only the known settings, each with the right type. Anything else is refused rather than stored. */
export const settingsPatch = (v: unknown): Partial<Settings> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("settings must be an object");
  const input = v as Record<string, unknown>;
  const patch: Partial<Settings> = {};
  for (const key of Object.keys(input)) {
    const value = input[key];
    if (key === "name") patch.name = text(value, "name", 80).trim();
    else if (key === "work") patch.work = text(value, "work", 300).trim();
    else if (key === "notes") patch.notes = text(value, "notes", 4000).trim();
    else if (key === "level") {
      if (!LEVELS.includes(value as Level)) throw new Error("level must be one of the four levels");
      patch.level = value as Level;
    } else if (key === "language") {
      if (value !== null && value !== "en" && value !== "it") throw new Error("language must be en, it or null");
      patch.language = value;
    } else if (key === "setupDone") {
      if (typeof value !== "boolean") throw new Error("setupDone must be true or false");
      patch.setupDone = value;
    } else throw new Error(`Unknown setting: ${key}`);
  }
  return patch;
};
