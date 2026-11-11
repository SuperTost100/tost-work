import { randomUUID } from "node:crypto";
import { lstat, opendir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { ApprovalDecision, ApprovalRequest, Funnel } from "cli-funnel";
import { translate, trashName } from "../../shared/i18n";
import type {
  AgentProvider,
  AiId,
  Decision,
  EngineEvent,
  FileStamp,
  Job,
  KeptCopy,
  KeyVendor,
  Review,
  Skill,
  Task,
} from "../../shared/model";
import { KEY_PROVIDER, type Level, PROVIDER_OF } from "../../shared/model";
import {
  type AiModels,
  DEFAULT_PICK,
  EFFORTS,
  effortsFor,
  limitModels,
  type ModelChoices,
  type ModelOption,
  type ModelPick,
  nearestEffort,
  pickOn,
} from "../../shared/modelChoice";
import { type SandboxReadiness, sandboxFor } from "../../shared/sandbox";
import { checkClaudeFolder } from "../claudeFolder";
import { HOOK_TOKEN_ENV, HOOK_URL_ENV } from "../codexHook";
import type { TaskLog } from "../debugLog";
import { freeName, inside } from "../files";
import type { HookAnswer, ToolHandler } from "../mcp/server";
import { SandboxNotReady, UserError } from "../userError";
import { activityOf, noteText } from "./activity";
import { gateRequest, hookCall, opensShell, pathsFor } from "./codexGate";
import {
  commandWrites,
  FileNames,
  heredocs,
  MAX_DEPTH,
  namesOf,
  onlyReads,
  parse,
  payloadOf,
  RUNS_NEXT,
  SHELLS,
  scriptsNamed,
  UNWRAPS,
  type Word,
  writtenPaths,
} from "./commands";
import type { Engine, RunContext } from "./engine";
import { instructionsFor } from "./instructions";
import { OVERWRITE_NOTE, withFiles } from "./runner";

/**
 * What ask_user and request_approval tell the agent. They return at once: Codex hands a tool that runs longer than
 * about 30 seconds back to the model, which then guesses or gives up. So the agent ends its turn, and the user's
 * answer or decision starts the next one.
 */
/** What Codex and Claude Code pass on from their subagents: the text for the activity, the calls for the debug view. */
const SUBAGENTS = { forwardSubagentText: true, forwardSubagentTools: true };

/**
 * Claude Code's built-in tools that a Tost Work task never uses. Their descriptions went with every request: about
 * 28,000 of a new task's 41,000 tokens, most of it the claude.ai Artifact tools (#194). Off, a task starts at about
 * 12,000. The ones a task needs stay on: files, commands, the web, subagents, and TaskCreate and TaskUpdate, which
 * cli-funnel turns into the task's steps. Tost Work asks the user through its own tools, not AskUserQuestion. A name
 * an older Claude Code doesn't have is ignored.
 */
export const UNUSED_CLAUDE_TOOLS = [
  "Artifact",
  "ArtifactComments",
  "ArtifactData",
  "AskUserQuestion",
  "CronCreate",
  "CronDelete",
  "CronList",
  "DesignSync",
  "EnterPlanMode",
  "ExitPlanMode",
  "EnterWorktree",
  "ExitWorktree",
  "ListAgents",
  "Monitor",
  "NotebookEdit",
  "PushNotification",
  "RemoteTrigger",
  "ReportFindings",
  "ScheduleWakeup",
  "SendMessage",
  "Skill",
  "TaskStop",
  "ToolSearch",
  "Workflow",
];

/** A sandbox with nothing missing, for an engine that isn't told how to check. */
const READY: SandboxReadiness = { ready: true, missing: [], distro: null, appArmorRestrictsUserns: null };

const END_TURN =
  "It's in front of the user now. End your turn here: don't do anything else and don't repeat it. Their reply arrives as your next message.";

/** What request_approval tells the agent: the card asks, so the agent's last words don't need to. */
const APPROVAL_END = `${END_TURN} The card already asks for their decision, so don't write that you need their approval.`;

/** What request_approval says about files the agent may change without asking. */
const noApprovalNeeded = (paths: string[]) =>
  `No approval is needed for ${paths.join(", ")}: this task made ${paths.length === 1 ? "it" : "them"}, or the user already let you replace ${paths.length === 1 ? "it" : "them"} in this turn. Go ahead without asking. Ask only before replacing a file that was in the folder before the task began.`;

/**
 * The most entries a folder listing reads. A bigger folder gets no listing, and then every file in it counts as there
 * before the task, as it did before listings.
 */
const LISTING_MAX = 200_000;
/**
 * The most files a task keeps as its own. Past that, the rest ask before they're changed in a later run.
 * shortcut: a task that unpacks thousands of files asks again for most of them; raise it if a real task does that.
 */
const OWN_MAX = 2_000;

/**
 * The biggest file Tost Work copies on its own before a command that names it. Documents, sheets, decks and PDFs are
 * almost always smaller, and 50 MB copies in a fraction of a second on an SSD. A bigger file, such as a video or an
 * archive, would hold the command up for seconds and fill the disk with a copy that is usually dropped, so the
 * overwrite card asks about it instead.
 */
export const COPY_MAX = 50 * 1024 * 1024;
/** The biggest script file in the task's folder whose text is read for the files it names. */
const SCRIPT_MAX = 256 * 1024;

/**
 * How a path is looked up in a listing: one form for the spellings a Mac or Windows disk takes as the same name,
 * whatever their case or Unicode form. A Linux disk tells those apart, and then two names count as one, so a new
 * file whose name differs only in case from an older one is taken as the older one and asks first.
 */
const pathKey = (path: string) => path.normalize("NFC").toLowerCase();

/** One entry of a folder listing: the path as the task names it, and for a file how it looked then. */
interface Listed {
  path: string;
  /** The file's modification time and size; null for a folder, or a file that couldn't be read. */
  stamp: FileStamp | null;
}

/** How many files a listing stamps at once. One at a time, 30,000 files take a second; 64 at a time, a third of it. */
const STAMP_BATCH = 64;

/**
 * Every file and folder in `folder` and its subfolders, by the `pathKey` of its real path, each with the path as the
 * task names it and, for a file, its modification time and size. Null when part of the folder can't be read, it holds
 * more than LISTING_MAX entries, or Stop comes first: then nothing counts as made by the task from the listing, and
 * the check at the run's end lists no change. On an SSD (Linux, ext4) 30,000 files took 175 ms to list by name and
 * 305 ms with their stamps.
 */
async function listFolder(folder: string, log: TaskLog, signal?: AbortSignal): Promise<Map<string, Listed> | null> {
  try {
    const real = await realpath(folder);
    const entries = new Map<string, Listed>();
    const files: Listed[] = [];
    for await (const entry of await opendir(real, { recursive: true })) {
      // Stop ends a long listing, as on a network folder. No listing means every existing file asks.
      if (signal?.aborted) return null;
      const name = relative(real, join(entry.parentPath, entry.name));
      const listed: Listed = { path: join(folder, name), stamp: null };
      entries.set(pathKey(join(real, name)), listed);
      if (entry.isFile() || entry.isSymbolicLink()) files.push(listed);
      if (entries.size > LISTING_MAX) {
        log.write({ type: "listing.skipped", reason: "too many files", max: LISTING_MAX });
        return null;
      }
    }
    for (let at = 0; at < files.length; at += STAMP_BATCH) {
      if (signal?.aborted) return null;
      await Promise.all(
        files.slice(at, at + STAMP_BATCH).map(async (listed) => {
          listed.stamp = await stampOf(listed.path);
        }),
      );
    }
    return entries;
  } catch (err) {
    log.write({ type: "listing.failed", message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** The files a task owns, and how each looked when its last run ended. */
interface Owned {
  paths: string[];
  seen: Record<string, FileStamp>;
}

/** A file's modification time and size, or null when it isn't a file that can be read now. */
async function stampOf(path: string): Promise<FileStamp | null> {
  const entry = await stat(path).catch(() => null);
  return entry?.isFile() ? { mtimeMs: entry.mtimeMs, size: entry.size } : null;
}

export const sameStamp = (a: FileStamp | undefined, b: FileStamp | undefined) =>
  a?.mtimeMs === b?.mtimeMs && a?.size === b?.size;

const sameOwned = (a: Owned, b: Owned) =>
  a.paths.length === b.paths.length &&
  a.paths.every((path) => b.paths.includes(path) && sameStamp(a.seen[path], b.seen[path]));

/**
 * The files from an earlier run that are still the task's own: the ones that are still there and look as they did when
 * that run ended. A file whose modification time or size differs was saved by the user since, and is theirs from then
 * on, so changing it asks and keeps a copy like any file that was there before. Comparing with what the app saw, and
 * not with a clock, keeps a wrong clock from hiding a save, and catches a save that leaves the size as it was. A file
 * a cloud folder (OneDrive, Dropbox, iCloud) syncs can get a new modification time without the user touching it: it
 * asks again, which is the safe side. `saved` lists the files the user saved since, which are still there, so the AI
 * can be told they're the user's again.
 * shortcut: a file saved by a build before `ownSeen` existed has nothing to compare with, so it stays the task's own,
 * even if it's gone, until this run's end records it; drop this once no saved task lacks `ownSeen`.
 */
async function stillOwn(
  paths: string[],
  seen: Record<string, FileStamp> | undefined,
): Promise<Owned & { saved: string[] }> {
  const own: Owned & { saved: string[] } = { paths: [], seen: {}, saved: [] };
  for (const path of paths) {
    const before = seen?.[path];
    if (!before) {
      own.paths.push(path);
      continue;
    }
    const now = await stampOf(path);
    // Gone, or saved by the user since: not the task's own.
    if (now && !sameStamp(before, now)) own.saved.push(path);
    if (!now || !sameStamp(before, now)) continue;
    own.paths.push(path);
    own.seen[path] = before;
  }
  return own;
}

/** How many files from finished requests the AI is told about by name. */
const FINISHED_NAMED = 50;

/**
 * The files the task listed as made that are no longer its own, because the run that made them finished its request
 * (the runner releases them as the next run starts), and that are still there. The AI is told they're the user's now.
 * Files with a kept copy, and those the user saved since, which the AI hears about apart, are left out.
 * shortcut: only the newest FINISHED_NAMED are named; rule 2 still covers the rest, and the policy asks about them all.
 */
async function finishedFiles(task: Task, own: Set<string>, kept: Set<string>, saved: string[]): Promise<string[]> {
  const paths = task.files
    .filter((f) => f.kind === "add" && !own.has(f.path) && !kept.has(f.path) && !saved.includes(f.path))
    .map((f) => f.path)
    .slice(-FINISHED_NAMED);
  const there: string[] = [];
  for (const path of paths) if (await stampOf(path)) there.push(path);
  return there;
}

/**
 * Programs and PowerShell commands that delete: rm, unlink, shred and trash; cmd's del, erase, rd and rmdir; and
 * PowerShell's Remove-Item with its aliases rm, ri, del, erase, rd and rmdir.
 */
const DELETES = new Set(["rm", "rmdir", "del", "erase", "rd", "ri", "unlink", "shred", "trash", "remove-item"]);
/**
 * Deletions in code a command runs, such as a Python, Node or PowerShell script. They're looked for in the command's
 * unquoted text and in quoted code handed to an interpreter, never in quoted text a command only writes. PowerShell's
 * include .NET's [IO.File]::Delete(…) and (Get-Item x).Delete(…). A lowercase .delete( counts only before nothing or a
 * PowerShell variable, so JavaScript's map.delete(key) doesn't.
 */
const CODE_DELETES = [
  /os\.(remove|unlink|rmdir)\(|shutil\.rmtree\(|\.(unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync)\(|::Delete\(|\.delete\(\s*[)$]/i,
  /\.Delete\(/,
];
/** An interpreter's flag for running the quoted text after it as code: python -c, node -e, perl -pe, php -r. */
const CODE_FLAG = /^(-[a-z]{0,2}[ce]|-p|-r|--eval|--print|--command|-command)$/i;

const codeDeletes = (text: string) => CODE_DELETES.some((pattern) => pattern.test(text));

/** Whether a program, given the words after it, runs a deletion: a nested shell's payload, find's -delete, git clean. */
function nestedDeletes(name: string, rest: string[], depth: number): boolean {
  const payload = payloadOf(name, rest);
  if (payload !== null) return deletes(payload, depth + 1);
  if (name === "find") return rest.some((t) => t.toLowerCase() === "-delete");
  if (name === "git") {
    for (let at = 0; at < rest.length; at++) {
      const t = rest[at] ?? "";
      if (/^(-C|-c|--git-dir|--work-tree|--namespace)$/.test(t)) at++;
      else if (!t.startsWith("-")) return t === "clean";
    }
  }
  return false;
}

/**
 * Whether one command deletes. Any bare word that names a deleting program counts, whatever comes before it (options,
 * xargs, then), and so does a quoted one in a program's place: the first word after variable assignments, or any word
 * after sudo, env, xargs and the like. Only the first nested shell is unwrapped, since its payload holds the rest; a
 * shell's payload is the word after its -c, or a here-string it reads.
 */
function commandDeletes(words: Word[], depth: number): boolean {
  const first = words.findIndex((w) => !(w.bare && /^[A-Za-z_]\w*=/.test(w.text)));
  let runsNext = false;
  let unwrapped = false;
  for (const [n, word] of words.entries()) {
    const program = n === first || runsNext;
    if (!program && !word.bare) continue;
    const names = namesOf(word.text, program);
    if (names.some((name) => DELETES.has(name))) return true;
    if (!unwrapped) {
      const rest = words.slice(n + 1).map((w) => w.text);
      if (names.some((name) => nestedDeletes(name, rest, depth))) return true;
      if (names.some((name) => SHELLS.has(name)) && words.some((w) => w.fed && deletes(w.text, depth + 1))) return true;
      unwrapped = names.some((name) => UNWRAPS.has(name));
    }
    if (names.some((name) => RUNS_NEXT.has(name))) runsNext = true;
  }
  return false;
}

/** Whether a script deletes, reading `depth` nested shells deep. */
function deletes(script: string, depth: number): boolean {
  if (depth > MAX_DEPTH) return true;
  const { text, bodies } = heredocs(script);
  if (bodies.some(codeDeletes)) return true;
  const { commands, substitutions } = parse(text);
  // The code check reads the unquoted text and the quoted code after an interpreter's -c or -e, but not what echo
  // writes. A shell's payload is left out here too: it's read as a script of its own, with its own quoted text.
  let code = text;
  for (const words of commands) {
    const runner = words.findIndex((w) => namesOf(w.text, true).some((name) => UNWRAPS.has(name) || name === "echo"));
    for (const [n, word] of words.entries()) {
      const isCode = n > 0 && CODE_FLAG.test(words[n - 1]?.text ?? "") && (runner < 0 || runner > n);
      if (!isCode)
        for (const [start, end] of word.quotes) code = code.slice(0, start) + " ".repeat(end - start) + code.slice(end);
    }
  }
  if (codeDeletes(code)) return true;
  return substitutions.some((s) => deletes(s, depth + 1)) || commands.some((words) => commandDeletes(words, depth));
}

/**
 * Whether a command deletes files. Those are refused, so deletions go through the approval card and the Trash. The
 * command is read as its shell would split it, so a quoted word that only names something, such as an Italian
 * document saying "del corso", is not a `del` command.
 * shortcut: a script that deletes in another way still deletes; snapshot the folder before each run to close the gap.
 */
export function deletesFiles(command: string): boolean {
  return deletes(command, 0);
}

/** OfficeCLI and the document skills, which the agent uses for Word, Excel, PowerPoint and PDF files. */
export interface DocumentTools {
  /** The folder with the skills, one folder per kind of file, each with a SKILL.md. */
  skills: string;
  /** What the agent's commands need: OfficeCLI on the PATH, and its update check and background process off. */
  env: Record<string, string>;
  makePdf(source: string, target: string): Promise<void>;
}

/** The parts of cli-funnel the engine uses, so tests can stand in for Codex and Claude Code. */
export type AgentFunnel = Pick<Funnel, "stream" | "models">;

/** Where the engine keeps a copy of a user's file before a command that names it: the guard's folder of kept copies. */
export interface Copies {
  keep(task: Task, path: string, reason: KeptCopy["reason"]): Promise<KeptCopy>;
  /** Removes a copy that turned out not to be needed. */
  drop(copy: KeptCopy): Promise<void>;
}

/** A copy kept before a command that named a user's file, until the run shows whether the file changed. */
interface Provisional {
  copy: KeptCopy;
  /** How the file looked when it was copied. */
  stamp: FileStamp;
  /** The commands that named it and haven't ended yet, by call id. */
  running: Set<string>;
}

/** The tool server's session calls, so the engine can open one per run. */
export interface ToolSessions {
  open(taskId: string): { url: string; token: string };
  close(token: string): void;
}

/** Events from three sources (the run, the tools, the callbacks) merged into one stream for the runner. */
class Channel<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const item = this.items.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }
}

interface Live {
  channel: Channel<EngineEvent>;
  /** Aborted by Stop, and by the engine when Codex takes a step its hook didn't allow. */
  signal: AbortSignal;
  workdir: string;
  /**
   * Files the agent may change again without asking: the ones this task made, and the ones the user let it replace in
   * this run, whose copy is kept.
   */
  made: Set<string>;
  /** Files Tost Work knows this task made, in this run or an earlier one. They're saved on the task when the run ends. */
  own: Set<string>;
  task: Task;
  /** The folder as it was when the run started, from `listFolder`. A file that isn't in it was made by this run. */
  before: Map<string, Listed> | null;
  /** The user's files when the run started, by name: every file in `before` that wasn't the task's own. */
  theirs: FileNames | null;
  /** Copies kept before commands that named a user's file, by path, until the file changes or the run ends. */
  provisional: Map<string, Provisional>;
  /** The files the task owned when the run started. */
  startOwn: Set<string>;
  /** Files the user let the task delete in this run, which Tost Work moved to the Trash. */
  trashed: Set<string>;
  /** The work on `provisional`, one piece at a time, since commands can be checked and end side by side. */
  queue: Promise<void>;
  /** Approvals a step is waiting on, by id. */
  pending: Set<string>;
  /** Codex's steps that its hook allowed, by call id: each command and file change it starts must be one. */
  allowed: Set<string>;
  log: TaskLog;
}

/** The paths, kinds and new paths of a file change, from Codex's item or from the hook's patch. */
function changesOf(input: unknown): { path: string; kind: string; movedTo?: string }[] {
  const changes = (input as { changes?: { changes?: unknown } } | undefined)?.changes;
  const list = Array.isArray(changes) ? changes : (changes as { changes?: unknown } | undefined)?.changes;
  if (!Array.isArray(list)) return [];
  return list.flatMap((c: { path?: unknown; kind?: unknown; move_path?: unknown }) => {
    if (typeof c?.path !== "string") return [];
    const detail = typeof c.kind === "object" ? (c.kind as { type?: string; move_path?: unknown } | null) : null;
    const kind = typeof c.kind === "string" ? c.kind : detail?.type;
    const movedTo = typeof c.move_path === "string" ? c.move_path : detail?.move_path;
    return [{ path: c.path, kind: kind ?? "update", ...(typeof movedTo === "string" ? { movedTo } : {}) }];
  });
}

/** Whether a decision lets the step run. */
const allows = (decision: ApprovalDecision) =>
  (typeof decision === "string" ? decision : decision.decision) === "allow";

/** The two kinds of Codex step that change the computer, which its hook must have allowed before they start. */
const GATED = new Set(["command", "file_change"]);

/**
 * Claude Code's tools that run a command: Bash, and on Windows PowerShell. Without Git for Windows Claude Code offers
 * only PowerShell there; with it, both.
 */
const CLAUDE_COMMANDS = new Set(["Bash", "PowerShell"]);

/** Claude Code's tools that write one file, and the input field with its path. */
const CLAUDE_WRITES: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

/**
 * A path with its links resolved, for a file that may not exist yet: the nearest existing folder is resolved. Null when
 * a link on the way leads nowhere, because writing through it would create whatever it points to. Any error other than
 * a missing file is thrown.
 */
async function realTarget(path: string): Promise<string | null> {
  const rest: string[] = [];
  let dir = path;
  while (true) {
    try {
      return join(await realpath(dir), ...rest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    // Missing, or a link to something missing: lstat tells them apart, as writablePath does in files.ts.
    const link = await lstat(dir).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (link) return null;
    const parent = dirname(dir);
    if (parent === dir) return path;
    rest.unshift(basename(dir));
    dir = parent;
  }
}

/**
 * Whether a path, taken from the task's folder, lands outside it. Links are resolved first, because on a Mac a
 * temporary folder under /var is really under /private/var, and a link that leads nowhere counts as outside.
 */
export async function outside(workdir: string, path: string): Promise<boolean> {
  const folder = await realTarget(workdir);
  const target = await realTarget(resolve(workdir, path));
  return !folder || !target || !inside(folder, target);
}

/** Folders that hold an AI's own settings: Claude Code's and Codex's. */
const SETTINGS_FOLDERS = new Set([".claude", ".codex"]);

/**
 * Whether a path in the task's folder is one of the AI's own settings: anything in a .claude or .codex folder, or a
 * .mcp.json file. Claude Code reads them from the folder in the next run, and some at once, so a task could otherwise
 * plant settings that skip Tost Work's checks (claudeFolder.ts). The path is read as given and with its links
 * resolved, and without regard to case, as Windows and macOS name files.
 */
export async function agentSettings(workdir: string, path: string): Promise<boolean> {
  const target = resolve(workdir, path);
  const folder = await realTarget(workdir);
  const real = await realTarget(target);
  const names = [relative(resolve(workdir), target), folder && real ? relative(folder, real) : ""];
  return names.some((name) => {
    const parts = name.toLowerCase().split(/[\\/]/);
    return parts.some((part) => SETTINGS_FOLDERS.has(part)) || parts.at(-1) === ".mcp.json";
  });
}

/** Whether a file is there. */
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * A Claude Code approval request in the shape the policy takes, so one policy covers both CLIs: Bash and PowerShell
 * become a command, keeping a request to run outside the sandbox, and a tool that writes a file becomes a file change,
 * an add when the file isn't there yet.
 */
export async function asCodexRequest(request: ApprovalRequest, workdir: string): Promise<ApprovalRequest> {
  const input = (request.input ?? {}) as Record<string, unknown>;
  if (CLAUDE_COMMANDS.has(request.tool)) {
    const unsandboxed = input.dangerouslyDisableSandbox === true ? { dangerouslyDisableSandbox: true } : {};
    return { ...request, tool: "command", input: { command: input.command, ...unsandboxed } };
  }
  const field = CLAUDE_WRITES[request.tool];
  const target = field ? input[field] : undefined;
  if (typeof target !== "string") return request;
  const path = resolve(workdir, target);
  return {
    ...request,
    tool: "file_change",
    input: { changes: [{ path, kind: (await exists(path)) ? "update" : "add" }] },
  };
}

/**
 * Whether a CLI's error means it couldn't reach its service. Codex says "workspace routing discovery failed" or
 * "stream disconnected", Claude Code names the socket error.
 */
export function isNetworkError(message: string): boolean {
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|ENETUNREACH|EHOSTUNREACH|getaddrinfo|fetch failed|connection refused|network (error|is unreachable)|routing discovery failed|stream disconnected|error sending request/i.test(
    message,
  );
}

/**
 * Runs tasks through cli-funnel on Codex (the ChatGPT sign-in) or Claude Code (the Claude sign-in), and Tost Work's
 * tools carry questions, approvals, files and the review. Shell commands run in each CLI's own sandbox, so they can
 * write only inside the task's folder and temp folders.
 *
 * Every step goes through one policy first. Claude Code runs at `supervised` and asks through its approvals. Codex
 * runs at `full` with its sandbox on, which means no approvals, so every command it runs stays in the sandbox. Its
 * steps reach the policy through its PreToolUse hook instead (codexHook.ts and `gate`), and every command and file
 * change Codex starts must be one the hook allowed, or the task stops.
 */
export class AgentEngine implements Engine, ToolHandler {
  private live = new Map<string, Live>();
  private waiting = new Map<string, (reply: Decision | null) => void>();
  /** Every approval put on a task, by id, so a decision that comes after the run knows its files. */
  private approvals = new Map<string, { taskId: string; action: "overwrite" | "delete"; paths: string[] }>();
  /** Files the user allowed replacing after the run that asked had ended. The next run may change them. */
  private cleared = new Map<string, Set<string>>();
  private tools: ToolSessions | null = null;

  private documents: DocumentTools | null;
  private user: () => { name: string; work: string; notes: string };
  private ai: () => Promise<AiId>;
  private courseKey: () => { key: string; vendor: KeyVendor } | null;
  private online: () => boolean;
  private usable: () => Promise<AiId[]>;
  private skills: () => Promise<Skill[]>;
  private job: (id: string) => Pick<Job, "title" | "output"> | undefined;
  private taskLog: (taskId: string, secrets: (string | undefined)[]) => TaskLog;
  private verbose: () => boolean;
  private level: () => Level;
  private platform: string;
  private sandboxReady: (provider: AgentProvider) => Promise<SandboxReadiness>;
  private codexHook: (workdir: string) => Promise<void>;
  private claudeFolder: (workdir: string) => Promise<void>;
  private copies: Copies | null;

  constructor(
    private funnel: AgentFunnel,
    private language: () => "en" | "it",
    options: {
      documents?: DocumentTools | null;
      /** The user's profile: their name, which new Office files carry as author, what they do, and notes. */
      user?: () => { name: string; work: string; notes: string };
      /** The account new tasks run on. */
      ai?: () => Promise<AiId>;
      /** The course API key, read for each run so a removed key stops being used. */
      courseKey?: () => { key: string; vendor: KeyVendor } | null;
      /** Whether the computer has a network connection, so a task without one fails at once with a clear reason. */
      online?: () => boolean;
      /** The AIs a task could run on right now: the ones signed in, and the course key when there is one. */
      usable?: () => Promise<AiId[]>;
      /** The user's skills, read for each run so a skill saved a moment ago is there. */
      skills?: () => Promise<Skill[]>;
      /** The job a task is a run of, so the agent knows nobody is watching and where the files go. */
      job?: (id: string) => Pick<Job, "title" | "output"> | undefined;
      /** Whether debug is on, so a run also sends what its CLI prints, for the log. */
      verbose?: () => boolean;
      /** The user's level, read for each use: below Expert, no model offers the "max" reasoning level. Expert when not given. */
      level?: () => Level;
      /** The task's debug log, which writes only while debug is on. `secrets` are masked in every line. */
      taskLog?: (taskId: string, secrets: (string | undefined)[]) => TaskLog;
      /** The system the CLIs run on, which decides whether Claude Code gets a sandbox. */
      platform?: string;
      /** Whether the sandbox can start for an AI, checked before each run. Ready when not given. */
      sandboxReady?: (provider: AgentProvider) => Promise<SandboxReadiness>;
      /**
       * Makes sure Codex will run Tost Work's hook before each step of a task in the folder, and throws a UserError
       * when it won't. Without it Codex tasks don't start.
       */
      codexHook?: (workdir: string) => Promise<void>;
      /**
       * Throws a UserError when the task's folder brings Claude Code settings that would change Tost Work's checks,
       * checked before each Claude run. checkClaudeFolder when not given.
       */
      claudeFolder?: (workdir: string) => Promise<void>;
      /**
       * Keeps a copy of a user's file before a command names it in a way the policy can't read, and drops the copy
       * when the file didn't change. Without it no such copy is kept, and only the card protects the user's files.
       */
      copies?: Copies | null;
    } = {},
  ) {
    this.documents = options.documents ?? null;
    this.user = options.user ?? (() => ({ name: "", work: "", notes: "" }));
    this.ai = options.ai ?? (async () => "chatgpt");
    this.courseKey = options.courseKey ?? (() => null);
    this.online = options.online ?? (() => true);
    this.usable = options.usable ?? (async () => []);
    this.skills = options.skills ?? (async () => []);
    this.job = options.job ?? (() => undefined);
    this.verbose = options.verbose ?? (() => false);
    this.level = options.level ?? (() => "expert");
    this.taskLog = options.taskLog ?? (() => ({ write: () => {} }));
    this.platform = options.platform ?? process.platform;
    this.sandboxReady = options.sandboxReady ?? (async () => READY);
    this.codexHook =
      options.codexHook ??
      (async () => {
        throw new UserError("error.codexHookOff", { detail: "no check was given" });
      });
    this.claudeFolder = options.claudeFolder ?? ((workdir) => checkClaudeFolder(workdir));
    this.copies = options.copies ?? null;
  }

  /** Why the task can't reach its AI, in the user's language. */
  private offline(provider: AgentProvider): string {
    return translate(this.language(), "task.offline", { ai: provider === "claude" ? "Claude" : "ChatGPT" });
  }

  /** The tool server takes this engine as its handler, so it's attached after both exist. */
  attachTools(tools: ToolSessions): void {
    this.tools = tools;
  }

  /** The agent an AI runs through, and whether it runs on the subscription or the course key. */
  private async target(ai: AiId): Promise<{ provider: AgentProvider; auth: "account" | "key" }> {
    if (ai !== "key") return { provider: PROVIDER_OF[ai], auth: "account" };
    const key = this.courseKey();
    if (!key) throw new UserError("error.courseKeyGone");
    return { provider: KEY_PROVIDER[key.vendor], auth: "key" };
  }

  private async modelsOf(provider: AgentProvider): Promise<ModelOption[]> {
    const models = await this.funnel.models(provider);
    // The one place a model's levels are read, so the picker and the run both follow the user's level.
    return limitModels(
      models.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        efforts: m.efforts.map((e) => e.id),
        ...(m.defaultEffort ? { defaultEffort: m.defaultEffort } : {}),
      })),
      this.level(),
    );
  }

  /**
   * The level a run of the task uses. A task started at Expert keeps "max" in its record, so below Expert a later run
   * of it takes the nearest level its model still offers.
   */
  private async effortNow(provider: AgentProvider, task: Task): Promise<string> {
    if (effortsFor(this.level(), [task.effort]).length > 0) return task.effort;
    // Without the model's list, the nearest of the usual levels stands in.
    const models = await this.modelsOf(provider).catch(() => []);
    const offered = models.find((m) => m.id === task.model)?.efforts ?? effortsFor(this.level(), EFFORTS);
    return nearestEffort(task.effort, offered) ?? task.effort;
  }

  /** What a new task runs on, from `pickOn`: a choice of the three on the default AI, or a model from the full list. */
  async defaults(
    pick: ModelPick = DEFAULT_PICK,
  ): Promise<{ provider: AgentProvider; auth: "account" | "key"; model: string; effort: string }> {
    const ai = await this.ai();
    const { provider } = await this.target(ai);
    const elsewhere = "ai" in pick && pick.ai !== ai;
    // A model picked on another AI doesn't need the default AI's list, unless it falls back to the middle choice, so
    // a failed read of that list doesn't stop it. Without the list, pickOn finds no fallback and says so.
    const defaultModels = elsewhere ? await this.modelsOf(provider).catch(() => null) : await this.modelsOf(provider);
    const lists: AiModels[] = defaultModels ? [{ ai, provider, models: defaultModels }] : [];
    if (elsewhere && (await this.usable()).includes(pick.ai)) {
      // A model on an AI that has gone (signed out, or a removed course key) is left out, and the middle choice stands
      // in.
      const target = await this.target(pick.ai).catch(() => null);
      // So is one whose list can't be read just now, as in choices().
      const models = target && (await this.modelsOf(target.provider).catch(() => null));
      if (target && models) lists.push({ ai: pick.ai, provider: target.provider, models });
    }
    const picked = pickOn(pick, { ai, provider, lists });
    if (!picked) throw new UserError("error.noModels", { ai: provider === "claude" ? "Claude Code" : "Codex" });
    return {
      provider: picked.provider,
      auth: picked.ai === "key" ? "key" : "account",
      model: picked.model.id,
      effort: picked.effort,
    };
  }

  /** The default AI, and the models of every AI a task could run on, for the picker under the task box. */
  async choices(): Promise<ModelChoices> {
    // Each check and read starts a CLI, which takes seconds on a slow machine, so they run together.
    const [ai, usable] = await Promise.all([this.ai(), this.usable()]);
    const { provider } = await this.target(ai);
    const ais = [ai, ...usable.filter((x) => x !== ai)];
    const read = await Promise.all(
      ais.map(async (id): Promise<AiModels | null> => {
        const target = await this.target(id).catch(() => null);
        if (!target) return null;
        // A list that can't be read leaves that AI out of the full list rather than failing the picker.
        const models = await this.modelsOf(target.provider).catch(() => null);
        return models && { ai: id, provider: target.provider, models };
      }),
    );
    return { ai, provider, lists: read.filter((l) => l !== null) };
  }

  async *run({ task, project, workdir, followUp, signal: stopped }: RunContext): AsyncIterable<EngineEvent> {
    if (!this.tools) throw new Error("The tool server isn't attached");
    const provider = task.provider ?? "codex";
    const codex = provider === "codex";
    // Without a connection Codex retries for minutes before it gives up, so the task fails straight away instead.
    if (!this.online()) throw new Error(this.offline(provider));
    // On Linux a sandbox that can't start would fail Claude Code with its own error, and leave Codex running with
    // every command failing. So the task fails here, saying what to install.
    const sandbox = sandboxFor(provider, this.platform);
    if (sandbox) {
      const readiness = await this.sandboxReady(provider);
      if (!readiness.ready) {
        this.taskLog(task.id, []).write({ type: "sandbox.not-ready", ...readiness });
        throw new SandboxNotReady(provider, readiness);
      }
    }
    // Codex runs without approvals, so a task never starts unless its hook will check each step.
    if (codex) await this.codexHook(workdir);
    // Claude Code reads a folder's own settings in every run, follow-ups included, and some of them would let its steps
    // skip the policy or run commands outside the sandbox.
    else await this.claudeFolder(workdir);
    // Stop aborts the run, and so does the engine when Codex takes a step its hook never allowed.
    const abort = new AbortController();
    const onStop = () => abort.abort();
    if (stopped.aborted) abort.abort();
    else stopped.addEventListener("abort", onStop, { once: true });
    const signal = abort.signal;
    const channel = new Channel<EngineEvent>();
    // Files the task created, as Tost Work saw them made, never as the agent reports them: a file the agent calls new
    // may have been in the folder before. A file with a kept copy existed before the task (it was overwritten with
    // approval, or restored since), so changing it again always asks.
    const kept = new Set((task.kept ?? []).map((k) => k.path));
    const earlier = await stillOwn(
      (task.own ?? []).filter((path) => !kept.has(path)),
      task.ownSeen,
    );
    const own = new Set(earlier.paths);
    const finished = await finishedFiles(task, own, kept, earlier.saved);
    const made = new Set(own);
    for (const path of this.cleared.get(task.id) ?? []) made.add(path);
    this.cleared.delete(task.id);
    const session = this.tools.open(task.id);
    const tools = this.tools;

    // A task started on the course key keeps running on it. Removed or replaced with another vendor's, it can't.
    let apiKey: string | undefined;
    if (task.auth === "key") {
      const key = this.courseKey();
      if (!key || KEY_PROVIDER[key.vendor] !== provider) {
        stopped.removeEventListener("abort", onStop);
        this.tools.close(session.token);
        throw new UserError("error.taskKeyGone");
      }
      apiKey = key.key;
    }

    // The log gets every event as cli-funnel sends it, after a line saying what the run was started with. The run's
    // tool server token and the course key are masked wherever they would appear.
    const log = this.taskLog(task.id, [session.token, apiKey]);
    const access = codex ? "full" : "supervised";
    const effort = await this.effortNow(provider, task);
    if (effort !== task.effort) channel.push({ type: "effort", effort });
    log.write({
      type: "run",
      provider,
      model: task.model,
      effort,
      access,
      sandbox,
      cwd: workdir,
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      followUp: followUp !== null,
    });
    // The folder as it is before the CLI starts, so no file the run makes is in it, with how each file looked, for the
    // check at the run's end. A network folder takes longer to list, and the run starts that much later.
    const before = await listFolder(workdir, log, signal);
    const theirs =
      before &&
      new FileNames(
        [...before.values()].filter((l) => l.stamp && !own.has(l.path)).map((l) => l.path),
        pathsFor(workdir),
      );
    const live: Live = {
      channel,
      signal,
      workdir,
      task,
      made,
      own,
      before,
      theirs,
      startOwn: new Set(own),
      provisional: new Map(),
      trashed: new Set(),
      queue: Promise.resolve(),
      pending: new Set(),
      allowed: new Set(),
      log,
    };
    this.live.set(task.id, live);
    // What the task owns is saved on the task as it is: files the user saved since the last run are no longer in it.
    let recorded: Owned = { paths: task.own ?? [], seen: task.ownSeen ?? {} };
    const record = (owned: Owned) => {
      if (sameOwned(recorded, owned)) return;
      recorded = owned;
      channel.push({ type: "own", ...owned });
    };
    record(earlier);

    // A skills folder that can't be read leaves the task without skills rather than failing it.
    const skills = await this.skills().catch(() => []);
    // Claude Code can leave a command or a subagent running in the background and end its turn, saying it will look
    // later. Nothing would wake it to look, and the task would show as finished, so here it waits for each one.
    // CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR starts each of Claude Code's commands in the task's folder. Its shell
    // would otherwise keep the folder a cd moved to, and the policy never sees a cd that Claude Code runs without
    // asking, so it couldn't tell where a relative path in the next command lands. The documentation limits the
    // setting to the main session. In one run of Claude Code 2.1.319 a subagent's shell went back to the task's folder
    // too, but nothing guarantees that: if a later version lets a subagent's shell keep a cd, its relative paths
    // resolve against the wrong folder and a replaced file goes unasked.
    // shortcut: no folder tracking for subagents, because the requests don't say which come from one.
    // Codex's hook finds Tost Work through the run's address and token, which the commands Codex runs don't get.
    const env = codex
      ? {
          ...this.documents?.env,
          [HOOK_URL_ENV]: new URL("/hook", session.url).toString(),
          [HOOK_TOKEN_ENV]: session.token,
        }
      : {
          ...this.documents?.env,
          CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
          CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: "1",
        };
    const stream = this.funnel.stream({
      selection: { provider, model: task.model, effort, cwd: workdir, access },
      // Files sent without a message come with a note that says so, in place of an empty prompt.
      prompt: followUp ?? (task.brief || withFiles("", task.attachments)),
      system: instructionsFor(
        task,
        project,
        this.language(),
        this.documents && { skills: this.documents.skills },
        this.user(),
        skills,
        task.jobId ? (this.job(task.jobId) ?? null) : null,
        this.platform,
        earlier.saved,
        finished,
      ),
      env,
      ...(apiKey ? { apiKey } : {}),
      // Web search, without asking before each site. Codex searches OpenAI's web index: its live search needs a looser
      // access level than supervised. Claude Code has its own search tool, which the policy allows. Both pass on what
      // their subagents write, for the activity, and the tool calls they make, for the debug view and the check that
      // each Codex step was allowed.
      providerOptions: codex
        ? { codex: { webSearch: "cached" as const, ...SUBAGENTS } }
        : { claude: { ...SUBAGENTS, disallowedTools: UNUSED_CLAUDE_TOOLS } },
      // While debug is on, every line the CLI prints, for the log. It costs nothing while off.
      verbose: this.verbose(),
      // Shell commands run in each CLI's sandbox, so they can't write outside the folder. Codex at full stays in it
      // with this, and with no approvals it never runs a command outside it. A sandbox that can't start fails the run
      // rather than letting it go unconfined, except for Claude Code on Windows, which has none: there it runs
      // without one, and setup warns the user (see claudeUnconfined).
      sandbox,
      sessionId: task.sessionId,
      signal,
      planTool: true,
      mcpServers: {
        tost_work: {
          type: "http",
          url: session.url,
          headers: { Authorization: `Bearer ${session.token}` },
          autoApprove: true,
        },
      },
      // Claude Code's file tools are held to the folder here. Codex asks nothing at full: its hook calls `gate`.
      ...(codex
        ? {}
        : {
            onApproval: async (request: ApprovalRequest) =>
              this.policy(task.id, await asCodexRequest(request, workdir)),
          }),
    });

    // What the agent wrote since its last tool call. Words followed by a tool call were a note between steps, such as
    // "the table is nearly done", not the answer: they go into the activity, and only the last words are the answer.
    let said = "";
    // Set when Codex started a step its hook never allowed: the hook isn't running, so the task stops.
    let unchecked: string | null = null;
    // However the run ends: the copies kept before commands are settled, the user's files that changed unseen are
    // listed, and the files the task owns go on the task, only when they changed.
    const wrapUp = async () => {
      await this.serial(live, () => this.settleAll(live));
      const after = live.before && (await listFolder(live.workdir, live.log, live.signal));
      this.unseen(live, after);
      record(await this.ownAtEnd(live, after));
    };
    const pump = (async () => {
      try {
        for await (const event of stream) {
          log.write(event);
          if (codex && event.type === "tool.start" && GATED.has(event.name) && !live.allowed.has(event.id)) {
            if (!unchecked) {
              unchecked = event.id;
              log.write({ type: "hook.missing", id: event.id, name: event.name });
              abort.abort();
            }
            continue;
          }
          if (event.type === "session") channel.push({ type: "session", sessionId: event.sessionId });
          else if (event.type === "text.delta") {
            said += event.text;
            channel.push({ type: "text", text: event.text });
          } else if (event.type === "plan") channel.push({ type: "plan", steps: event.steps });
          // A subagent's own calls show in the debug view under the line that hands it off, from the log.
          else if (event.type === "tool.start" && !event.parentId) {
            const note = noteText(said);
            said = "";
            if (note) channel.push({ type: "activity", kind: "note", target: note });
            const line = activityOf(event.name, event.input, this.documents?.skills);
            if (line) channel.push({ type: "activity", ...line, id: event.id });
          } else if (event.type === "subagent.text") {
            const note = noteText(event.text);
            if (note) channel.push({ type: "activity", kind: "note", target: note });
          } else if (event.type === "file.change" && event.status === "done") {
            const path = event.movedTo ?? event.path;
            if (event.kind === "delete") {
              made.delete(path);
              live.own.delete(path);
            } else made.add(path);
            channel.push({ type: "file", change: { path, kind: event.kind, role: "made" } });
          } else if (event.type === "tool.end") await this.serial(live, () => this.settle(live, event.id));
        }
        const result = await stream.result;
        log.write({ type: "run.end", finishReason: result.finishReason, deniedActions: result.deniedActions });
        await wrapUp();
        if (unchecked) channel.push({ type: "failed", error: translate(this.language(), "error.codexUnchecked") });
        else if (result.finishReason === "cancelled") channel.push({ type: "stopped" });
        else {
          if (result.text.trim()) channel.push({ type: "message", text: result.text.trim() });
          channel.push({ type: "done" });
        }
      } catch (err) {
        await wrapUp();
        if (unchecked) channel.push({ type: "failed", error: translate(this.language(), "error.codexUnchecked") });
        else if (signal.aborted) channel.push({ type: "stopped" });
        else {
          const message = err instanceof Error ? err.message : String(err);
          log.write({ type: "run.failed", message });
          channel.push({
            type: "failed",
            // Only an error that is about the network gets the plain explanation; any other keeps the CLI's words,
            // even when the connection dropped meanwhile.
            error: isNetworkError(message) ? this.offline(provider) : message,
          });
        }
      } finally {
        // A step still waiting on a card ends with the turn. Its card stays, and the decision starts the next run.
        for (const id of [...live.pending]) this.waiting.get(id)?.(null);
        // Stop takes the cards off the task, so no decision will come for them.
        if (signal.aborted)
          for (const [id, asked] of this.approvals) if (asked.taskId === task.id) this.approvals.delete(id);
        stopped.removeEventListener("abort", onStop);
        tools.close(session.token);
        this.live.delete(task.id);
        channel.close();
      }
    })();

    yield* channel;
    await pump;
  }

  /** Questions never hold a run: the agent ended its turn, so the runner sends the answer as the next message. */
  answer(_taskId: string, _questionId: string, _answer: string): boolean {
    return false;
  }

  decide(taskId: string, approvalId: string, decision: Decision): boolean {
    const asked = this.approvals.get(approvalId);
    this.approvals.delete(approvalId);
    const waiter = this.waiting.get(approvalId);
    if (waiter) {
      waiter(decision);
      return true;
    }
    // The run that asked is over, and the next one makes the change: it may, without asking a second time.
    if (decision === "allow" && asked?.action === "overwrite") {
      const cleared = this.cleared.get(taskId) ?? new Set<string>();
      for (const path of asked.paths) cleared.add(path);
      this.cleared.set(taskId, cleared);
    }
    return false;
  }

  // Tost Work's tools, called by the agent through the MCP server.

  async ask(taskId: string, questions: { text: string; options: string[] }[]): Promise<string> {
    const [first, ...more] = questions;
    if (!first) throw new Error("Ask at least one question");
    const question = { id: randomUUID(), ...first, ...(more.length ? { more } : {}) };
    this.mustLive(taskId).channel.push({ type: "question", question });
    return END_TURN;
  }

  /**
   * The agent's own request before it replaces or deletes files. A file this task made, or one the user already let it
   * replace in this run, needs no card: the agent hears so at once, and only the other files go on the card.
   */
  async approve(taskId: string, action: "overwrite" | "delete", paths: string[]): Promise<string> {
    const live = this.mustLive(taskId);
    const free: string[] = [];
    if (action === "overwrite") for (const path of paths) if (await this.mayChange(live, path)) free.push(path);
    const asked = paths.filter((path) => !free.includes(path));
    if (!asked.length) return noApprovalNeeded(free);
    const id = randomUUID();
    this.approvals.set(id, { taskId, action, paths: asked });
    live.channel.push({ type: "approval", approval: { id, action, paths: asked } });
    return free.length ? `${APPROVAL_END} ${noApprovalNeeded(free)}` : APPROVAL_END;
  }

  /**
   * Lists a file the agent made, changed or deleted. A file it says it made or changed that isn't there isn't listed:
   * the agent named the wrong path, as when it counted on a cd from an earlier command. It hears so, and where a file
   * of that name is at the top of the task's folder, but the choice of path stays with it.
   */
  async reportFile(taskId: string, change: { path: string; kind: "add" | "update" | "delete" }): Promise<void> {
    const live = this.mustLive(taskId);
    if (change.kind !== "delete" && !(await exists(change.path))) {
      const top = join(live.workdir, basename(change.path));
      const there = top !== change.path && (await exists(top));
      throw new Error(
        `There's no file at ${change.path}, so it isn't listed.${there ? ` There is one at ${top}.` : ""} A cd in one command doesn't carry over to the next. Check where the file is and report that path.`,
      );
    }
    live.channel.push({ type: "file", change: { ...change, role: "made" } });
  }

  /** Makes a PDF next to an Office file in the task's folder, under a free name, and adds it to the task. */
  async makePdf(taskId: string, path: string): Promise<string> {
    const live = this.mustLive(taskId);
    if (!this.documents) throw new Error("This build of Tost Work can't make PDFs");
    const source = await realpath(path);
    if (!inside(await realpath(live.workdir), source)) throw new UserError("error.fileOutside");
    const target = await freeName(dirname(source), `${basename(source, extname(source))}.pdf`);
    await this.documents.makePdf(source, target);
    live.made.add(target);
    live.own.add(target);
    live.channel.push({ type: "file", change: { path: target, kind: "add", role: "made" } });
    return `Made ${target}. Tell the user where it is.`;
  }

  async review(taskId: string, review: Review): Promise<void> {
    this.mustLive(taskId).channel.push({ type: "review", review });
  }

  /**
   * One step Codex is about to take, from its PreToolUse hook, decided by the same policy as Claude Code's approvals.
   * A step the policy allows is recorded, so the run can tell it from a step the hook never saw.
   */
  async gate(taskId: string, body: unknown): Promise<HookAnswer> {
    const live = this.live.get(taskId);
    if (!live || live.signal.aborted) return { decision: "deny", reason: "This task isn't running any more." };
    const call = hookCall(body);
    if (!call) {
      live.log.write({ type: "hook", decision: "deny", reason: "unreadable" });
      return { decision: "deny", reason: "Tost Work couldn't read this step." };
    }
    const request = gateRequest(call);
    let decision: ApprovalDecision = "allow";
    if ("refuse" in request) decision = { decision: "deny", message: request.refuse };
    else
      for (const step of [request.command, request.change, request.other]) {
        if (!step) continue;
        decision = await this.policy(taskId, step);
        if (!allows(decision)) break;
      }
    // Stop can come while a card is open: then nothing more runs, even a step the user has just allowed.
    const allowed = allows(decision) && !live.signal.aborted && this.live.get(taskId) === live;
    const reason =
      typeof decision === "object" && decision.message ? decision.message : "Tost Work didn't allow this step.";
    live.log.write({ type: "hook", id: call.id, tool: call.tool, decision: allowed ? "allow" : "deny" });
    if (!allowed) return { decision: "deny", reason: live.signal.aborted ? "This task was stopped." : reason };
    live.allowed.add(call.id);
    return { decision: "allow" };
  }

  /** The task's run, unless it ended or was stopped: after Stop nothing new goes on the task. */
  private mustLive(taskId: string): Live {
    const live = this.live.get(taskId);
    if (!live || live.signal.aborted) throw new UserError("error.notRunning");
    return live;
  }

  /**
   * What the agent may do without the user: new files, changes to files this task made, and commands that neither
   * delete nor replace a file that was already there. Changing such a file, with a tool or a command, or deleting one,
   * goes through the approval card, and Tost Work
   * keeps the copy or moves the file to the Trash before the agent hears back. Nothing is written outside the task's
   * folder, and commands stay in the sandbox.
   */
  private async policy(taskId: string, request: ApprovalRequest): Promise<ApprovalDecision> {
    const live = this.live.get(taskId);
    if (!live) return { decision: "deny", message: "This task isn't running any more." };
    if (request.tool.startsWith("mcp:")) return "allow";
    // Claude Code's own question tool can't reach the user from here, so questions go through ask_user.
    if (request.tool === "AskUserQuestion")
      return { decision: "deny", message: "Ask the user with the ask_user tool, then end your turn." };
    if (request.tool === "command") {
      const input = (request.input ?? {}) as { command?: unknown; cwd?: unknown; dangerouslyDisableSandbox?: unknown };
      const command = String(input.command ?? "");
      // Claude Code asks this way to run a command outside its sandbox.
      if (input.dangerouslyDisableSandbox === true)
        return {
          decision: "deny",
          message: "Commands run only inside the sandbox. Run it again without dangerouslyDisableSandbox.",
        };
      if (deletesFiles(command))
        return {
          decision: "deny",
          message: `Don't delete files with commands. Call request_approval with action delete, and Tost Work moves them to the ${trashName(process.platform)}.`,
        };
      // What's typed into a shell that's already running isn't checked, so commands can't open one to type into.
      if (opensShell(command))
        return {
          decision: "deny",
          message:
            "This command leaves a shell or an interpreter waiting for typed input, which Tost Work can't check. Run a script by its path (python3 convert.py, bash build.sh), or pass the code with -c (python3 -c '…', bash -c '…'), in this one call.",
        };
      return this.commandOverwrites(
        taskId,
        live,
        request.id,
        command,
        typeof input.cwd === "string" ? input.cwd : null,
      );
    }
    if (request.tool !== "file_change") return "allow";

    const changes = changesOf(request.input);
    for (const c of changes)
      for (const target of [c.path, c.movedTo])
        if (target && (await outside(live.workdir, target)))
          return { decision: "deny", message: "Work only inside the task's folder." };
    for (const c of changes)
      for (const target of [c.path, c.movedTo])
        if (target && (await agentSettings(live.workdir, target)))
          return {
            decision: "deny",
            message:
              "Leave .claude and .codex folders and .mcp.json files as they are: they hold the AI's own settings, which Tost Work doesn't let a task change.",
          };
    const deletes = changes.filter((c) => c.kind === "delete").map((c) => c.path);
    // A file that's already there is overwritten by a change, by an add (a patch's Add File replaces it) and by a move
    // onto it, unless the task made it.
    const overwrites: string[] = [];
    for (const c of changes) {
      if (c.kind === "delete") continue;
      const targets = [c.kind === "add" && !(await exists(c.path)) ? null : c.path];
      if (c.movedTo && (await exists(c.movedTo))) targets.push(c.movedTo);
      for (const target of targets)
        if (target && !overwrites.includes(target) && !(await this.mayChange(live, target))) overwrites.push(target);
    }
    if (deletes.length) {
      const decided = await this.askApproval(taskId, "delete", deletes);
      if (decided === "allow") for (const path of deletes) live.trashed.add(path);
      return {
        decision: "deny",
        message:
          decided === "allow"
            ? `The user allowed it, and Tost Work moved the files to the ${trashName(process.platform)}. Don't delete them again.`
            : "The user wants to keep these files. Leave them as they are.",
      };
    }
    return this.overwrite(taskId, live, overwrites);
  }

  /**
   * A command that writes files goes through the same card as a file change when it would replace a file that was
   * already in the task's folder. It runs only once the user allows it, after the copy is kept. The files it writes
   * that weren't there yet count as made by the task. Files outside the folder are left to the sandbox. `cwd` is the
   * folder Codex's hook names; Claude Code's requests name none, and each of its commands starts in the task's folder
   * (see the run's env). Any other user's file the command names gets a copy before it runs (`copyNamed`), and one too
   * big to copy goes on the card too.
   */
  private async commandOverwrites(
    taskId: string,
    live: Live,
    id: string,
    command: string,
    cwd: string | null,
  ): Promise<ApprovalDecision> {
    const from = cwd ?? live.workdir;
    const writes = commandWrites(command, from);
    const overwrites: string[] = [];
    const added: string[] = [];
    for (const path of await writtenPaths(writes.targets, from)) {
      if (await outside(live.workdir, path)) continue;
      const entry = await stat(path).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
        throw err;
      });
      if (!entry) added.push(path);
      else if (entry.isFile() && !(await this.mayChange(live, path))) overwrites.push(path);
    }
    const named = await this.copyNamed(live, id, command, from, overwrites);
    const decision = await this.overwrite(taskId, live, [...overwrites, ...named.ask]);
    if (!allows(decision)) {
      await this.serial(live, () => this.dropUnused(live, id, named.copied));
      return decision;
    }
    for (const path of added) live.made.add(path);
    return decision;
  }

  /** Runs work on the run's copies after whatever work on them came first. */
  private serial<T>(live: Live, work: () => Promise<T>): Promise<T> {
    const done = live.queue.then(work);
    // The next piece waits for this one however it ends; this one's failure reaches its own caller.
    live.queue = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  }

  /**
   * Keeps a copy of each user's file a command names, before it runs, when the policy can't tell what the command does
   * with it: code for an interpreter, a script, a path in a variable. A file is named by its name, its path from the
   * folder or its full path, anywhere in the command or in a small script in the folder that the command names. A
   * command that only reads (cat, grep, Get-Content, `officecli view`) needs no copy, and neither do files the card
   * already covers (`skip`), files the task may change, or a file that has its copy in this run already: one copy per
   * file per run, however many commands name it. A file bigger than COPY_MAX, or one that can't be copied, goes on the
   * card instead (`ask`). `copied` are the copies made for this command.
   * shortcut: a name the command builds (`'Preventivo' + '.txt'`, a loop over the folder) isn't found here; the check
   * at the run's end lists such a change, without an earlier version.
   */
  private async copyNamed(
    live: Live,
    id: string,
    command: string,
    cwd: string,
    skip: string[],
  ): Promise<{ ask: string[]; copied: string[] }> {
    const none = { ask: [], copied: [] };
    const { theirs } = live;
    if (!this.copies || !theirs || onlyReads(command, cwd)) return none;
    const text = [command, ...(await this.scriptsIn(live, command, cwd))].join("\n");
    const named = theirs.named(text, live.workdir, cwd).filter((path) => !skip.includes(path));
    if (!named.length) return none;
    const copies = this.copies;
    return this.serial(live, async () => {
      const ask: string[] = [];
      const copied: string[] = [];
      for (const path of named) {
        if (live.made.has(path)) continue;
        const kept = live.provisional.get(path);
        if (kept) {
          // A file that changed since its copy, by a step that didn't name it, keeps that copy as its earlier version.
          if (!(await this.settled(live, path, kept, false))) kept.running.add(id);
          continue;
        }
        const entry = await stat(path).catch((err: NodeJS.ErrnoException) => {
          if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
          throw err;
        });
        if (!entry?.isFile()) continue;
        if (entry.size > COPY_MAX) {
          ask.push(path);
          continue;
        }
        try {
          const copy = await copies.keep(live.task, path, "overwrite");
          const stamp = { mtimeMs: entry.mtimeMs, size: entry.size };
          live.provisional.set(path, { copy, stamp, running: new Set([id]) });
          copied.push(path);
        } catch (err) {
          // Gone meanwhile: nothing to keep. Any other failure leaves the file to the card, where the user decides.
          if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
          live.log.write({ type: "copy.failed", path, message: err instanceof Error ? err.message : String(err) });
          ask.push(path);
        }
      }
      return { ask, copied };
    });
  }

  /** The text of the scripts a command names that are in the task's folder and small enough to read. */
  private async scriptsIn(live: Live, command: string, cwd: string): Promise<string[]> {
    const texts: string[] = [];
    const paths = pathsFor(cwd);
    // shortcut: the first 10 scripts a command names are read; a command that names more is rare enough to leave.
    for (const name of scriptsNamed(command).slice(0, 10)) {
      const path = paths.resolve(cwd, name);
      if (await outside(live.workdir, path)) continue;
      const entry = await stat(path).catch(() => null);
      if (!entry?.isFile() || entry.size > SCRIPT_MAX) continue;
      // A script that can't be read is left out: what it changes, the check at the run's end lists.
      const text = await readFile(path, "utf8").catch(() => null);
      if (text !== null) texts.push(text);
    }
    return texts;
  }

  /** Drops the copies made for a command the user didn't let run, unless another command still counts on them. */
  private async dropUnused(live: Live, id: string, paths: string[]): Promise<void> {
    for (const path of paths) {
      const kept = live.provisional.get(path);
      if (!kept) continue;
      kept.running.delete(id);
      if (kept.running.size) continue;
      live.provisional.delete(path);
      await this.drop(live, kept.copy);
    }
  }

  private async drop(live: Live, copy: KeptCopy): Promise<void> {
    // A copy that can't be removed only takes space: the run goes on, and the log says so.
    await this.copies?.drop(copy).catch((err: unknown) => {
      live.log.write({
        type: "copy.drop-failed",
        copy: copy.copy,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Whether a copied file changed since its copy was kept. One that changed or is gone keeps the copy as its earlier
   * version and is listed as changed or deleted by the task, exactly as after an allowed card, and the task may change
   * it again in this run without another copy. At the run's end (`ending`) the copy of a file that didn't change is
   * dropped; before that it stays, for the next command that names the file.
   */
  private async settled(live: Live, path: string, kept: Provisional, ending: boolean): Promise<boolean> {
    const now = await stampOf(path);
    if (now && sameStamp(now, kept.stamp)) {
      if (ending) {
        live.provisional.delete(path);
        await this.drop(live, kept.copy);
      }
      return false;
    }
    live.provisional.delete(path);
    const gone = !(await lstat(path).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    }));
    // Like a file the user let the task replace: the copy covers it for the rest of the run, even once it's gone.
    live.made.add(path);
    live.channel.push({ type: "kept", copy: kept.copy, kind: gone ? "delete" : "update" });
    return true;
  }

  /** A command ended: each file it named, and no other running command still names, is compared with its copy. */
  private async settle(live: Live, id: string): Promise<void> {
    for (const [path, kept] of [...live.provisional])
      if (kept.running.delete(id) && !kept.running.size) await this.settleOne(live, path, kept, false);
  }

  /** At the run's end, every copy still held is compared with its file, whether or not its command's end came. */
  private async settleAll(live: Live): Promise<void> {
    for (const [path, kept] of [...live.provisional]) await this.settleOne(live, path, kept, true);
  }

  private async settleOne(live: Live, path: string, kept: Provisional, ending: boolean): Promise<void> {
    try {
      await this.settled(live, path, kept, ending);
    } catch (err) {
      // A file that can't be looked at doesn't fail the run: its copy stays in the kept folder, unlisted, and the log
      // says so.
      live.log.write({ type: "copy.settle-failed", path, message: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Lists the user's files that changed or went during the run with neither a card nor a copy: a script that walked
   * the folder, or code that built a file's name. There's no earlier version to give back, but the user sees what
   * changed. Needs both listings, so a run with too many files, or one that Stop ended, lists none.
   */
  private unseen(live: Live, after: Map<string, Listed> | null): void {
    if (!live.before || !after) return;
    for (const [key, was] of live.before) {
      const { path, stamp } = was;
      if (!stamp || live.startOwn.has(path) || live.made.has(path) || live.trashed.has(path)) continue;
      const now = after.get(key);
      if (now?.stamp && sameStamp(stamp, now.stamp)) continue;
      live.channel.push({
        type: "file",
        change: { path, kind: now ? "update" : "delete", role: "made" },
        unkept: true,
      });
    }
  }

  /**
   * Whether the agent may change a file without asking: one it may already change (`made`), or one that's there now
   * but wasn't when the run started, such as a file a script made, which no reader of commands can tell. Without a
   * listing, no file counts as new. Each file found this way is the task's own from then on, saved on the task when the
   * run ends.
   */
  private async mayChange(live: Live, path: string): Promise<boolean> {
    if (live.made.has(path)) return true;
    const { before } = live;
    if (!before || !(await exists(path))) return false;
    const real = await realTarget(path);
    if (!real) return false;
    if (before.has(pathKey(path)) || before.has(pathKey(real))) return false;
    live.made.add(path);
    live.own.add(path);
    return true;
  }

  /**
   * The files the task owns once the run ends: those it owned before, those found while it ran, and every other file
   * that's in the folder now and wasn't when the run started, less any that are gone. Without both listings only the
   * first two count. Each comes with how it looks now, which the next run compares with, so a change the task made in
   * this run isn't taken for the user's.
   */
  private async ownAtEnd(live: Live, after: Map<string, Listed> | null): Promise<Owned> {
    const { before } = live;
    const found = new Set(live.own);
    if (before && after) for (const [key, { path }] of after) if (!before.has(key)) found.add(path);
    const own: Owned = { paths: [], seen: {} };
    for (const path of found) {
      if (own.paths.length >= OWN_MAX) break;
      // A file that's gone, or that can't be read now, is left out: changing it later asks first.
      const stamp = await stampOf(path);
      if (stamp) {
        own.paths.push(path);
        own.seen[path] = stamp;
      }
    }
    return own;
  }

  /** Asks before files that were already there are replaced, unless there are none. */
  private async overwrite(taskId: string, live: Live, overwrites: string[]): Promise<ApprovalDecision> {
    if (!overwrites.length) return "allow";
    const decided = (await this.askApproval(taskId, "overwrite", overwrites)) ?? "refuse";
    if (decided !== "allow") return { decision: "deny", message: OVERWRITE_NOTE[decided](overwrites.join(", ")) };
    // A copy is kept now, so a second try at the same change in this run doesn't ask again: Codex refuses a patch that
    // deletes and adds one file, and the model then sends the same change as an update.
    for (const path of overwrites) live.made.add(path);
    return "allow";
  }

  /** Shows the card for a step that waits on the user, and waits for the decision or for the run to end. */
  private askApproval(taskId: string, action: "overwrite" | "delete", paths: string[]): Promise<Decision | null> {
    const live = this.live.get(taskId);
    // After Stop nothing new goes on the task: an abort that already happened never fires its listener.
    if (!live || live.signal.aborted) return Promise.resolve(null);
    const id = randomUUID();
    this.approvals.set(id, { taskId, action, paths });
    return new Promise((resolve) => {
      const done = (reply: Decision | null) => {
        this.waiting.delete(id);
        live.pending.delete(id);
        live.signal.removeEventListener("abort", stop);
        resolve(reply);
      };
      const stop = () => done(null);
      this.waiting.set(id, done);
      live.pending.add(id);
      live.signal.addEventListener("abort", stop, { once: true });
      live.channel.push({ type: "approval", approval: { id, action, paths } });
    });
  }
}
