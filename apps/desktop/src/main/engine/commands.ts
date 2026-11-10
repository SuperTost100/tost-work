import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { type posix, win32 } from "node:path";
import { pathsFor } from "./codexGate";

/** Node's path functions for one system. */
type PlatformPath = typeof posix;

/**
 * Reading shell commands as bash, cmd and PowerShell would split them: the words of each command, the scripts nested
 * in them, and the files a command writes. The delete check in agent.ts reads commands with the same parser.
 */

/**
 * Words that run a program named later in the command, such as sudo, xargs and find's -exec, and the shell's keywords
 * before a command. Every word after one of them is read as a program's name too.
 */
export const RUNS_NEXT = new Set([
  ...["sudo", "doas", "env", "command", "builtin", "exec", "nohup", "nice", "ionice", "time", "timeout", "stdbuf"],
  ...["xargs", "busybox", "toybox", "-exec", "-execdir", "-ok", "-okdir", ".", "call", "start"],
  ...["if", "then", "else", "elif", "do", "while", "until", "!"],
]);
export const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "fish", "csh", "tcsh"]);
/** Programs whose payload runs as commands, which the check reads as a script of its own. */
export const UNWRAPS = new Set([...SHELLS, "cmd", "powershell", "pwsh", "eval", "iex", "invoke-expression"]);

/** Nested shells and payloads deeper than this aren't read: the delete check takes the command as deleting. */
export const MAX_DEPTH = 10;
/** A shell where a command starts, by name or path: bash and /bin/sh, but not a file named cleanup.sh. */
const SHELL = String.raw`(^|[\s;&|(])(\S*\/)?((ba|z|da|k)?sh|fish)`;
/** A line that hands a heredoc to a shell, whose body is then commands. */
const SHELL_READS = new RegExp(String.raw`${SHELL}(\s|<|$)`);
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g;
export const SUBSTITUTION = /\$\(([^()]*)\)|`([^`]*)`/g;

/** The text before `offset` on its line. */
const lineBefore = (text: string, offset: number) => text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);

/** Whether `option` is `full` or a prefix of it at least `min` characters long, as PowerShell reads its options. */
export const prefixOf = (full: string, option: string, min = 2) => option.length >= min && full.startsWith(option);

/**
 * A script with its heredocs' bodies taken out, and the bodies, whose code is still checked. A body a shell reads
 * stays in as commands. Any other body is text, except for the $(…) and `…` in one whose delimiter isn't quoted,
 * which the shell runs.
 */
export function heredocs(script: string): { text: string; bodies: string[] } {
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
export interface Word {
  text: string;
  /** Whether any of it stood outside quotes. */
  bare: boolean;
  /** Where its quoted pieces sit in the script, so the code check can leave out quoted text. */
  quotes: [number, number][];
  /** Whether it follows <<<, so it's the program's input: a script, when the program is a shell. */
  fed: boolean;
  /** Whether it follows a redirection: "out" after > or >>, the file the command writes; "in" after < or <<. */
  redirect?: "in" | "out";
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
export function parse(script: string): { commands: Word[][]; substitutions: string[] } {
  const commands: Word[][] = [];
  const substitutions: string[] = [];
  let words: Word[] = [];
  let word: Word | null = null;
  let feed = false;
  let redirect: Word["redirect"];
  const piece = (): Word => {
    word ??= { text: "", bare: false, quotes: [], fed: feed, ...(redirect ? { redirect } : {}) };
    feed = false;
    redirect = undefined;
    return word;
  };
  // The word being read, typed as either, because the loop below would narrow `word` to null.
  const current = (): Word | null => word;
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
    redirect = undefined;
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
      // A redirection, such as > out.txt, 2>&1 or &> log.txt: its target is a word of the command. A stream's number
      // or PowerShell's * just before it, as in 2> or *>, belongs to the redirection.
      const pending = current();
      if (pending && !pending.quotes.length && /^(\d+|\*)$/.test(pending.text)) word = null;
      else endWord();
      const start = i;
      while (i < script.length && /[<>&|]/.test(script[i] as string)) i++;
      const operator = script.slice(start, i);
      feed = operator === "<<<";
      // >&2 and 2>&1 copy a stream rather than name a file.
      redirect = operator.endsWith("&") ? undefined : operator.includes(">") ? "out" : "in";
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
export function namesOf(word: string, program: boolean): string[] {
  const lower = word.toLowerCase();
  const base = (lower.split(/[\\/]/).pop() ?? "").replace(/\.exe$/, "");
  return program ? [lower, base, lower.split("/")[0] ?? ""] : [lower, base];
}

/**
 * The script a nested shell runs, given the words after its name: the payload of bash -c, cmd /c, powershell -Command
 * or -EncodedCommand, eval and Invoke-Expression. Null for a program that isn't one, or a shell given no script.
 */
export function payloadOf(name: string, rest: string[]): string | null {
  if (SHELLS.has(name)) {
    const flag = rest.findIndex((t) => /^-[a-z]*c[a-z]*$/i.test(t));
    return flag >= 0 ? (rest[flag + 1] ?? "") : null;
  }
  if (name === "cmd") {
    // cmd's switches, such as /d /s /q, may come before /c or /k, and ^ is its escape.
    const at = rest.findIndex((t) => /^\/[ck]/i.test(t));
    if (at < 0) return null;
    return [rest[at]?.slice(2) ?? "", ...rest.slice(at + 1)].join(" ").replace(/\^([\s\S])/g, "$1");
  }
  if (name === "powershell" || name === "pwsh") {
    for (const [at, option] of rest.map((t) => t.toLowerCase()).entries()) {
      // PowerShell reads -EncodedCommand (any prefix from -e, or -ec) as base64 of UTF-16LE text.
      if (prefixOf("-encodedcommand", option) || option === "-ec")
        return Buffer.from(rest[at + 1] ?? "", "base64").toString("utf16le");
      if (prefixOf("-command", option)) return rest.slice(at + 1).join(" ");
      if (prefixOf("-file", option)) return null;
    }
    // With neither, Windows PowerShell runs the words after its options as a command.
    return rest.filter((t) => !t.startsWith("-")).join(" ");
  }
  if (name === "eval" || name === "iex" || name === "invoke-expression") return rest.join(" ");
  return null;
}

// The files a command writes.

/** A file a command may write, resolved against the folder it runs in, before anything on disk is looked at. */
export interface WriteTarget {
  path: string;
  /** Whether the word had *, ? or [ outside quotes, which the shell expands into the files they match. */
  glob: boolean;
  /** Whether the word names a folder: it ends in a slash, or a copy has several sources. */
  folder: boolean;
  /** For a copy or a move, the source: a file copied into a folder keeps its name there. */
  from?: WriteTarget;
}

/** A word a program writes to, as one of the programs below names it. */
interface Spec {
  word: Word;
  /** A copy's or a move's source. */
  from?: Word;
  /** Whether the target is certainly a folder. */
  folder?: boolean;
  /** For a rename, the file renamed: the new name sits in its folder. */
  beside?: Word;
}

/** A word made from part of another, such as the path in dd's of=path or curl's -ofile. */
const wordOf = (text: string): Word => ({ text, bare: true, quotes: [], fed: false });

/**
 * A POSIX program's operands: the words that aren't options, after the value each option matching `takes` has as its
 * next word. Everything after -- is an operand.
 */
function operands(args: Word[], takes: RegExp): Word[] {
  const found: Word[] = [];
  let ended = false;
  for (let n = 0; n < args.length; n++) {
    const word = args[n] as Word;
    const text = word.text;
    if (ended || !text.startsWith("-") || text === "-") found.push(word);
    else if (text === "--") ended = true;
    else if (takes.test(text)) n++;
  }
  return found;
}

/**
 * The values of an option in its forms -o value, -xo value (short options run together), -ovalue, --long value and
 * --long=value.
 */
function optionValues(args: Word[], letter: string, long: string): Word[] {
  const found: Word[] = [];
  const grouped = new RegExp(`^-[a-zA-Z]*${letter}$`);
  for (const [n, word] of args.entries()) {
    const text = word.text;
    const next = args[n + 1];
    if (text === `--${long}` || (!text.startsWith("--") && grouped.test(text))) {
      if (next) found.push(next);
    } else if (text.startsWith(`--${long}=`)) found.push(wordOf(text.slice(long.length + 3)));
    else if (text.startsWith(`-${letter}`) && text.length > 2 && !text.startsWith("--"))
      found.push(wordOf(text.slice(2)));
  }
  return found;
}

/** A copy or a move with POSIX operands: the last is where the files go, a folder when there are several sources. */
function copies(args: Word[], takes: RegExp): Spec[] {
  const [dir] = optionValues(args, "t", "target-directory");
  const ops = operands(args, takes);
  if (dir) return ops.map((from) => ({ word: dir, from, folder: true }));
  const dest = ops.at(-1);
  const sources = ops.slice(0, -1);
  return dest ? sources.map((from) => ({ word: dest, from, folder: sources.length > 1 })) : [];
}

/** PowerShell's switches, which take no value. Any other parameter is read as taking the word after it. */
const PS_SWITCHES = [
  ...["force", "recurse", "passthru", "append", "nonewline", "noclobber", "whatif", "confirm", "container"],
  ...["notypeinformation", "includetypeinformation", "asbytestream", "useculture", "noheader", "verbose", "debug"],
];
/** The parameters that name the file a cmdlet works on. */
const PS_PATH = ["path", "literalpath", "pspath", "lp"];
/** Parameters that take a value and share a first letter with a switch, so a one-letter -p or -f stays a parameter. */
const PS_VALUED = [...PS_PATH, "destination", "value", "filepath", "filter", "newname", "encoding", "include"];

/** A cmdlet's arguments: its named parameters in lowercase, PowerShell's -Name:value form included, and the rest. */
function psParams(args: Word[]): { named: [string, Word][]; positional: Word[] } {
  const named: [string, Word][] = [];
  const positional: Word[] = [];
  for (let n = 0; n < args.length; n++) {
    const word = args[n] as Word;
    const param = word.bare ? /^-([A-Za-z][\w-]*)(?::([\s\S]*))?$/.exec(word.text) : null;
    const name = param?.[1]?.toLowerCase();
    if (!param || !name) positional.push(word);
    else if (param[2] !== undefined) named.push([name, wordOf(param[2])]);
    else if (PS_SWITCHES.some((s) => s.startsWith(name)) && !PS_VALUED.some((v) => v.startsWith(name))) continue;
    else {
      const value = args[n + 1];
      if (value) named.push([name, value]);
      n++;
    }
  }
  return { named, positional };
}

/** A named parameter's value, by any of its names or, as PowerShell allows, by the start of one. */
const param = (p: ReturnType<typeof psParams>, names: string[]) =>
  p.named.find(([key]) => names.some((full) => full.startsWith(key)))?.[1];

/** Whether a cp, mv, copy or move is PowerShell's alias, used with PowerShell's parameters. */
const psStyle = (args: Word[]) =>
  args.some((a) =>
    /^-(destination|path|literalpath|lp|pspath|force|recurse|container|passthru|filter|include|exclude|whatif|confirm)(:|$)/i.test(
      a.text,
    ),
  );

/** Set-Content, Add-Content, Clear-Content, Export-Csv: the file is -Path or the first positional. */
const psContent = (args: Word[]): Spec[] => {
  const p = psParams(args);
  const word = param(p, PS_PATH) ?? p.positional[0];
  return word ? [{ word }] : [];
};
/** Out-File and Tee-Object, whose file is -FilePath. */
const psOutFile = (args: Word[]): Spec[] => {
  const p = psParams(args);
  const word = param(p, ["filepath", ...PS_PATH]) ?? p.positional[0];
  return word ? [{ word }] : [];
};
/** Copy-Item and Move-Item: from -Path to -Destination, or into the current folder when there's none. */
const psCopy = (args: Word[]): Spec[] => {
  const p = psParams(args);
  const from = param(p, PS_PATH) ?? p.positional[0];
  const dest = param(p, ["destination"]) ?? p.positional[1];
  if (!from) return [];
  return dest ? [{ word: dest, from }] : [{ word: wordOf("."), from, folder: true }];
};
/** Rename-Item: -NewName in the renamed file's folder. */
const psRename = (args: Word[]): Spec[] => {
  const p = psParams(args);
  const beside = param(p, PS_PATH) ?? p.positional[0];
  const word = param(p, ["newname"]) ?? p.positional[1];
  return beside && word ? [{ word, beside }] : [];
};

/** cmd's switches, such as /y, /-y and /e. */
const CMD_SWITCH = /^\/-?[a-z?]{1,2}(:\S*)?$/i;
/** cmd's copy, move and xcopy: the last operand is where the files go, or the current folder when there's one. */
const cmdCopy = (args: Word[]): Spec[] => {
  const ops = args.filter((a) => !CMD_SWITCH.test(a.text));
  const [only] = ops;
  if (ops.length === 1 && only) return [{ word: wordOf("."), from: only, folder: true }];
  const dest = ops.at(-1);
  return dest ? ops.slice(0, -1).map((from) => ({ word: dest, from })) : [];
};
/** cmd's ren: the new name sits in the renamed file's folder. */
const cmdRename = (args: Word[]): Spec[] => {
  const [beside, word] = args.filter((a) => !CMD_SWITCH.test(a.text));
  return beside && word ? [{ word, beside }] : [];
};

/** OfficeCLI's commands that change the document they're given. view, get, query, raw, validate and dump only read. */
const OFFICE_WRITES = new Set([
  ...["set", "add", "remove", "move", "swap", "refresh", "raw-set", "add-part", "batch", "import", "merge"],
  "create",
]);

/** The options of cp, mv and ln whose value is the next word. */
const COPY_TAKES = /^(-[tS]|--target-directory|--suffix)$/;

/** Whether a short option such as -i, -pi or -i.bak turns on editing in place, for sed and perl. */
const IN_PLACE = /^-(?![MmIx])[\w.]*i/;

/** Programs and cmdlets by name, in lowercase, with the files their arguments say they write. */
const WRITERS: Record<string, (args: Word[]) => Spec[]> = {
  cp: (args) => (psStyle(args) ? psCopy(args) : copies(args, COPY_TAKES)),
  mv: (args) => (psStyle(args) ? psCopy(args) : copies(args, COPY_TAKES)),
  install: (args) =>
    args.some((a) => /^(-[a-zA-Z]*d[a-zA-Z]*|--directory)$/.test(a.text))
      ? []
      : copies(args, /^(-[mogtS]|--mode|--owner|--group|--target-directory|--suffix|--strip-program)$/),
  // ln replaces a file only with -f.
  ln: (args) => (args.some((a) => /^(-[a-zA-Z]*f[a-zA-Z]*|--force)$/.test(a.text)) ? copies(args, COPY_TAKES) : []),
  rsync: (args) => {
    const ops = operands(
      args,
      /^(-[eTfB]|--rsh|--exclude|--include|--filter|--files-from|--exclude-from|--include-from|--temp-dir|--log-file|--backup-dir|--suffix|--chmod|--chown)$/,
    );
    const dest = ops.at(-1);
    // host:path is on another computer; C:\ is a Windows drive.
    if (!dest || (/^[^/\\]*:/.test(dest.text) && !/^[A-Za-z]:[\\/]/.test(dest.text))) return [];
    return ops.slice(0, -1).map((from) => ({ word: dest, from }));
  },
  sed: (args) => {
    const at = args.findIndex(
      (a) => (IN_PLACE.test(a.text) && !a.text.startsWith("--")) || /^--in-place(=|$)/.test(a.text),
    );
    if (at < 0) return [];
    // macOS's sed -i takes the backup suffix as the next word, empty for none.
    const rest = args.filter((a, n) => !(n === at + 1 && a.text === "" && args[at]?.text === "-i"));
    const script = /^(-[nErsuz]*[ef]|--expression|--file)(=|$)/;
    const ops = operands(rest, /^(-[nErsuz]*[ef]|-l|--expression|--file|--line-length)$/);
    return (rest.some((a) => script.test(a.text)) ? ops : ops.slice(1)).map((word) => ({ word }));
  },
  perl: (args) => {
    if (!args.some((a) => IN_PLACE.test(a.text) && !a.text.startsWith("--"))) return [];
    const code = /^-(?![MmIx])\w*[eE]$/;
    const ops = operands(args, code);
    return (args.some((a) => code.test(a.text)) ? ops : ops.slice(1)).map((word) => ({ word }));
  },
  truncate: (args) => operands(args, /^(-[sr]|--size|--reference)$/).map((word) => ({ word })),
  dd: (args) => args.flatMap((a) => (a.text.startsWith("of=") ? [{ word: wordOf(a.text.slice(3)) }] : [])),
  sort: (args) => optionValues(args, "o", "output").map((word) => ({ word })),
  curl: (args) => optionValues(args, "o", "output").map((word) => ({ word })),
  wget: (args) => optionValues(args, "O", "output-document").map((word) => ({ word })),
  tee: (args) =>
    args.some((a) => /^-(filepath|literalpath|append|encoding|variable)(:|$)/i.test(a.text))
      ? psOutFile(args)
      : operands(args, /^$/).map((word) => ({ word })),
  officecli: (args) => {
    const ops = args.filter((a) => !a.text.startsWith("-"));
    const verb = ops[0]?.text.toLowerCase() ?? "";
    // create refuses a file that's already there, unless --force.
    if (!OFFICE_WRITES.has(verb) || (verb === "create" && !args.some((a) => a.text === "--force"))) return [];
    // merge <template> <output> writes the second.
    const file = verb === "merge" ? ops[2] : ops[1];
    return file ? [{ word: file }] : [];
  },
  "set-content": psContent,
  sc: psContent,
  "add-content": psContent,
  ac: psContent,
  "clear-content": psContent,
  clc: psContent,
  "export-csv": psContent,
  epcsv: psContent,
  "out-file": psOutFile,
  "tee-object": psOutFile,
  "copy-item": psCopy,
  cpi: psCopy,
  "move-item": psCopy,
  mi: psCopy,
  "rename-item": psRename,
  rni: psRename,
  copy: (args) => (psStyle(args) ? psCopy(args) : cmdCopy(args)),
  move: (args) => (psStyle(args) ? psCopy(args) : cmdCopy(args)),
  xcopy: cmdCopy,
  ren: (args) => (psStyle(args) ? psRename(args) : cmdRename(args)),
  rename: (args) => (psStyle(args) ? psRename(args) : cmdRename(args)),
};

/** Commands that change the folder the commands after them run in. */
const CHANGES_FOLDER = new Set(["cd", "chdir", "pushd", "set-location", "sl", "push-location"]);

/** .NET's file writes with a literal path, which PowerShell can call: [IO.File]::WriteAllText('x', …) and the like. */
const DOTNET_WRITES =
  /\[(?:System\.)?IO\.File\]::(?:WriteAll\w*|AppendAll\w*|AppendText|CreateText|Create|OpenWrite)\(\s*(['"])(.*?)\1/gi;
/** .NET's Copy, Move and Replace, whose second literal path is the file written. */
const DOTNET_COPIES = /\[(?:System\.)?IO\.File\]::(?:Copy|Move|Replace)\(\s*(['"])(?:.*?)\1\s*,\s*(['"])(.*?)\2/gi;

/** Collects the files the commands of one script write, as the script runs from folder to folder. */
class Writes {
  targets: WriteTarget[] = [];

  constructor(
    private paths: PlatformPath,
    private home: string,
  ) {}

  /**
   * A word's path from `cwd`, or null when it can't be known (a variable or a command's output in it, or a relative
   * path from an unknown folder) or names no file: standard output, /dev/null, NUL.
   */
  private resolve(word: string, cwd: string | null): string | null {
    // $PWD, in bash and PowerShell, is the folder the command runs in.
    const pwd = /^\$PWD(?=$|[\\/])/;
    const text = cwd !== null && pwd.test(word) ? word.replace(pwd, cwd) : word;
    if (!text || text === "-" || /[$`]/.test(text) || /^(nul|con)(:|$)|^\/dev\//i.test(text)) return null;
    const path = /^~($|[\\/])/.test(text) ? this.home + text.slice(1) : text;
    if (this.paths.isAbsolute(path)) return this.paths.resolve(path);
    return cwd === null ? null : this.paths.resolve(cwd, path);
  }

  private target(word: Word, cwd: string | null, folder = false): WriteTarget | null {
    const path = this.resolve(word.text, cwd);
    if (!path) return null;
    const glob = !word.quotes.length && /[*?[]/.test(word.text);
    return { path, glob, folder: folder || /[\\/]$/.test(word.text) };
  }

  add(spec: Spec, cwd: string | null): void {
    let target: WriteTarget | null;
    if (spec.beside) {
      const renamed = this.resolve(spec.beside.text, cwd);
      target = renamed ? this.target(spec.word, this.paths.dirname(renamed)) : null;
    } else target = this.target(spec.word, cwd, spec.folder);
    if (!target) return;
    const from = spec.from && this.target(spec.from, cwd);
    // A file copied into a folder takes its source's name, which has to be known.
    if (spec.from && !from && target.folder) return;
    this.targets.push(from ? { ...target, from } : target);
  }

  /** Reads a script from `cwd`, `depth` nested shells deep, and returns the folder it ends in. */
  script(script: string, depth: number, cwd: string | null): string | null {
    if (depth > MAX_DEPTH) return cwd;
    const { text } = heredocs(script);
    for (const m of text.matchAll(DOTNET_WRITES)) this.add({ word: wordOf(m[2] ?? "") }, cwd);
    for (const m of text.matchAll(DOTNET_COPIES)) this.add({ word: wordOf(m[3] ?? "") }, cwd);
    const { commands, substitutions } = parse(text);
    for (const inner of substitutions) this.script(inner, depth + 1, cwd);
    let folder = cwd;
    for (const words of commands) folder = this.command(words, depth, folder);
    return folder;
  }

  /**
   * One command's writes: its redirections, and what each program in it writes, the first one and any run by sudo,
   * xargs, find's -exec and the like. A nested shell's script is read from the same folder. Returns the folder the
   * next command runs in.
   */
  private command(all: Word[], depth: number, cwd: string | null): string | null {
    for (const word of all) if (word.redirect === "out") this.add({ word }, cwd);
    const words = all.filter((w) => !w.redirect);
    const first = words.findIndex((w) => !(w.bare && /^[A-Za-z_]\w*=/.test(w.text)));
    if (first < 0) return cwd;
    const programs = new Set([first]);
    for (const [n, word] of words.entries()) {
      if (!word.bare || !namesOf(word.text, true).some((name) => RUNS_NEXT.has(name))) continue;
      // The program it runs: the next word that isn't an option, a variable set for it or timeout's duration.
      const next = words.findIndex(
        (w, k) =>
          k > n && !w.text.startsWith("-") && !/^[A-Za-z_]\w*=/.test(w.text) && !/^\d+(\.\d+)?[smhd]?$/.test(w.text),
      );
      if (next >= 0) programs.add(next);
    }
    const [, program = ""] = namesOf(words[first]?.text ?? "", true);
    if (CHANGES_FOLDER.has(program)) {
      // cd /d D:\x in cmd, Set-Location -Path x in PowerShell.
      const dest = words.slice(first + 1).find((w) => !/^(\/d|-[a-z]+)$/i.test(w.text));
      return dest ? this.resolve(dest.text, cwd) : null;
    }
    let unwrapped = false;
    for (const n of [...programs].sort((a, b) => a - b)) {
      const names = namesOf(words[n]?.text ?? "", true);
      const args = words.slice(n + 1);
      if (!unwrapped && names.some((name) => UNWRAPS.has(name))) {
        unwrapped = true;
        const texts = args.map((w) => w.text);
        for (const name of names) {
          const payload = payloadOf(name, texts);
          if (payload !== null) {
            this.script(payload, depth + 1, cwd);
            break;
          }
        }
        if (names.some((name) => SHELLS.has(name)))
          for (const word of all) if (word.fed) this.script(word.text, depth + 1, cwd);
      }
      const writer = names.find((name) => Object.hasOwn(WRITERS, name));
      if (writer) for (const spec of WRITERS[writer]?.(args) ?? []) this.add(spec, cwd);
    }
    return cwd;
  }
}

/**
 * The files a command may write, from its words: redirections (>, >>, 2>, &>, >|, tee), programs whose arguments name
 * what they write (cp, mv, sed -i, curl -o, Set-Content, Copy-Item, copy, OfficeCLI's add and set, and the rest of
 * WRITERS), and .NET's [IO.File] writes with a literal path, in bash, cmd and PowerShell, inside nested shells too.
 * Relative paths resolve against `cwd`, following the command's own cd.
 * A path that can't be known from the words, such as one in a variable, is left out.
 * shortcut: what a script or an interpreter writes (python -c "open('x','w')", node, a .sh the AI wrote) and programs
 * not in WRITERS go unseen; snapshotting the folder before each run would close the gap.
 */
export function commandWrites(command: string, cwd: string, home = homedir()): { targets: WriteTarget[] } {
  const writes = new Writes(pathsFor(cwd), home);
  writes.script(command, 0, cwd);
  return { targets: writes.targets };
}

/** A glob's last part as a pattern for names in one folder: *, ? and [ ] as the shell reads them. */
function globPattern(glob: string, ignoreCase: boolean): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    const close = c === "[" ? glob.indexOf("]", i + 2) : -1;
    if (c === "*") source += "[^/\\\\]*";
    else if (c === "?") source += "[^/\\\\]";
    else if (close > 0) {
      const set = glob.slice(i + 1, close);
      source += `[${set.replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
      i = close;
    } else source += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, ignoreCase ? "i" : "");
}

/** Whether a path is a folder. A path that isn't there, or leads nowhere, isn't one. */
async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (err) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes((err as NodeJS.ErrnoException).code ?? "")) return false;
    throw err;
  }
}

/**
 * The paths a target stands for: itself, or the files a glob in its last part matches, leaving out hidden files
 * unless the glob starts with a dot, as the shell does.
 * shortcut: a glob in a folder's name (*\/notes.txt) matches nothing here; expand folder by folder if AIs write those.
 */
async function expand(target: WriteTarget, paths: PlatformPath): Promise<string[]> {
  if (!target.glob) return [target.path];
  const folder = paths.dirname(target.path);
  const name = paths.basename(target.path);
  if (/[*?[]/.test(folder) || !(await isFolder(folder))) return [];
  const pattern = globPattern(name, paths === win32);
  const names = await readdir(folder);
  return names
    .filter((n) => pattern.test(n) && (name.startsWith(".") || !n.startsWith(".")))
    .map((n) => paths.join(folder, n));
}

/**
 * The paths a command's targets write on disk: each glob expanded against its folder, and a copy into a folder turned
 * into the file there with the source's name. Paths may not exist yet; the caller decides what they replace.
 */
export async function writtenPaths(targets: WriteTarget[], cwd: string): Promise<string[]> {
  const paths = pathsFor(cwd);
  const found = new Set<string>();
  for (const target of targets)
    for (const path of await expand(target, paths)) {
      if (!target.folder && !(await isFolder(path))) {
        found.add(path);
        continue;
      }
      if (!target.from) continue;
      for (const source of await expand(target.from, paths)) found.add(paths.join(path, paths.basename(source)));
    }
  return [...found];
}
