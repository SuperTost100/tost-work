import { isAbsolute } from "node:path";
import type { NewTaskInput } from "../shared/api";
import {
  AIS,
  type AiId,
  BOARD_GROUPS,
  BOARD_VIEWS,
  type BoardGroup,
  type BoardView,
  BRIEF_MAX,
  LEVELS,
  type Level,
  LOGIN_OPENS,
  type LoginOpens,
  NOTES_MAX,
  NOTIFY_KINDS,
  NOTIFY_LEVELS,
  type NotifyKind,
  type NotifyLevel,
  type Project,
  SECTION_LEVEL,
  type SectionKey,
  type Settings,
  TEXT_SIZES,
  type TextSize,
  THEMES,
  type Theme,
} from "../shared/model";

/** Checks for values that come from the interface, because IPC is a trust boundary. */
export const text = (v: unknown, field: string, max = 20_000): string => {
  if (typeof v !== "string") throw new Error(`${field} must be text`);
  if (v.length > max) throw new Error(`${field} is too long`);
  return v;
};

/** Absolute paths only: a relative or empty path would resolve against wherever the app happens to run. */
/** Text kept on one line, such as a project's description, which shows and is edited as a single line. */
export const oneLine = (v: string): string => v.replace(/\s+/g, " ").trim();

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

/** A new task's brief, project and files, checked the same way whether it starts now or is saved for later. */
export const taskInput = (v: unknown): Required<NewTaskInput> => {
  const input = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const brief = text(input.brief, "brief", BRIEF_MAX).trim();
  if (!brief) throw new Error("A task needs a brief");
  const projectId = input.projectId == null ? null : text(input.projectId, "projectId", 100);
  return { brief, projectId, attachments: paths(input.attachments, "attachments") };
};

/**
 * A new or edited task's brief, project and files, with the folder it works in: its project's, or for a task without
 * a project a temporary folder of its own, as a quick edit has.
 */
export const placedTask = (
  v: unknown,
  projectOf: (id: string) => Project | undefined,
  quickFolder: () => string,
): Required<NewTaskInput> & { workdir: string } => {
  const { brief, projectId, attachments } = taskInput(v);
  const project = projectId ? projectOf(projectId) : undefined;
  if (projectId && !project) throw new Error("That project doesn't exist");
  return { brief, projectId, attachments, workdir: project?.folder ?? quickFolder() };
};

/** Only the known settings, each with the right type. Anything else is refused rather than stored. */
export const settingsPatch = (v: unknown): Partial<Settings> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("settings must be an object");
  const input = v as Record<string, unknown>;
  const patch: Partial<Settings> = {};
  for (const key of Object.keys(input)) {
    const value = input[key];
    if (key === "name") patch.name = text(value, "name", 80).trim();
    else if (key === "work") patch.work = text(value, "work", 300).trim();
    else if (key === "notes") patch.notes = text(value, "notes", NOTES_MAX).trim();
    else if (key === "level") {
      if (!LEVELS.includes(value as Level)) throw new Error("level must be one of the four levels");
      patch.level = value as Level;
    } else if (key === "language") {
      if (value !== null && value !== "en" && value !== "it") throw new Error("language must be en, it or null");
      patch.language = value;
    } else if (key === "sections") {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("sections must be an object");
      const sections: Settings["sections"] = {};
      for (const [name, on] of Object.entries(value)) {
        if (!Object.hasOwn(SECTION_LEVEL, name)) throw new Error(`Unknown section: ${name}`);
        if (typeof on !== "boolean") throw new Error(`The ${name} section must be on or off`);
        sections[name as SectionKey] = on;
      }
      patch.sections = sections;
    } else if (key === "textSize") {
      if (!TEXT_SIZES.includes(value as TextSize)) throw new Error("textSize must be small, normal or large");
      patch.textSize = value as TextSize;
    } else if (key === "theme") {
      if (!THEMES.includes(value as Theme)) throw new Error("theme must be light, dark or system");
      patch.theme = value as Theme;
    } else if (key === "defaultAi") {
      if (value !== null && !AIS.includes(value as AiId))
        throw new Error("defaultAi must be chatgpt, claude, key or null");
      patch.defaultAi = value as AiId | null;
    } else if (
      key === "notifications" ||
      key === "openAtLogin" ||
      key === "stayInMenuBar" ||
      key === "sidebarHidden" ||
      key === "debug"
    ) {
      if (typeof value !== "boolean") throw new Error(`${key} must be true or false`);
      patch[key] = value;
    } else if (key === "loginOpens") {
      if (!LOGIN_OPENS.includes(value as LoginOpens)) throw new Error("loginOpens must be menuBar or window");
      patch.loginOpens = value as LoginOpens;
    } else if (key === "notify") {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("notify must be an object");
      const notify: Partial<Settings["notify"]> = {};
      for (const [kind, level] of Object.entries(value)) {
        if (!NOTIFY_KINDS.includes(kind as NotifyKind)) throw new Error(`Unknown notification: ${kind}`);
        if (!NOTIFY_LEVELS.includes(level as NotifyLevel)) throw new Error(`${kind} must be off, quiet or normal`);
        notify[kind as NotifyKind] = level as NotifyLevel;
      }
      patch.notify = notify as Settings["notify"];
    } else if (key === "boardView") {
      if (!BOARD_VIEWS.includes(value as BoardView)) throw new Error("boardView must be list or columns");
      patch.boardView = value as BoardView;
    } else if (key === "boardGroup") {
      if (!BOARD_GROUPS.includes(value as BoardGroup)) throw new Error("boardGroup must be status or project");
      patch.boardGroup = value as BoardGroup;
    } else if (key === "setupDone") {
      if (typeof value !== "boolean") throw new Error("setupDone must be true or false");
      patch.setupDone = value;
    } else throw new Error(`Unknown setting: ${key}`);
  }
  return patch;
};
