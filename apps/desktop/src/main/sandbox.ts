import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { AgentProvider } from "../shared/model";
import { type Distro, SANDBOX_NEEDS, type SandboxMissing, type SandboxReadiness } from "../shared/sandbox";

/**
 * A bubblewrap run with the namespaces both CLIs ask for: a new user, PID and network namespace over a read-only view
 * of the system. It's Codex's own check (`--unshare-user --unshare-net --ro-bind / / true`) plus the PID namespace
 * Claude Code adds. It leaves out the fresh /proc Claude Code also mounts, because a Docker container refuses that
 * whatever the user installs, and the notice can't fix it.
 */
export const BWRAP_PROBE = [
  "--unshare-user",
  "--unshare-pid",
  "--unshare-net",
  "--die-with-parent",
  "--ro-bind",
  "/",
  "/",
  "true",
];

/** How long the bubblewrap run may take. It takes a few milliseconds when it works. */
const PROBE_TIMEOUT_MS = 5000;

const APPARMOR_USERNS = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";

/** What the check reads from the system, so tests can stand in for it. */
export interface SandboxSystem {
  platform: string;
  /** The program's path on the PATH the CLIs get, or null. */
  which(name: string): Promise<string | null>;
  /** Runs a program and says whether it exited with 0, with what it printed. */
  run(file: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }>;
  /** A text file's content, or null when it can't be read. */
  read(path: string): Promise<string | null>;
  /** The copy of bubblewrap Codex brings, which it uses when the system has none, or null. */
  codexBwrap(): Promise<string | null>;
}

/** The folders cli-funnel adds to its search path after the app's PATH. */
const FUNNEL_DIRS = (home: string) => [
  join(home, ".local", "bin"),
  join(home, ".bun", "bin"),
  join(home, ".cursor", "bin"),
  join(home, ".npm-global", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

/**
 * The PATH a CLI that cli-funnel starts gets, mirroring `childEnv` and `searchPath` in cli-funnel 0.7.0's
 * src/util/process.ts, which it doesn't export. The PATH in the env the app passes wins: with OfficeCLI that's its
 * folder before the app's own PATH (documents.ts). Without one, cli-funnel uses the app's PATH followed by the folders
 * installers use. It also finds programs with this search path, Codex among them.
 *
 * shortcut: leaves out the login shell's PATH, which cli-funnel's search path also adds; only a checkout without
 * OfficeCLI, or a Codex reached only through the shell profile, depends on it. Add it if such a setup is reported.
 */
export function cliPath(envPath: string | undefined, appPath = process.env.PATH ?? "", home = homedir()): string {
  if (envPath !== undefined) return envPath;
  return [...new Set([...appPath.split(delimiter).filter(Boolean), ...FUNNEL_DIRS(home)])].join(delimiter);
}

/** The Linux target npm's Codex package is built for, as its launcher (bin/codex.js) names it. */
const CODEX_TRIPLE: Record<string, string> = {
  x64: "x86_64-unknown-linux-musl",
  arm64: "aarch64-unknown-linux-musl",
};

/** Whether `path` is a file that can run. */
const runnable = (path: string) =>
  access(path, constants.X_OK)
    .then(() => stat(path))
    .then(
      (info) => info.isFile(),
      () => false,
    );

/**
 * The copy of bubblewrap that comes with Codex, from the path cli-funnel starts Codex by. The standalone installer and
 * the binary in npm's platform package both keep it at codex-resources/bwrap beside the folder of the codex binary.
 * npm's launcher, bin/codex.js, runs the binary from the platform package installed under it.
 */
export async function bundledBwrap(codex: string | null, arch = process.arch): Promise<string | null> {
  if (!codex) return null;
  const real = await realpath(codex).catch(() => null);
  if (!real) return null;
  const top = dirname(dirname(real));
  const triple = CODEX_TRIPLE[arch];
  const candidates = [join(top, "codex-resources", "bwrap")];
  if (real.endsWith(".js") && triple)
    candidates.push(
      join(top, "node_modules", "@openai", `codex-linux-${arch}`, "vendor", triple, "codex-resources", "bwrap"),
      join(top, "vendor", triple, "codex-resources", "bwrap"),
    );
  for (const candidate of candidates) if (await runnable(candidate)) return candidate;
  return null;
}

/** A program on `path` (the PATH variable): the first folder that has it as an executable file. */
export async function onPath(name: string, path = process.env.PATH ?? ""): Promise<string | null> {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const file = join(dir, name);
    if (await runnable(file)) return file;
  }
  return null;
}

/**
 * This computer, as the CLIs see it: programs are looked for, and bubblewrap runs, on the PATH they get (see
 * `cliPath`). `envPath` is the PATH in the env the engine passes them, if it passes one.
 */
export const systemFor = (envPath: string | undefined): SandboxSystem => ({
  platform: process.platform,
  which: (name) => onPath(name, cliPath(envPath)),
  run: (file, args, timeoutMs) =>
    new Promise((resolve) => {
      const env = { ...process.env, PATH: cliPath(envPath) };
      execFile(file, args, { env, timeout: timeoutMs, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
        const output = `${stderr}${stdout}`.trim().slice(-2000);
        if (!err) resolve({ ok: true, output });
        else if (err.killed)
          resolve({ ok: false, output: `${output}\nbwrap didn't finish in ${timeoutMs / 1000} s.`.trim() });
        else resolve({ ok: false, output: output || err.message });
      });
    }),
  read: (path) => readFile(path, "utf8").catch(() => null),
  // Where cli-funnel would start Codex from: its override, or the search path (cliPath without the app's env).
  codexBwrap: async () => bundledBwrap(process.env.CLI_FUNNEL_CODEX_BIN || (await onPath("codex", cliPath(undefined)))),
});

/** The distribution in an os-release file, or null when it names none. */
export function parseOsRelease(text: string): Distro | null {
  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z_]+)=(.*)$/.exec(line);
    if (!match?.[1]) continue;
    let value = (match[2] ?? "").trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) value = value.slice(1, -1);
    fields[match[1]] = value.replace(/\\(["'$`\\])/g, "$1");
  }
  if (!fields.ID && !fields.NAME) return null;
  return {
    id: fields.ID ?? "",
    like: (fields.ID_LIKE ?? "").split(/\s+/).filter(Boolean),
    name: fields.NAME ?? fields.ID ?? "",
    version: fields.VERSION_ID ?? "",
  };
}

/**
 * Whether the sandbox can start for `provider`, or for both AIs when it's null (setup asks before an AI is chosen).
 * Only Linux is checked: the Mac's sandbox is part of the system, and on Windows Codex brings its own and Claude Code
 * runs without one. The result isn't kept, so a fix made in a terminal counts at the next check.
 */
export async function checkSandbox(provider: AgentProvider | null, system: SandboxSystem): Promise<SandboxReadiness> {
  if (system.platform !== "linux") return { ready: true, missing: [], distro: null, appArmorRestrictsUserns: null };
  const needs = (what: SandboxMissing) => provider === null || SANDBOX_NEEDS[what].includes(provider);
  const missing: SandboxMissing[] = [];
  let detail: string | undefined;

  // Without the system's bubblewrap, Codex runs the copy it brings; Claude Code has none, so it needs the system's.
  const bwrap = await system.which("bwrap");
  const bundled = !bwrap && provider === "codex" ? await system.codexBwrap() : null;
  const tried = bwrap ?? bundled;
  if (!tried) missing.push("bwrap");
  else {
    const probe = await system.run(tried, BWRAP_PROBE, PROBE_TIMEOUT_MS);
    if (!probe.ok) {
      // Codex's copy blocked too: on Ubuntu 24.04 and later AppArmor's profile covers only /usr/bin/bwrap, so the
      // system's package goes first, then the profile.
      if (bundled) missing.push("bwrap");
      missing.push("userns");
      detail = probe.output;
    }
  }
  if (needs("socat") && !(await system.which("socat"))) missing.push("socat");

  const release = (await system.read("/etc/os-release")) ?? (await system.read("/usr/lib/os-release"));
  const restriction = (await system.read(APPARMOR_USERNS))?.trim();
  return {
    ready: missing.length === 0,
    missing,
    distro: release === null ? null : parseOsRelease(release),
    appArmorRestrictsUserns: restriction === undefined ? null : restriction === "1",
    ...(detail ? { detail } : {}),
  };
}
