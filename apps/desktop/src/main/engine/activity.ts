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

/** The path of the first document a command names, quoted or not, or undefined. */
function documentIn(command: string): string | undefined {
  const quoted = QUOTED_DOCUMENT.exec(command);
  const bare = DOCUMENT.exec(command);
  return quoted && (!bare || quoted.index <= bare.index) ? (quoted[1] ?? quoted[2]) : bare?.[0].replace(/\\(.)/g, "$1");
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
/**
 * Where Claude Code saves a command's output when it's too long to read at once, under the home Tost Work gives it
 * (agentHomes.ts): agents/claude/projects/<folder>/<session>/tool-results/b1x2y3z4w.txt. Reading it back is reading
 * the command's output, and its name means nothing.
 */
const SAVED_OUTPUT = /[/\\]agents[/\\]claude[/\\]projects[/\\][^/\\]+[/\\][^/\\]+[/\\]tool-results[/\\][^/\\]+$/;
/** The same folder anywhere in a command, which may name other files and patterns before it. */
const SAVED_OUTPUT_IN = /[/\\]agents[/\\]claude[/\\]projects[/\\][^/\\\s"']+[/\\][^/\\\s"']+[/\\]tool-results[/\\]/g;
/** The text before a path ends in a redirection to it: `> "/a b/c`, `>> /a/c`. */
const REDIRECTED = />\s*(?:"[^"]*|'[^']*|[^\s"']*)$/;

const READS = /(^|[\s;&|(])(cat|sed|awk|head|tail|less|more|rg|grep|wc|nl|file|pdftotext|xxd)\s/;
const LISTS = /^(\s*(ls|find|tree|pwd|stat)\b[^;&|]*([;&|]+|$))+$/;
const OFFICE_READS = /officecli\s+(view|get|query|validate|check|info)\b/;
const OFFICE_WRITES = /officecli\s+(create|add|set|remove|move|merge|batch|import)\b/;

/** A command split at ; && || and | outside quotes, so `grep 'a|b' file` stays one part. */
function commandParts(command: string): string[] {
  const parts: string[] = [];
  let part = "";
  let quote: string | undefined;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    const next = command[i + 1];
    if (c === "\\" && quote !== "'") {
      part += c + (next ?? "");
      i++;
    } else if (quote) {
      if (c === quote) quote = undefined;
      part += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      part += c;
    } else if (c === ";" || c === "|" || (c === "&" && next === "&")) {
      parts.push(part);
      part = "";
      if (next === c) i++;
    } else part += c;
  }
  parts.push(part);
  return parts;
}

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
  const reads = (part: string) => OFFICE_READS.test(part) || READS.test(` ${part}`);
  const read = reads(inner);
  // A part of the command that reads and names the saved output, other than as the place it writes to.
  const readsSaved = commandParts(inner).some(
    (part) => reads(part) && [...part.matchAll(SAVED_OUTPUT_IN)].some((m) => !REDIRECTED.test(part.slice(0, m.index))),
  );
  if (readsSaved) return { kind: "output" };
  const path = documentIn(inner);
  // The output's file name means nothing, so a command that does something else with it is just a command.
  if (path && SAVED_OUTPUT.test(path)) return { kind: "command" };
  const doc = path && fileName(path);
  if (doc && OFFICE_WRITES.test(inner)) return { kind: "edit", target: doc };
  if (doc && read) return { kind: "read", target: doc };
  if (LISTS.test(inner)) return { kind: "folder" };
  if (doc) return { kind: "work", target: doc };
  return { kind: "command" };
}

/** The longest note kept in the activity: a note is a line or two, and the log isn't the place for a whole answer. */
export const NOTE_MAX = 400;

/** What the agent wrote between two steps, on one line, or undefined when it wrote nothing. */
export function noteText(said: string): string | undefined {
  const line = said.replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  return line.length > NOTE_MAX ? `${line.slice(0, NOTE_MAX - 1).trimEnd()}…` : line;
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
      if (path && SAVED_OUTPUT.test(path)) return { kind: "output" };
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
    // A subagent, which Claude Code calls Agent, and Task before that: what it was given to do.
    case "Agent":
    case "Task":
      return { kind: "helper", target: text(i.description) };
    // Codex: starting a subagent, and waiting for the ones it started. Neither names the work in a few words.
    case "agent:spawnAgent":
      return { kind: "helper" };
    case "agent:wait":
      return { kind: "helper-wait" };
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
