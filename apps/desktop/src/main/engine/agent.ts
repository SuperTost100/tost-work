import { randomUUID } from "node:crypto";
import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { ApprovalDecision, ApprovalRequest, Funnel } from "cli-funnel";
import { translate } from "../../shared/i18n";
import type { AgentProvider, AiId, Decision, EngineEvent, Job, KeyVendor, Review, Skill } from "../../shared/model";
import { KEY_PROVIDER, PROVIDER_OF } from "../../shared/model";
import {
  type AiModels,
  DEFAULT_PICK,
  type ModelChoices,
  type ModelOption,
  type ModelPick,
  pickOn,
} from "../../shared/modelChoice";
import { type SandboxReadiness, sandboxFor } from "../../shared/sandbox";
import { HOOK_TOKEN_ENV, HOOK_URL_ENV } from "../codexHook";
import type { TaskLog } from "../debugLog";
import { freeName, inside } from "../files";
import type { HookAnswer, ToolHandler } from "../mcp/server";
import { SandboxNotReady, UserError } from "../userError";
import { activityOf, noteText } from "./activity";
import { gateRequest, hookCall, opensShell } from "./codexGate";
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

/**
 * Programs and PowerShell commands that delete: rm, unlink, shred and trash; cmd's del, erase, rd and rmdir; and
 * PowerShell's Remove-Item with its aliases rm, ri, del, erase, rd and rmdir.
 */
const DELETES = new Set(["rm", "rmdir", "del", "erase", "rd", "ri", "unlink", "shred", "trash", "remove-item"]);
/**
 * Words that run a program named later in the command, such as sudo, xargs and find's -exec, and the shell's keywords
 * before a command. Every word after one of them is read as a program's name too.
 */
const RUNS_NEXT = new Set([
  ...["sudo", "doas", "env", "command", "builtin", "exec", "nohup", "nice", "ionice", "time", "timeout", "stdbuf"],
  ...["xargs", "busybox", "toybox", "-exec", "-execdir", "-ok", "-okdir", ".", "call", "start"],
  ...["if", "then", "else", "elif", "do", "while", "until", "!"],
]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "fish", "csh", "tcsh"]);
/** Programs whose payload runs as commands, which the check reads as a script of its own. */
const UNWRAPS = new Set([...SHELLS, "cmd", "powershell", "pwsh", "eval", "iex", "invoke-expression"]);
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
/** Nested shells and payloads deeper than this aren't read: the command is taken as deleting. */
const MAX_DEPTH = 10;
/** A shell where a command starts, by name or path: bash and /bin/sh, but not a file named cleanup.sh. */
const SHELL = String.raw`(^|[\s;&|(])(\S*\/)?((ba|z|da|k)?sh|fish)`;
/** A line that hands a heredoc to a shell, whose body is then commands. */
const SHELL_READS = new RegExp(String.raw`${SHELL}(\s|<|$)`);
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g;
const SUBSTITUTION = /\$\(([^()]*)\)|`([^`]*)`/g;

/** The text before `offset` on its line. */
const lineBefore = (text: string, offset: number) => text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);

const codeDeletes = (text: string) => CODE_DELETES.some((pattern) => pattern.test(text));

/** Whether `option` is `full` or a prefix of it at least `min` characters long, as PowerShell reads its options. */
const prefixOf = (full: string, option: string, min = 2) => option.length >= min && full.startsWith(option);

/**
 * A script with its heredocs' bodies taken out, and the bodies, whose code is still checked. A body a shell reads
 * stays in as commands. Any other body is text, except for the $(…) and `…` in one whose delimiter isn't quoted,
 * which the shell runs.
 */
function heredocs(script: string): { text: string; bodies: string[] } {
  const bodies: string[] = [];
  const text = script.replace(HEREDOC, (body: string, quote: string, _tag: string, offset: number) => {
    bodies.push(body);
    if (SHELL_READS.test(lineBefore(script, offset))) return body;
    if (quote) return "";
    return [...body.matchAll(SUBSTITUTION)].map((m) => `\n${m[1] ?? m[2] ?? ""}\n`).join("");
  });
  return { text, bodies };
}

/** One word of a command as the shell passes it on: quotes removed and adjacent pieces joined. */
interface Word {
  text: string;
  /** Whether any of it stood outside quotes. */
  bare: boolean;
  /** Where its quoted pieces sit in the script, so the code check can leave out quoted text. */
  quotes: [number, number][];
  /** Whether it follows <<<, so it's the program's input: a script, when the program is a shell. */
  fed: boolean;
}

/** The index of the parenthesis that closes the one at `open`, skipping quoted text, or the script's end. */
function closing(script: string, open: number): number {
  let depth = 0;
  for (let i = open; i < script.length; i++) {
    const c = script[i];
    if (c === "'" || c === '"') {
      const end = script.indexOf(c, i + 1);
      if (end < 0) return script.length;
      i = end;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return script.length;
}

/**
 * A script split into commands of words, as POSIX shells, cmd and PowerShell would split it closely enough for the
 * delete check: commands end at a newline, ;, &, |, a parenthesis or a brace, which also skips PowerShell's call
 * operator. It also returns the $(…) and `…` substitutions, which run even inside double quotes. A backtick with no
 * partner is PowerShell's escape. A backslash escapes only what a POSIX shell would treat specially, because in
 * Windows paths it separates folders.
 */
function parse(script: string): { commands: Word[][]; substitutions: string[] } {
  const commands: Word[][] = [];
  const substitutions: string[] = [];
  let words: Word[] = [];
  let word: Word | null = null;
  let feed = false;
  const piece = (): Word => {
    word ??= { text: "", bare: false, quotes: [], fed: feed };
    feed = false;
    return word;
  };
  const bare = (text: string) => {
    const w = piece();
    w.text += text;
    w.bare = true;
  };
  const endWord = () => {
    if (word) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  let i = 0;
  while (i < script.length) {
    const c = script[i] as string;
    const next = script[i + 1] ?? "";
    if (c === "'") {
      const end = script.indexOf("'", i + 1);
      const close = end < 0 ? script.length : end;
      const w = piece();
      w.text += script.slice(i + 1, close);
      w.quotes.push([i, close + 1]);
      i = close + 1;
    } else if (c === '"') {
      let j = i + 1;
      let text = "";
      while (j < script.length && script[j] !== '"') {
        const after = script[j + 1] ?? "";
        // A POSIX shell's \" \\ \$ \`, and PowerShell's `".
        if ((script[j] === "\\" && after && '"\\$`'.includes(after)) || (script[j] === "`" && after === '"')) {
          text += after;
          j += 2;
        } else text += script[j++];
      }
      const w = piece();
      w.text += text;
      w.quotes.push([i, j + 1]);
      for (const m of script.slice(i + 1, j).matchAll(SUBSTITUTION)) substitutions.push(m[1] ?? m[2] ?? "");
      i = j + 1;
    } else if (c === "$" && next === "(") {
      const end = closing(script, i + 1);
      substitutions.push(script.slice(i + 2, end));
      bare(script.slice(i, end + 1));
      i = end + 1;
    } else if (c === "`") {
      const end = script.indexOf("`", i + 1);
      if (end < 0) {
        bare(next);
        i += 2;
      } else {
        substitutions.push(script.slice(i + 1, end));
        bare(script.slice(i, end + 1));
        i = end + 1;
      }
    } else if (c === "\\" && next === "\n") i += 2;
    else if (c === "\\" && next && /[\s"'`$;&|<>(){}\\]/.test(next)) {
      bare(next);
      i += 2;
    } else if (c === "\n") {
      endCommand();
      i++;
    } else if (/\s/.test(c)) {
      endWord();
      i++;
    } else if (c === "<" || c === ">" || (c === "&" && next === ">")) {
      // A redirection, such as > out.txt, 2>&1 or &> log.txt: its target is a word of the command.
      endWord();
      const start = i;
      while (i < script.length && /[<>&|]/.test(script[i] as string)) i++;
      feed = script.slice(start, i) === "<<<";
      if (script[i - 1] === "&") while (/[\d-]/.test(script[i] ?? "")) i++;
    } else if (";&|(){}".includes(c)) {
      endCommand();
      i++;
    } else {
      bare(c);
      i++;
    }
  }
  endCommand();
  return { commands, substitutions };
}

/**
 * The names a word may run as a program, in lowercase: the word, its last part without folders and .exe, and, in a
 * program's place, the part before a slash, because cmd reads del/q as del /q.
 */
function namesOf(word: string, program: boolean): string[] {
  const lower = word.toLowerCase();
  const base = (lower.split(/[\\/]/).pop() ?? "").replace(/\.exe$/, "");
  return program ? [lower, base, lower.split("/")[0] ?? ""] : [lower, base];
}

/** Whether a program, given the words after it, runs a deletion: a nested shell's payload, find's -delete, git clean. */
function nestedDeletes(name: string, rest: string[], depth: number): boolean {
  if (SHELLS.has(name)) {
    const flag = rest.findIndex((t) => /^-[a-z]*c[a-z]*$/i.test(t));
    return flag >= 0 && deletes(rest[flag + 1] ?? "", depth + 1);
  }
  if (name === "cmd") {
    // cmd's switches, such as /d /s /q, may come before /c or /k, and ^ is its escape.
    const at = rest.findIndex((t) => /^\/[ck]/i.test(t));
    if (at < 0) return false;
    const payload = [rest[at]?.slice(2) ?? "", ...rest.slice(at + 1)].join(" ");
    return deletes(payload.replace(/\^([\s\S])/g, "$1"), depth + 1);
  }
  if (name === "powershell" || name === "pwsh") {
    for (const [at, option] of rest.map((t) => t.toLowerCase()).entries()) {
      // PowerShell reads -EncodedCommand (any prefix from -e, or -ec) as base64 of UTF-16LE text.
      if (prefixOf("-encodedcommand", option) || option === "-ec")
        return deletes(Buffer.from(rest[at + 1] ?? "", "base64").toString("utf16le"), depth + 1);
      if (prefixOf("-command", option)) return deletes(rest.slice(at + 1).join(" "), depth + 1);
      if (prefixOf("-file", option)) return false;
    }
    // With neither, Windows PowerShell runs the words after its options as a command.
    return deletes(rest.filter((t) => !t.startsWith("-")).join(" "), depth + 1);
  }
  if (name === "eval" || name === "iex" || name === "invoke-expression") return deletes(rest.join(" "), depth + 1);
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
  /** Files this task made, which the agent may change again without asking. */
  made: Set<string>;
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
  private platform: string;
  private sandboxReady: (provider: AgentProvider) => Promise<SandboxReadiness>;
  private codexHook: (workdir: string) => Promise<void>;

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
    this.taskLog = options.taskLog ?? (() => ({ write: () => {} }));
    this.platform = options.platform ?? process.platform;
    this.sandboxReady = options.sandboxReady ?? (async () => READY);
    this.codexHook =
      options.codexHook ??
      (async () => {
        throw new UserError("error.codexHookOff", { detail: "no check was given" });
      });
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
    return models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      efforts: m.efforts.map((e) => e.id),
      ...(m.defaultEffort ? { defaultEffort: m.defaultEffort } : {}),
    }));
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
    const ai = await this.ai();
    const { provider } = await this.target(ai);
    const ais = [ai, ...(await this.usable()).filter((x) => x !== ai)];
    const lists: AiModels[] = [];
    for (const id of ais) {
      const target = await this.target(id).catch(() => null);
      if (!target) continue;
      // A list that can't be read leaves that AI out of the full list rather than failing the picker.
      const models = await this.modelsOf(target.provider).catch(() => null);
      if (models) lists.push({ ai: id, provider: target.provider, models });
    }
    return { ai, provider, lists };
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
    // Stop aborts the run, and so does the engine when Codex takes a step its hook never allowed.
    const abort = new AbortController();
    const onStop = () => abort.abort();
    if (stopped.aborted) abort.abort();
    else stopped.addEventListener("abort", onStop, { once: true });
    const signal = abort.signal;
    const channel = new Channel<EngineEvent>();
    // Files the task created. A file with a kept copy existed before the task (it was overwritten with approval, or
    // restored since), so changing it again always asks.
    const kept = new Set((task.kept ?? []).map((k) => k.path));
    const made = new Set(
      task.files.filter((f) => f.role === "made" && f.kind !== "delete" && !kept.has(f.path)).map((f) => f.path),
    );
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
    const live: Live = { channel, signal, workdir, made, pending: new Set(), allowed: new Set(), log };
    this.live.set(task.id, live);
    const access = codex ? "full" : "supervised";
    log.write({
      type: "run",
      provider,
      model: task.model,
      effort: task.effort,
      access,
      sandbox,
      cwd: workdir,
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      followUp: followUp !== null,
    });

    // A skills folder that can't be read leaves the task without skills rather than failing it.
    const skills = await this.skills().catch(() => []);
    // Claude Code can leave a command or a subagent running in the background and end its turn, saying it will look
    // later. Nothing would wake it to look, and the task would show as finished, so here it waits for each one.
    // Codex's hook finds Tost Work through the run's address and token, which the commands Codex runs don't get.
    const env = codex
      ? {
          ...this.documents?.env,
          [HOOK_URL_ENV]: new URL("/hook", session.url).toString(),
          [HOOK_TOKEN_ENV]: session.token,
        }
      : { ...this.documents?.env, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" };
    const stream = this.funnel.stream({
      selection: { provider, model: task.model, effort: task.effort, cwd: workdir, access },
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
            if (event.kind === "delete") made.delete(path);
            else made.add(path);
            channel.push({ type: "file", change: { path, kind: event.kind, role: "made" } });
          }
        }
        const result = await stream.result;
        log.write({ type: "run.end", finishReason: result.finishReason, deniedActions: result.deniedActions });
        if (unchecked) channel.push({ type: "failed", error: translate(this.language(), "error.codexUnchecked") });
        else if (result.finishReason === "cancelled") channel.push({ type: "stopped" });
        else {
          if (result.text.trim()) channel.push({ type: "message", text: result.text.trim() });
          channel.push({ type: "done" });
        }
      } catch (err) {
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

  async approve(taskId: string, action: "overwrite" | "delete", paths: string[]): Promise<string> {
    const live = this.mustLive(taskId);
    const id = randomUUID();
    this.approvals.set(id, { taskId, action, paths });
    live.channel.push({ type: "approval", approval: { id, action, paths } });
    return END_TURN;
  }

  async reportFile(taskId: string, change: { path: string; kind: "add" | "update" | "delete" }): Promise<void> {
    this.mustLive(taskId).channel.push({ type: "file", change: { ...change, role: "made" } });
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
   * What the agent may do without the user: new files, changes to files this task made, and commands other than
   * deletions. Changing a file that was already there, or deleting one, goes through the approval card, and Tost Work
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
      const input = (request.input ?? {}) as { command?: unknown; dangerouslyDisableSandbox?: unknown };
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
          message:
            "Don't delete files with commands. Call request_approval with action delete, and Tost Work moves them to the Trash.",
        };
      // What's typed into a shell that's already running isn't checked, so commands can't open one to type into.
      if (opensShell(command))
        return {
          decision: "deny",
          message:
            "Don't start a shell or an interpreter to type commands into. Run the command, script or code directly, in this one call.",
        };
      return "allow";
    }
    if (request.tool !== "file_change") return "allow";

    const changes = changesOf(request.input);
    for (const c of changes)
      for (const target of [c.path, c.movedTo])
        if (target && (await outside(live.workdir, target)))
          return { decision: "deny", message: "Work only inside the task's folder." };
    const deletes = changes.filter((c) => c.kind === "delete").map((c) => c.path);
    // A file that's already there is overwritten by a change, by an add (a patch's Add File replaces it) and by a move
    // onto it, unless the task made it.
    const overwrites: string[] = [];
    for (const c of changes) {
      if (c.kind === "delete") continue;
      const targets = [c.kind === "add" && !(await exists(c.path)) ? null : c.path];
      if (c.movedTo && (await exists(c.movedTo))) targets.push(c.movedTo);
      for (const target of targets)
        if (target && !live.made.has(target) && !overwrites.includes(target)) overwrites.push(target);
    }
    if (deletes.length) {
      const decided = await this.askApproval(taskId, "delete", deletes);
      return {
        decision: "deny",
        message:
          decided === "allow"
            ? "The user allowed it, and Tost Work moved the files to the Trash. Don't delete them again."
            : "The user wants to keep these files. Leave them as they are.",
      };
    }
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
