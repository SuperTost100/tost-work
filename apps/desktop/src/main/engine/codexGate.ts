import { posix, win32 } from "node:path";
import type { ApprovalRequest } from "cli-funnel";

/**
 * What Codex's PreToolUse hook hands Tost Work before each step, turned into the requests the approval policy takes
 * (see AgentEngine.policy), so Codex and Claude Code go through one policy. Codex runs with no approvals of its own,
 * so this hook is where the overwrite and delete cards come from.
 */

/** One step Codex is about to take: a command, a patch, an MCP call or another of its tools. */
export interface HookCall {
  /** Codex's call id, which its later `tool.start` event carries too. */
  id: string;
  tool: string;
  input: unknown;
  /** The folder the step runs in: the command's own working directory, or the task's folder. */
  cwd: string;
}

/** The hook's input, checked: null when a field the policy needs is missing. */
export function hookCall(body: unknown): HookCall | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return null;
  const { tool_use_id: id, tool_name: tool, tool_input: input, cwd } = b;
  if (typeof id !== "string" || !id || typeof tool !== "string" || !tool || typeof cwd !== "string" || !cwd)
    return null;
  return { id, tool, input, cwd };
}

/** One file a patch touches. An existing file's Delete and Add in one patch is an overwrite, not a deletion. */
export interface PatchChange {
  path: string;
  kind: "add" | "update" | "delete";
  movedTo?: string;
}

/** The path functions for a folder's own system, so Windows paths resolve as Windows paths on any computer. */
const pathsFor = (folder: string) => (/^[A-Za-z]:[\\/]|^\\\\/.test(folder) ? win32 : posix);

const PATCH = /\*\*\* Begin Patch[\s\S]*?(?:\*\*\* End Patch|$)/g;
const FILE_LINE = /^\s*\*\*\* (Add|Delete|Update) File: (.+?)\s*$/;
const MOVE_LINE = /^\s*\*\*\* Move to: (.+?)\s*$/;

/**
 * The files the apply_patch patches in `text` touch, with each path resolved against `cwd`. A path named by a Delete
 * and an Add counts once, as an update: that's how a model sometimes rewrites a whole file.
 */
export function patchChanges(text: string, cwd: string): PatchChange[] {
  const paths = pathsFor(cwd);
  const ops: PatchChange[] = [];
  for (const patch of text.match(PATCH) ?? []) {
    for (const line of patch.split(/\r?\n/)) {
      const file = FILE_LINE.exec(line);
      if (file?.[1] && file[2]) {
        ops.push({ path: paths.resolve(cwd, file[2]), kind: file[1].toLowerCase() as PatchChange["kind"] });
        continue;
      }
      const move = MOVE_LINE.exec(line);
      const last = ops.at(-1);
      if (move?.[1] && last?.kind === "update") last.movedTo = paths.resolve(cwd, move[1]);
    }
  }
  // Several operations on one path: a Delete then an Add rewrites the file; one that ends in a Delete deletes it.
  const byPath = new Map<string, PatchChange[]>();
  for (const op of ops) byPath.set(op.path, [...(byPath.get(op.path) ?? []), op]);
  return [...byPath.values()].map((same) => {
    const last = same.at(-1) as PatchChange;
    if (same.length === 1 || last.kind === "delete") return last;
    const movedTo = same.find((op) => op.movedTo)?.movedTo;
    return { path: last.path, kind: "update", ...(movedTo ? { movedTo } : {}) };
  });
}

/** apply_patch run as a command: Codex applies a heredoc patch itself, and its sandbox has an apply_patch program. */
const RUNS_PATCH = /(^|[^\w.-])(apply_patch|applypatch)(?![\w.-])/g;
/** `cd <dir> &&` before apply_patch, the one form whose folder Codex itself takes into account. */
const CD_PREFIX = /^\s*cd\s+('[^']*'|"[^"]*"|[^\s;&|]+)\s*&&\s*(apply_patch|applypatch)\b/;
/** A change of folder anywhere else in the command, which would move where the patch's relative paths land. */
const CHANGES_FOLDER = /(^|[\s;&|(])(cd|pushd|popd|chdir|Set-Location|sl|Push-Location)(\s|$|;)/i;

/** What a command that runs apply_patch writes: the changes, or null when the patch can't be read from the command. */
export function commandPatch(command: string, cwd: string): PatchChange[] | null {
  const runs = command.match(RUNS_PATCH)?.length ?? 0;
  if (!runs) return [];
  // A patch read from a file or a variable can't be checked, so each apply_patch needs its patch in the command.
  if (runs > (command.match(PATCH)?.length ?? 0)) return null;
  const prefix = CD_PREFIX.exec(command);
  const rest = prefix ? command.slice(prefix[0].length) : command;
  if (CHANGES_FOLDER.test(rest.replace(PATCH, ""))) return null;
  const dir = prefix?.[1] ? prefix[1].replace(/^['"]|['"]$/g, "") : ".";
  return patchChanges(command, pathsFor(cwd).resolve(cwd, dir));
}

/** A request for the policy, or a refusal before it, for one step the hook saw. */
export type GateRequest =
  | { refuse: string }
  | { command?: ApprovalRequest; change?: ApprovalRequest; other?: ApprovalRequest };

const asChange = (id: string, changes: PatchChange[]): ApprovalRequest => ({
  id,
  tool: "file_change",
  input: {
    changes: changes.map((c) => ({ path: c.path, kind: c.kind, ...(c.movedTo ? { move_path: c.movedTo } : {}) })),
  },
});

const UNREADABLE_PATCH =
  "Tost Work couldn't read this patch. Use the apply_patch tool with the whole patch, or run apply_patch on its own with the patch in a heredoc.";

/**
 * The requests the policy decides one hook call on. A shell command is checked as a command, and a patch it carries
 * as a file change too; apply_patch is a file change; an MCP call is named `mcp:server/tool`, as cli-funnel names it.
 */
export function gateRequest(call: HookCall): GateRequest {
  const input = (call.input ?? {}) as Record<string, unknown>;
  if (call.tool === "apply_patch") {
    const patch = typeof input.command === "string" ? input.command : typeof call.input === "string" ? call.input : "";
    const changes = patchChanges(patch, call.cwd);
    return changes.length ? { change: asChange(call.id, changes) } : { refuse: UNREADABLE_PATCH };
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(call.tool);
  if (mcp) return { other: { id: call.id, tool: `mcp:${mcp[1]}/${mcp[2]}`, input: call.input } };
  // Bash, and any other tool that runs a command it's given.
  if (typeof input.command === "string") {
    const changes = commandPatch(input.command, call.cwd);
    if (changes === null) return { refuse: UNREADABLE_PATCH };
    return {
      command: { id: call.id, tool: "command", input: { command: input.command } },
      ...(changes.length ? { change: asChange(call.id, changes) } : {}),
    };
  }
  return { other: { id: call.id, tool: call.tool, input: call.input } };
}

/** Shells and interpreters that read commands from their input when they're given nothing to run. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);
const POWERSHELLS = new Set(["pwsh", "powershell"]);
const SCRIPTING = /^(python[\d.]*|py|ipython\d*|node|nodejs|deno|perl|ruby|irb|php|lua|tclsh)$/i;
/** Words that run the program after them, with the options they take. */
const PREFIXES = new Set(["sudo", "env", "exec", "command", "nohup", "time", "nice", "builtin", "stdbuf", "doas"]);

/** The words of one simple command, with quoted strings as one placeholder word each. */
function wordsOf(segment: string): string[] {
  return segment.split(/\s+/).filter(Boolean);
}

/** The program a segment runs, its arguments, and whether its input comes from elsewhere (a redirect). */
function programOf(segment: string): { name: string; args: string[]; redirected: boolean } | null {
  const redirected = /(^|[^<])<(?!\()/.test(segment) || /\b0<|<<</.test(segment);
  let words = wordsOf(segment.replace(/\d?>>?\s*\S+|&>\s*\S+/g, " "));
  // Variables set for the command, then the words that only run it: sudo -u bob, env -i X=1, exec, …
  for (;;) {
    while (words[0] && /^[A-Za-z_]\w*=/.test(words[0])) words = words.slice(1);
    const first = words[0];
    if (!first) return null;
    const bare = first.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
    if (!PREFIXES.has(bare.toLowerCase())) return { name: bare, args: words.slice(1), redirected };
    words = words.slice(1);
    while (words[0]?.startsWith("-")) {
      const option = words[0];
      words = words.slice(1);
      // sudo -u bob, env -C dir, nice -n 5: the option's value is the next word.
      if (/^-[uCgnS]$/.test(option) && words[0]) words = words.slice(1);
    }
  }
}

/** Whether a shell, PowerShell or cmd with these arguments is left reading commands from its input. */
function readsCommands(name: string, args: string[]): boolean {
  const lower = name.toLowerCase();
  const flags = args.filter((a) => a.startsWith("-") || a.startsWith("/"));
  const operands = args.filter((a) => !a.startsWith("-") && !a.startsWith("/"));
  if (SHELLS.has(lower)) {
    if (flags.some((f) => /^-[a-z]*s[a-z]*$/i.test(f) && !f.startsWith("--"))) return true;
    if (flags.some((f) => /^-[a-z]*c[a-z]*$/i.test(f) && !f.startsWith("--"))) return false;
    return operands.length === 0;
  }
  if (POWERSHELLS.has(lower)) {
    if (flags.some((f) => /^-noexit$/i.test(f))) return true;
    const runs = args.findIndex((a) => /^-(c|command|f|file|e|ec|encodedcommand)$/i.test(a));
    if (runs >= 0) return args[runs + 1] === "-" || args[runs + 1] === undefined;
    return operands.length === 0;
  }
  if (lower === "cmd") {
    if (args.some((a) => /^\/k$/i.test(a))) return true;
    return !args.some((a) => /^\/c$/i.test(a));
  }
  if (SCRIPTING.test(name)) {
    if (flags.some((f) => /^(-i|--interactive)$/.test(f))) return true;
    if (args.includes("-")) return true;
    // A script, a module or code to run: -c, -m, -e, -p, --eval, --print, -r (php).
    if (flags.some((f) => /^(-[cmepr]|--eval|--print|--command)$/.test(f))) return false;
    return operands.length === 0;
  }
  return false;
}

/**
 * A quoted word as one placeholder, except a quoted program path, which keeps its program's name: Codex on Windows
 * may run `"C:\Program Files\PowerShell\7\pwsh.exe"`.
 */
function quotedWord(quoted: string): string {
  const inner = quoted.slice(1, -1);
  const base = inner.split(/[\\/]/).pop() ?? "";
  return /[\\/]/.test(inner) && /^[\w.-]+$/.test(base) ? ` ${base} ` : " Q ";
}

const HEREDOC_BODY = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g;
const QUOTED_TEXT = /'[^']*'|"(?:[^"\\]|\\.)*"/g;
const SUBSTITUTED = /\$\(([^()]*)\)|`([^`]*)`/g;

/**
 * Whether a command leaves a shell or an interpreter waiting for commands on its input, such as a bare `bash`,
 * `python` or `cmd`. Codex's hook doesn't see what's typed into a running command afterwards (`write_stdin`), so text
 * typed there would skip the delete check. A program whose input is piped or redirected doesn't count: it reads that,
 * not what's typed.
 */
export function opensShell(command: string): boolean {
  const inner = [...command.matchAll(SUBSTITUTED)].map((m) => m[1] ?? m[2] ?? "");
  if (inner.some(opensShell)) return true;
  const flat = command
    .replace(HEREDOC_BODY, " <<H ")
    .replace(QUOTED_TEXT, quotedWord)
    .replace(SUBSTITUTED, " Q ")
    // Redirects that copy a stream (2>&1) or send both to a file (&>), which would otherwise split at their &.
    .replace(/\d*[<>]&\d*-?/g, " ")
    .replace(/&>>?/g, " > ");
  for (const statement of flat.split(/;|&&|\|\||&|\n/)) {
    // Only the first program of a pipeline reads what's typed: the rest read the pipe.
    const first = statement.split("|")[0] ?? "";
    const program = programOf(first);
    if (program && !program.redirected && readsCommands(program.name, program.args)) return true;
  }
  return false;
}
