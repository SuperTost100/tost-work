import { spawn } from "node:child_process";
import { realpathSync, renameSync, writeFileSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { UserError } from "./userError";

/**
 * Tost Work's check before every step Codex takes. Codex runs with no approvals of its own, so a command can't leave
 * the task's folder (see AgentEngine), and the overwrite and delete cards come from a PreToolUse hook instead: Codex
 * runs the hook's command before each step, the command asks Tost Work over 127.0.0.1, and Tost Work's policy answers.
 *
 * Codex runs a hook only once the user trusted it, by its hash in config.toml. Tost Work writes the hook at each start
 * and asks Codex itself, through `hooks/list`, for the hash and whether the hook is trusted, so a Codex that hashes
 * differently is asked too, and one that won't run the hook makes Codex tasks fail instead of running unchecked.
 *
 * The commands Codex runs don't get the hook's address and token in their environment, and Tost Work's server refuses
 * any request without a session's token. Whether a command can connect to 127.0.0.1 at all depends on the sandbox:
 * Codex's Linux sandbox blocks it (checked with Codex 0.166), and so does MXC on Windows, but Windows' `unelevated`
 * sandbox, used where MXC isn't available, only sets proxy variables and blocks no network. macOS wasn't checked.
 */

/** The run's address and token, which reach the hook through Codex's environment but not commands'. */
export const HOOK_URL_ENV = "TOST_WORK_HOOK_URL";
export const HOOK_TOKEN_ENV = "TOST_WORK_HOOK_TOKEN";
/** What config.toml keeps out of the environment of the commands Codex runs. */
export const HOOK_ENV_PATTERN = "TOST_WORK_HOOK_*";

/**
 * How long Codex waits for the hook, in seconds: a card can stay open for days. A hook that runs longer is stopped, and
 * Codex then takes the step, so the wait is a week rather than Codex's default of ten minutes.
 */
export const HOOK_TIMEOUT_S = 7 * 24 * 60 * 60;

const HELPER = "tost-work-hook.cjs";

/** The exit code with which the helper refuses a step, after writing why to stderr. */
const REFUSED = 10;

/**
 * The helper the hook runs through the app's own executable as Node. It sends the step to Tost Work and exits 0 to
 * allow it, or writes the reason to stderr and exits 10 to refuse it.
 */
export const HELPER_SOURCE = `"use strict";
// Written by Tost Work each time it starts. Codex runs it before each step of a Tost Work task (see hooks.json).
const fs = require("node:fs");
const http = require("node:http");
const refuse = (reason) => {
  fs.writeSync(2, reason + "\\n");
  process.exit(${REFUSED});
};
const failed = "Tost Work could not check this step.";
const url = process.env.${HOOK_URL_ENV};
const token = process.env.${HOOK_TOKEN_ENV};
if (!url || !token) refuse(failed);
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("error", () => refuse(failed));
process.stdin.on("end", () => {
  const body = Buffer.concat(chunks);
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json", "Content-Length": body.length };
  const request = http.request(url, { method: "POST", headers }, (response) => {
    const parts = [];
    response.on("data", (chunk) => parts.push(chunk));
    response.on("error", () => refuse(failed));
    response.on("end", () => {
      let answer = null;
      try {
        if (response.statusCode === 200) answer = JSON.parse(Buffer.concat(parts).toString("utf8"));
      } catch (err) {
        answer = null;
      }
      if (answer && answer.decision === "allow") process.exit(0);
      refuse(answer && typeof answer.reason === "string" && answer.reason ? answer.reason : failed);
    });
  });
  request.on("error", () => refuse(failed));
  request.end(body);
});
`;

/** A word for sh, bash and zsh in single quotes. */
const shQuote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
/** A word for PowerShell in single quotes, which end at ' and at the curly quotes ‘ ’ ‚ ‛ too: each is doubled. */
const psQuote = (text: string) => `'${text.replace(/['‘’‚‛]/g, "$&$&")}'`;

/**
 * The hook's command. Codex runs it with the user's shell, and lets a step run when its hook fails, so any ending other
 * than the helper's allow or refusal refuses the step too, such as a helper that can't start.
 *
 * On macOS and Linux the shell is `zsh -c` or `bash -c`: the line runs the helper and turns its refusal into Codex's
 * (exit 2 with the reason on stderr).
 *
 * On Windows it's `powershell -NoProfile -Command`, and the line does the same. `| Out-Null` makes PowerShell wait for
 * the app's executable, which Windows starts as a windowed program. Inside the Microsoft Store package (`store`) the
 * executable sits in a protected folder that a program outside the package may not be able to run, so PowerShell
 * sends the step itself there, which takes longer: measured on the Windows test desktop, about 1.5 s a step against
 * 1.1 s, of which about 1 s is PowerShell starting. If Codex finds no PowerShell it uses cmd, which can't read either
 * line: the hook fails, Codex takes the step, and the engine's check of each started step (AgentEngine) stops the task.
 */
export function hookCommand(platform: NodeJS.Platform, exe: string, helper: string, store = false): string {
  if (platform !== "win32")
    return `set +e; ELECTRON_RUN_AS_NODE=1 ${shQuote(exe)} ${shQuote(helper)}; s=$?; [ "$s" = 0 ] && exit 0; [ "$s" = ${REFUSED} ] || echo 'Tost Work could not check this step.' >&2; exit 2`;
  // No double quotes: Codex passes the line as one argument, and PowerShell's own parsing of quotes would change it.
  if (!store)
    return `$env:ELECTRON_RUN_AS_NODE='1';& ${psQuote(exe)} ${psQuote(helper)} | Out-Null;$s=$LASTEXITCODE;if($s -eq 0){exit 0};if($s -ne ${REFUSED}){[Console]::Error.WriteLine('Tost Work could not check this step.')};exit 2`;
  return [
    "$ErrorActionPreference='Stop'",
    "$a=$null",
    `try{$i=[Console]::OpenStandardInput();$m=New-Object IO.MemoryStream;$i.CopyTo($m);$b=$m.ToArray();$r=[Net.WebRequest]::Create($env:${HOOK_URL_ENV});$r.Method='POST';$r.Proxy=$null;$r.Timeout=-1;$r.ReadWriteTimeout=-1;$r.ContentType='application/json';$r.Headers.Add('Authorization','Bearer '+$env:${HOOK_TOKEN_ENV});$s=$r.GetRequestStream();$s.Write($b,0,$b.Length);$s.Close();$p=$r.GetResponse();$t=(New-Object IO.StreamReader($p.GetResponseStream(),[Text.Encoding]::UTF8)).ReadToEnd();$a=ConvertFrom-Json $t}catch{$a=$null}`,
    "if($a -and $a.decision -eq 'allow'){exit 0}",
    "$w='Tost Work could not check this step.'",
    "if($a -and $a.reason){$w=[string]$a.reason}",
    "$e=[Console]::OpenStandardError();$x=[Text.Encoding]::UTF8.GetBytes($w);$e.Write($x,0,$x.Length);$e.Flush()",
    "exit 2",
  ].join(";");
}

/** hooks.json: one PreToolUse hook for every tool, so the policy sees every step, as it saw every approval. */
export function hooksJson(command: string): string {
  const hook = { type: "command", command, timeout: HOOK_TIMEOUT_S };
  return `${JSON.stringify({ hooks: { PreToolUse: [{ hooks: [hook] }] } }, null, 2)}\n`;
}

/**
 * A TOML basic string. JSON's escapes are TOML's, for the characters a path or a hash can hold, except DEL, which
 * TOML wants escaped too. A lone UTF-16 surrogate has no TOML form: such a path is refused before it gets here.
 */
const tomlString = (text: string) => JSON.stringify(text).replaceAll("\u007f", "\\u007f");

/** config.toml's lines that trust one hook, by its key and Codex's hash of it. */
export function trustLines(key: string, hash: string): string {
  return `\n[hooks.state.${tomlString(key)}]\ntrusted_hash = ${tomlString(hash)}\n`;
}

/** config.toml's lines that keep Codex from trusting a folder, and so from loading its .codex settings. */
export function untrustedLines(folder: string): string {
  return `\n[projects.${tomlString(folder)}]\ntrust_level = "untrusted"\n`;
}

/**
 * The names Codex looks a task's folder up by in config.toml (`normalized_project_trust_keys` in Codex's config
 * loader): the folder with links resolved, as Rust's canonicalize gives it, then as Codex was given it. That covers
 * /var as /private/var on macOS; on Windows Codex compares the names without regard to letter case, and the resolved
 * one has no \\?\ in front, as Node's realpath gives it too.
 */
export function folderKeys(folder: string): string[] {
  const given = resolve(folder);
  let real = given;
  try {
    real = realpathSync.native(given);
  } catch (err) {
    // A folder that isn't there yet has no links to resolve: Codex then uses the name as given.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return real === given ? [given] : [real, given];
}

/** Renames a file over another; Windows refuses for a moment while another program, such as an antivirus, has it open. */
async function replace(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const busy = ["EPERM", "EACCES", "EBUSY"].includes((err as NodeJS.ErrnoException).code ?? "");
      if (process.platform !== "win32" || !busy || attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}

let written = 0;

/** Writes a file whole: into a new file beside it, then renamed over it, so no reader finds it half-written. */
export async function writeWhole(path: string, text: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${++written}.tmp`;
  try {
    await writeFile(temporary, text);
    await replace(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * config.toml in Tost Work's Codex home, which Tost Work owns: it's written whole from what Tost Work keeps here, so
 * what anything else wrote into it is replaced, as at each start. What it holds: Tost Work's settings (codexConfig),
 * the hook's trust, and an untrusted entry for each folder a Codex task has run in since the app started, which
 * Codex needs for as long as that task's Codex may read config.toml again. They're only dropped when the app starts,
 * so the file grows by a few lines for each folder used in one session.
 *
 * Each change and its write wait for the one before, all in the main process, so two tasks starting together never
 * write over each other's lines.
 */
export class CodexConfigFile {
  private trusted: { key: string; hash: string } | null = null;
  private folders = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly path: string,
    readonly base: string,
    private write: (path: string, text: string) => Promise<void> = writeWhole,
  ) {}

  text(): string {
    let text = this.base;
    if (this.trusted) text += trustLines(this.trusted.key, this.trusted.hash);
    for (const folder of this.folders) text += untrustedLines(folder);
    return text;
  }

  /** At start, before any Codex runs: Tost Work's settings alone. */
  writeNow(): void {
    const temporary = `${this.path}.${process.pid}.start.tmp`;
    writeFileSync(temporary, this.text());
    renameSync(temporary, this.path);
  }

  /** Keeps Codex from trusting these folders, in every task from now until the app quits. */
  untrust(folders: string[]): Promise<void> {
    return this.change(() => {
      for (const folder of folders) this.folders.add(folder);
    });
  }

  /** Trusts the hook with Codex's hash of it. */
  trust(key: string, hash: string): Promise<void> {
    return this.change(() => {
      this.trusted = { key, hash };
    });
  }

  private change(apply: () => void): Promise<void> {
    const step = this.queue.then(async () => {
      apply();
      const text = this.text();
      // An unchanged file isn't written again.
      if ((await readText(this.path)) !== text) await this.write(this.path, text);
    });
    // The caller of this change gets its error; the next change runs either way.
    this.queue = step.then(
      () => undefined,
      () => undefined,
    );
    return step;
  }
}

/** The hook as Tost Work wrote it this time, for the check. */
export interface CodexHook {
  home: string;
  /** hooks.json's path. */
  file: string;
  command: string;
  config: CodexConfigFile;
}

/**
 * Writes the hook into Codex's home: hooks.json and the helper, and config.toml with Tost Work's settings `config`.
 * All three are rewritten at each start, because the app's executable can move: an AppImage mounts itself somewhere
 * new each time.
 */
export function writeCodexHook(
  home: string,
  config: string,
  platform: NodeJS.Platform,
  exe: string,
  store = false,
): CodexHook {
  const file = new CodexConfigFile(join(home, "config.toml"), config);
  file.writeNow();
  const helper = join(home, HELPER);
  writeFileSync(helper, HELPER_SOURCE);
  const command = hookCommand(platform, exe, helper, store);
  const hooks = join(home, "hooks.json");
  writeFileSync(hooks, hooksJson(command));
  return { home, file: hooks, command, config: file };
}

/** One hook as `hooks/list` reports it. */
export interface ListedHook {
  key: string;
  eventName: string;
  handlerType: string;
  command?: string;
  matcher: string | null;
  timeoutSec: number;
  sourcePath: string;
  enabled: boolean;
  currentHash: string;
  trustStatus: string;
}

/** What `hooks/list` answered for one folder. */
export interface HookListing {
  hooks: ListedHook[];
  errors: unknown[];
}

/** The same file, whatever links or letter case the two paths use. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const real = (p: string) => {
    try {
      return realpathSync.native(p);
    } catch {
      return resolve(p);
    }
  };
  const [x, y] = [real(a), real(b)];
  return platform === "win32" || platform === "darwin" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * Tost Work's hook among the ones Codex lists, and whether Codex runs it as written. Codex must list exactly one
 * PreToolUse hook from the file, for every tool, with the command and timeout written, and turned on.
 */
export function findHook(
  listing: HookListing,
  hook: CodexHook,
  platform: NodeJS.Platform,
): { hook: ListedHook } | { problem: string } {
  const ours = listing.hooks.filter((h) => samePath(h.sourcePath, hook.file, platform));
  const pre = ours.filter((h) => h.eventName === "preToolUse");
  if (pre.length !== 1 || ours.length !== 1)
    return { problem: `Codex lists ${pre.length} PreToolUse hooks and ${ours.length} hooks in hooks.json` };
  const [found] = pre as [ListedHook];
  if (found.handlerType !== "command" || found.command !== hook.command)
    return { problem: "Codex lists a different command" };
  if (found.matcher !== null) return { problem: "Codex lists the hook for some tools only" };
  if (found.timeoutSec !== HOOK_TIMEOUT_S) return { problem: `Codex waits ${found.timeoutSec} s for the hook` };
  if (!found.enabled) return { problem: "Codex lists the hook as turned off" };
  return { hook: found };
}

/** One of the settings files Codex reads for a folder, as `config/read` reports it. */
export interface ConfigLayer {
  name: { type: string; dotCodexFolder?: string };
  disabledReason?: string;
}

/** What `config/read` answered for one folder: the settings files, and the folders' trust Codex read. */
export interface ConfigReading {
  layers: ConfigLayer[];
  projects: Record<string, { trust_level?: string }>;
}

/** What the check needs from Codex: its hooks (`hooks/list`) and settings files (`config/read`) as seen from a folder. */
export interface HookLister {
  list(cwd: string): Promise<HookListing>;
  read(cwd: string): Promise<ConfigReading>;
  close(): void;
}

/**
 * Why Codex would use a folder's own settings for a task there, or null. A .codex folder in the task's folder (or a
 * repository it's in) holds settings Codex loads once it trusts the folder, and they can turn hooks off or let
 * commands write outside it. Codex trusts such a folder itself when a task starts, unless config.toml already says,
 * so the folder must be listed as untrusted, and no settings file of a folder may be in use.
 */
export function folderSettingsProblem(reading: ConfigReading, keys: string[]): string | null {
  const used = reading.layers.find((l) => l.name.type === "project" && !l.disabledReason);
  if (used) return `Codex loads the settings in ${used.name.dotCodexFolder ?? "the task's folder"}`;
  if (!keys.some((k) => reading.projects[k]?.trust_level === "untrusted"))
    return "Codex doesn't list the task's folder as untrusted";
  return null;
}

/**
 * Makes sure Codex will run the hook before each step of a task in `cwd`: trusted, as written, and with none of the
 * folder's own settings in use (folderSettingsProblem). The folder is listed as untrusted first, then a hook Codex
 * hasn't trusted yet is trusted with the hash Codex gives for it, and both are checked through Codex itself. Throws a
 * UserError when Codex won't run the hook, so the task fails instead of running unchecked.
 */
export async function checkCodexHook(
  hook: CodexHook,
  cwd: string,
  open: () => Promise<HookLister>,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  let lister: HookLister | null = null;
  try {
    const keys = folderKeys(cwd);
    if (keys.some((k) => /\p{Cs}/u.test(k))) throw new Error("the folder's name can't be written in config.toml");
    await hook.config.untrust(keys);
    lister = await open();
    let found = findHook(await lister.list(cwd), hook, platform);
    if ("hook" in found && found.hook.trustStatus !== "trusted") {
      await hook.config.trust(found.hook.key, found.hook.currentHash);
      found = findHook(await lister.list(cwd), hook, platform);
    }
    if ("problem" in found) throw new Error(found.problem);
    if (found.hook.trustStatus !== "trusted") throw new Error(`Codex says the hook is ${found.hook.trustStatus}`);
    const problem = folderSettingsProblem(await lister.read(cwd), keys);
    if (problem) throw new Error(problem);
  } catch (err) {
    throw new UserError("error.codexHookOff", { detail: err instanceof Error ? err.message : String(err) });
  } finally {
    lister?.close();
  }
}

/**
 * The check before each Codex task, for the engine (its `codexHook` option), run against the Codex cli-funnel finds,
 * the one that runs the task. Without a hook written, or without Codex, Codex tasks don't start.
 */
export function codexHookCheck(
  hook: CodexHook | null,
  detect: () => Promise<{ path?: string }>,
): (workdir: string) => Promise<void> {
  return async (workdir) => {
    if (!hook) throw new UserError("error.codexHookOff", { detail: "Tost Work didn't write its hook" });
    const { path } = await detect();
    if (!path) throw new UserError("error.codexHookOff", { detail: "Codex isn't installed" });
    await checkCodexHook(hook, workdir, () => appServerLister(path));
  };
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** How long Codex has to start and list its hooks before the check gives up. */
const LIST_TIMEOUT_MS = 30_000;

/**
 * A `codex app-server` of its own, for `hooks/list`: the binary cli-funnel found, with its folder first on the PATH,
 * where an npm install keeps the Node it needs. It needs no sign-in.
 */
export function appServerLister(codex: string, env: NodeJS.ProcessEnv = process.env): Promise<HookLister> {
  const windowsScript = process.platform === "win32" && /\.(cmd|bat)$/i.test(codex);
  const child = windowsScript
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${codex}" app-server"`], {
        windowsVerbatimArguments: true,
        windowsHide: true,
        env: { ...env, PATH: [dirname(codex), env.PATH].join(delimiter) },
      })
    : spawn(codex, ["app-server"], {
        windowsHide: true,
        env: { ...env, PATH: [dirname(codex), env.PATH].join(delimiter) },
      });
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let ended: Error | null = null;
  const end = (err: Error) => {
    ended ??= err;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  child.on("error", (err) => end(err));
  child.on("exit", (code) => end(new Error(`codex app-server exited (${code})`)));
  child.stderr.resume();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: { id?: number; method?: string; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(line);
    } catch {
      // Not a JSON-RPC line, such as a warning: only answers to the check's requests matter.
      return;
    }
    if (message.method || typeof message.id !== "number") return;
    const p = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) p?.reject(new Error(message.error.message ?? "codex app-server refused"));
    else p?.resolve(message.result);
  });
  const request = (method: string, params: unknown) =>
    new Promise<unknown>((resolveRequest, reject) => {
      if (ended) return reject(ended);
      const id = next++;
      const timer = setTimeout(() => reject(new Error(`codex app-server didn't answer ${method}`)), LIST_TIMEOUT_MS);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolveRequest(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  const close = () => {
    child.stdin.end();
    child.kill();
  };
  return request("initialize", {
    clientInfo: { name: "tost-work", title: null, version: "0" },
    capabilities: { experimentalApi: false },
  }).then(
    () => {
      child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
      return {
        async list(cwd: string): Promise<HookListing> {
          const answer = (await request("hooks/list", { cwds: [cwd] })) as {
            data?: { hooks?: ListedHook[]; errors?: unknown[] }[];
          };
          const data = answer?.data ?? [];
          return { hooks: data.flatMap((d) => d.hooks ?? []), errors: data.flatMap((d) => d.errors ?? []) };
        },
        async read(cwd: string): Promise<ConfigReading> {
          const answer = (await request("config/read", { cwd, includeLayers: true })) as {
            layers?: ConfigLayer[] | null;
            config?: { projects?: ConfigReading["projects"] | null };
          };
          return { layers: answer?.layers ?? [], projects: answer?.config?.projects ?? {} };
        },
        close,
      };
    },
    (err: Error) => {
      close();
      throw err;
    },
  );
}
