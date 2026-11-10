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
export const pathsFor = (folder: string) => (/^[A-Za-z]:[\\/]|^\\\\/.test(folder) ? win32 : posix);

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const ADD = "*** Add File: ";
const DELETE = "*** Delete File: ";
const UPDATE = "*** Update File: ";
const MOVE = "*** Move to: ";
const END_OF_FILE = "*** End of File";

/**
 * The characters Rust's `trim` takes off, Unicode's White_Space. JavaScript's `\s` differs: it lacks U+0085, which
 * Codex trims off a header, and has U+FEFF, which Codex keeps.
 */
const SPACE = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const LEADING = new RegExp(`^[${SPACE}]+`);
const TRAILING = new RegExp(`[${SPACE}]+$`);
const trimEnd = (text: string) => text.replace(TRAILING, "");
const trim = (text: string) => trimEnd(text).replace(LEADING, "");
/** Rust's `lines`: split at \n only, each line without one \r at its end, and no empty line after a final \n. */
const rustLines = (text: string) => {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (text.endsWith("\n")) lines.pop();
  return lines;
};

interface Hunk {
  kind: PatchChange["kind"];
  path: string;
  movePath?: string;
  /** An Update's chunks: how many lines each removes and adds, and whether it ends at the end of the file. */
  chunks: { old: number; new: number; eof: boolean }[];
}

/**
 * Codex's StreamingPatchParser (apply-patch/src/streaming_parser.rs in Codex 0.166 and 0.167), line by line, for the
 * files a patch touches. It starts after *** Begin Patch. Each call takes one line and says whether the patch ended
 * there; it throws where Codex refuses the patch, and where Tost Work can't be sure it reads the patch as Codex does.
 * The rules that decide the files: a header ends the hunk before it; an Add's or a Delete's lines are matched with
 * their whitespace trimmed, an Update's with only the end trimmed, so an indented header inside an Update is one of
 * its lines; and *** End Patch ends the patch only where a header would count.
 */
class PatchReader {
  hunks: Hunk[] = [];
  private mode: "started" | "add" | "delete" | "update" = "started";

  private refuse(): never {
    throw new Error("unreadable patch");
  }

  /** Codex refuses a header or an end that follows an Update with no lines, or a chunk with none. */
  private updateHasLines(): void {
    const last = this.hunks.at(-1);
    if (last?.kind !== "update") return;
    if (!last.chunks.length && this.mode === "update") this.refuse();
    const chunk = last.chunks.at(-1);
    if (chunk && !chunk.old && !chunk.new) this.refuse();
  }

  /** A header or the end: "end", "header", or false for any other line. */
  private header(text: string): "end" | "header" | false {
    // A patch for another of Codex's environments, which Tost Work doesn't use.
    if (this.mode === "started" && text.startsWith("*** Environment ID:")) this.refuse();
    if (text === END) {
      this.updateHasLines();
      return "end";
    }
    for (const [marker, kind] of [
      [ADD, "add"],
      [DELETE, "delete"],
      [UPDATE, "update"],
    ] as const)
      if (text.startsWith(marker)) {
        this.updateHasLines();
        this.hunks.push({ kind, path: text.slice(marker.length), chunks: [] });
        this.mode = kind;
        return "header";
      }
    return false;
  }

  /** One line of the patch: true when it ends the patch. */
  line(line: string): boolean {
    if (this.mode !== "update") {
      const found = this.header(trim(line));
      if (found) return found === "end";
      if (this.mode === "add" && line.startsWith("+")) return false;
      return this.refuse();
    }
    const text = trimEnd(line);
    const found = this.header(text);
    if (found) return found === "end";
    const hunk = this.hunks.at(-1) as Hunk;
    const chunks = hunk.chunks;
    const last = chunks.at(-1);
    const context = text === "@@" || text.startsWith("@@ ");
    if (last?.eof) {
      if (text === "") return false;
      if (!context) this.refuse();
    }
    if (!chunks.length && hunk.movePath === undefined && text.startsWith(MOVE)) {
      hunk.movePath = text.slice(MOVE.length);
      return false;
    }
    if (context && last && !last.old && !last.new) this.refuse();
    if (context) {
      chunks.push({ old: 0, new: 0, eof: false });
      return false;
    }
    if (text === END_OF_FILE) {
      if (last && !last.old && !last.new) this.refuse();
      if (last) last.eof = true;
      return false;
    }
    const kind = line === "" ? " " : line[0];
    if (kind !== " " && kind !== "+" && kind !== "-") return this.refuse();
    if (!chunks.length) chunks.push({ old: 0, new: 0, eof: false });
    const chunk = chunks.at(-1) as Hunk["chunks"][number];
    if (kind !== "+") chunk.old++;
    if (kind !== "-") chunk.new++;
    return false;
  }

  /** The patch's last line, which Codex ends the patch at whenever its trimmed text is *** End Patch. */
  lastLine(line: string): void {
    if (trim(line) === END) this.updateHasLines();
    else if (!this.line(line)) this.refuse();
  }
}

/**
 * What Codex's `parse_patch` reads from a patch (apply-patch/src/parser.rs): the whole text, trimmed, must start with
 * *** Begin Patch and end with *** End Patch, possibly wrapped in a <<EOF heredoc's lines, and hold nothing after the
 * end. Null where Codex refuses it.
 */
function readPatch(text: string): Hunk[] | null {
  let lines = rustLines(trim(text));
  const bounded = (inner: string[]) =>
    inner.length > 0 && trim(inner[0] as string) === BEGIN && trim(inner.at(-1) as string) === END;
  if (!bounded(lines)) {
    const [first, last] = [lines[0], lines.at(-1)];
    const wrapped = (first === "<<EOF" || first === "<<'EOF'" || first === '<<"EOF"') && last?.endsWith("EOF");
    if (!wrapped || lines.length < 4 || !bounded(lines.slice(1, -1))) return null;
    lines = lines.slice(1, -1);
  }
  // Codex joins the lines again and reads them one by one, the last one on its own.
  const body = rustLines(lines.join("\n"));
  const reader = new PatchReader();
  try {
    let ended = false;
    for (const [n, line] of body.entries()) {
      if (n === 0) continue;
      if (ended) {
        if (trim(line) !== "") return null;
      } else if (n === body.length - 1) {
        reader.lastLine(line);
        ended = true;
      } else ended = reader.line(line);
    }
    return ended ? reader.hunks : null;
  } catch {
    // PatchReader throws only where Codex would refuse the patch or Tost Work can't read it as Codex does.
    return null;
  }
}

/** The changes hunks make, with each path resolved against `cwd`. */
function changesOf(hunks: Hunk[], cwd: string): PatchChange[] {
  const paths = pathsFor(cwd);
  const ops: PatchChange[] = hunks.map((h) => ({
    path: paths.resolve(cwd, h.path),
    kind: h.kind,
    ...(h.movePath !== undefined ? { movedTo: paths.resolve(cwd, h.movePath) } : {}),
  }));
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

/**
 * The files an apply_patch patch touches, read as Codex reads it, with each path resolved against `cwd`, or null when
 * Codex wouldn't apply it. A path named by a Delete and an Add counts once, as an update: that's how a model sometimes
 * rewrites a whole file.
 */
export function patchChanges(text: string, cwd: string): PatchChange[] | null {
  const hunks = readPatch(text);
  return hunks ? changesOf(hunks, cwd) : null;
}

/**
 * The patches in a command's text: each starts at a line whose trimmed text is *** Begin Patch and ends where Codex
 * would end it. Null when one can't be read, or may read differently once the shell has expanded it: outside a
 * heredoc whose delimiter is quoted, the shell replaces $, ` and \ sequences before apply_patch sees the text.
 */
function commandPatches(command: string): { hunks: Hunk[]; count: number; rest: string } | null {
  const lines = rustLines(command);
  const hunks: Hunk[] = [];
  const rest: string[] = [];
  let count = 0;
  for (let n = 0; n < lines.length; n++) {
    if (trim(lines[n] as string) !== BEGIN) {
      rest.push(lines[n] as string);
      continue;
    }
    const opener = [
      ...lines
        .slice(0, n)
        .join("\n")
        .matchAll(/(?<!<)<<-?[ \t]*(\\|['"])?[A-Za-z_]\w*/g),
    ].at(-1);
    const literal = opener?.[1] !== undefined;
    const reader = new PatchReader();
    let ended = false;
    try {
      while (!ended && ++n < lines.length) {
        const line = lines[n] as string;
        if (!literal && /[$`\\]/.test(line)) return null;
        ended = reader.line(line);
      }
    } catch {
      // As in readPatch: a patch Codex would refuse, or one Tost Work can't read as Codex does.
      return null;
    }
    if (!ended) return null;
    hunks.push(...reader.hunks);
    count++;
  }
  return { hunks, count, rest: rest.join("\n") };
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
  const found = commandPatches(command);
  // A patch read from a file or a variable can't be checked, so each apply_patch needs its patch in the command.
  if (!found || runs > found.count) return null;
  const prefix = CD_PREFIX.exec(command);
  const rest = prefix ? found.rest.slice(prefix[0].length) : found.rest;
  if (CHANGES_FOLDER.test(rest)) return null;
  const dir = prefix?.[1] ? prefix[1].replace(/^['"]|['"]$/g, "") : ".";
  return changesOf(found.hunks, pathsFor(cwd).resolve(cwd, dir));
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
    return changes?.length ? { change: asChange(call.id, changes) } : { refuse: UNREADABLE_PATCH };
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(call.tool);
  if (mcp) return { other: { id: call.id, tool: `mcp:${mcp[1]}/${mcp[2]}`, input: call.input } };
  // Bash, and any other tool that runs a command it's given.
  if (typeof input.command === "string") {
    const changes = commandPatch(input.command, call.cwd);
    if (changes === null) return { refuse: UNREADABLE_PATCH };
    return {
      // The command's folder goes with it, for the files its relative paths write.
      command: { id: call.id, tool: "command", input: { command: input.command, cwd: call.cwd } },
      ...(changes.length ? { change: asChange(call.id, changes) } : {}),
    };
  }
  return { other: { id: call.id, tool: call.tool, input: call.input } };
}

/** Shells and interpreters that read commands from their input when they're given nothing to run. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);
const POWERSHELLS = new Set(["pwsh", "powershell"]);
const SCRIPTING = /^(python[\d.]*|py|ipython\d*|node|nodejs|deno|perl|ruby|irb|php|lua|tclsh)$/i;
/** Words that run the program after them, and the options among theirs whose value is the next word. */
const PREFIXES: Record<string, RegExp | null> = {
  sudo: /^-[ugCh]$/,
  doas: /^-[uC]$/,
  env: /^-[CuS]$/,
  nice: /^-n$/,
  stdbuf: /^-[ioe]$/,
  timeout: /^-[sk]$/,
  exec: null,
  command: null,
  builtin: null,
  nohup: null,
  time: null,
  setsid: null,
  busybox: null,
};

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
    const prefix = bare.toLowerCase();
    if (!Object.hasOwn(PREFIXES, prefix)) return { name: bare, args: words.slice(1), redirected };
    const takesValue = PREFIXES[prefix];
    words = words.slice(1);
    while (words[0]?.startsWith("-")) {
      const option = words[0];
      words = words.slice(1);
      // sudo -u bob, env -C dir, nice -n 5, timeout -s KILL: the option's value is the next word.
      if (takesValue?.test(option) && words[0]) words = words.slice(1);
    }
    // timeout 600 bash: the time comes before the program.
    if (prefix === "timeout") words = words.slice(1);
  }
}

/**
 * Whether a shell, PowerShell or cmd with these arguments is left reading commands from its input. A version or help
 * option prints and ends, and only cmd takes options that start with /: elsewhere that's a path, such as a script's.
 */
function readsCommands(name: string, args: string[]): boolean {
  const lower = name.toLowerCase();
  const isFlag = (a: string) => a.startsWith("-") || (lower === "cmd" && a.startsWith("/"));
  const flags = args.filter(isFlag);
  const operands = args.filter((a) => !isFlag(a));
  if (SHELLS.has(lower)) {
    if (flags.some((f) => /^--(version|help)$/.test(f))) return false;
    if (flags.some((f) => /^-[a-z]*s[a-z]*$/i.test(f) && !f.startsWith("--"))) return true;
    if (flags.some((f) => /^-[a-z]*c[a-z]*$/i.test(f) && !f.startsWith("--"))) return false;
    return operands.length === 0;
  }
  if (POWERSHELLS.has(lower)) {
    // Only pwsh reads -v as its version: Windows PowerShell's -Version starts the version it names.
    if (flags.some((f) => /^(-\?|-h|-help|--help)$/i.test(f) || (lower === "pwsh" && /^-(v|version)$/i.test(f))))
      return false;
    if (flags.some((f) => /^-noexit$/i.test(f))) return true;
    const runs = args.findIndex((a) => /^-(c|command|f|file|e|ec|encodedcommand)$/i.test(a));
    if (runs >= 0) return args[runs + 1] === "-" || args[runs + 1] === undefined;
    return operands.length === 0;
  }
  if (lower === "cmd") {
    if (args.includes("/?")) return false;
    if (args.some((a) => /^\/k$/i.test(a))) return true;
    return !args.some((a) => /^\/c$/i.test(a));
  }
  if (SCRIPTING.test(name)) {
    // -v is Python's verbose mode, and the version elsewhere.
    const python = /^(python|py|ipython)/i.test(name);
    if (flags.some((f) => /^(--version|--help|-V|-h)$/.test(f) || (f === "-v" && !python))) return false;
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
 * typed there would skip the delete check. A program whose input is redirected doesn't count: it reads that, not
 * what's typed, and nor does one reading a pipe from echo, printf or cat of a file.
 * shortcut: a word list can't catch every way to start one, such as `xargs -I{} sh -c '{}'`, `script -q /dev/null`
 * or `python3 -c 'import code; code.interact()'`; a hook on `write_stdin`, if Codex adds one, would close the gap.
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
    const [first = "", ...piped] = statement.split("|");
    const program = programOf(first);
    if (program && !program.redirected && readsCommands(program.name, program.args)) return true;
    // A later program reads the pipe, which carries what's typed into the first one unless that one only writes
    // text it was given: echo, printf, or cat of a file or a heredoc.
    const fixed =
      program &&
      (program.redirected ||
        /^(echo|printf)$/i.test(program.name) ||
        (program.name === "cat" && program.args.some((a) => !a.startsWith("-"))));
    if (!fixed)
      for (const segment of piped) {
        const reader = programOf(segment);
        if (reader && readsCommands(reader.name, reader.args)) return true;
      }
  }
  return false;
}
