import type { ActivityKind } from "../../shared/model";

/** One line of what the agent is doing, without the time: the runner stamps it. */
export interface ActivityLine {
  kind: ActivityKind;
  target?: string;
}

const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Files a person would recognise, so a command that touches one names it. */
const EXTENSIONS = "docx|xlsx|pptx|pdf|txt|md|csv|json|html|doc|xls|ppt|odt|ods|png|jpe?g";
/** A path in quotes, which may hold spaces: everything up to the closing quote is the path. */
const QUOTED_DOCUMENT = new RegExp(`"([^"\\n]*\\.(?:${EXTENSIONS}))"|'([^'\\n]*\\.(?:${EXTENSIONS}))'`, "i");
/** A bare path, whose spaces or quotes, if any, are escaped with a backslash. It ends at a shell operator. */
const DOCUMENT = new RegExp(`(?:[^\\s"'\`\\\\;&|<>()]|\\\\.)+\\.(?:${EXTENSIONS})\\b`, "i");

/** The first document a command names, quoted or not, by its file name, or undefined. */
function documentIn(command: string): string | undefined {
  const quoted = QUOTED_DOCUMENT.exec(command);
  const bare = DOCUMENT.exec(command);
  const path =
    quoted && (!bare || quoted.index <= bare.index) ? (quoted[1] ?? quoted[2]) : bare?.[0].replace(/\\(.)/g, "$1");
  return path === undefined ? undefined : fileName(path);
}
/** A skill or guide being read: its folder names it. */
const SKILL_FILE = /([^\s"'`/\\]+)[/\\]SKILL\.md\b/;

/**
 * The name a skill read is recorded under: its folder's, or @ and the folder's for a guide in Tost Work's own
 * `builtIns` folder, as those guides' ids are, so a user's skill named "word" isn't taken for the Word guide.
 */
function skillRead(text: string, builtIns?: string): string | undefined {
  const match = SKILL_FILE.exec(text);
  if (!match?.[1]) return undefined;
  const at = match.index;
  const dir = builtIns?.replace(/[/\\]+$/, "");
  const guide = dir && text.slice(Math.max(0, at - dir.length - 1), at - 1) === dir;
  return guide ? `@${match[1]}` : match[1];
}
const READS = /(^|[\s;&|(])(cat|sed|head|tail|less|more|rg|grep|wc|nl|file|pdftotext|xxd)\s/;
const LISTS = /^(\s*(ls|find|tree|pwd|stat)\b[^;&|]*([;&|]+|$))+$/;
const OFFICE_READS = /officecli\s+(view|get|query|validate|check|info)\b/;
const OFFICE_WRITES = /officecli\s+(create|add|set|remove|move|merge|batch|import)\b/;

/** The command a shell runs, out of Codex's `/bin/bash -lc "…"` wrapper. */
function innerCommand(command: string): string {
  const wrapped = /^\S*(ba|z)?sh\s+-l?c\s+(["'])([\s\S]*)\2\s*$/.exec(command.trim());
  return (wrapped?.[3] ?? command).replace(/\\(["\\$`])/g, "$1");
}

/** What a shell command is doing, in a word and a file: reading, writing a document, listing the folder, or running. */
export function commandActivity(command: string, builtIns?: string): ActivityLine {
  const inner = innerCommand(command);
  const skill = skillRead(inner, builtIns);
  if (skill) return { kind: "skill", target: skill };
  const doc = documentIn(inner);
  if (doc && OFFICE_WRITES.test(inner)) return { kind: "edit", target: doc };
  if (doc && (OFFICE_READS.test(inner) || READS.test(` ${inner}`))) return { kind: "read", target: doc };
  if (LISTS.test(inner)) return { kind: "folder" };
  if (doc) return { kind: "work", target: doc };
  return { kind: "command" };
}

/** The host of a web address, which is how people name a site. */
const host = (url: unknown) => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * One line for a tool call by Codex or Claude Code, from cli-funnel's `tool.start`, or null for calls that say nothing
 * to the user: the plan tool, and Tost Work's own tools, whose questions, approvals and review show on their own.
 */
export function activityOf(name: string, input: unknown, builtIns?: string): ActivityLine | null {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    // Claude Code
    case "Read": {
      const path = text(i.file_path);
      const skill = path && skillRead(path, builtIns);
      if (skill) return { kind: "skill", target: skill };
      return path ? { kind: "read", target: fileName(path) } : { kind: "read" };
    }
    case "Write":
      return { kind: "write", target: text(i.file_path) && fileName(String(i.file_path)) };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return {
        kind: "edit",
        target: text(i.file_path ?? i.notebook_path) && fileName(String(i.file_path ?? i.notebook_path)),
      };
    case "Glob":
    case "Grep":
      return { kind: "search-files" };
    case "WebSearch":
    case "web_search":
      return { kind: "web", target: text(i.query) };
    case "WebFetch":
      return { kind: "page", target: host(i.url) };
    case "Bash":
    case "command":
      return commandActivity(String(i.command ?? ""), builtIns);
    // Codex
    case "file_change": {
      const changes = Array.isArray(i.changes) ? (i.changes as { path?: unknown; kind?: unknown }[]) : [];
      const first = changes[0];
      if (!first || typeof first.path !== "string") return null;
      const kind = typeof first.kind === "string" ? first.kind : (first.kind as { type?: string } | undefined)?.type;
      return { kind: kind === "add" ? "write" : "edit", target: fileName(first.path) };
    }
  }
  if (/make_pdf$/.test(name)) return { kind: "pdf" };
  return null;
}
