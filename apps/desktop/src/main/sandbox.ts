import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
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
  /** The program's path on the PATH the CLIs inherit, or null. */
  which(name: string): Promise<string | null>;
  /** Runs a program and says whether it exited with 0, with what it printed. */
  run(file: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }>;
  /** A text file's content, or null when it can't be read. */
  read(path: string): Promise<string | null>;
}

/** A program on `path` (the PATH variable): the first folder that has it as an executable file. */
export async function onPath(name: string, path = process.env.PATH ?? ""): Promise<string | null> {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const file = join(dir, name);
    const usable = await access(file, constants.X_OK)
      .then(() => stat(file))
      .then(
        (info) => info.isFile(),
        () => false,
      );
    if (usable) return file;
  }
  return null;
}

export const realSystem: SandboxSystem = {
  platform: process.platform,
  which: (name) => onPath(name),
  run: (file, args, timeoutMs) =>
    new Promise((resolve) => {
      execFile(file, args, { timeout: timeoutMs, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
        const output = `${stderr}${stdout}`.trim().slice(-2000);
        if (!err) resolve({ ok: true, output });
        else if (err.killed)
          resolve({ ok: false, output: `${output}\nbwrap didn't finish in ${timeoutMs / 1000} s.`.trim() });
        else resolve({ ok: false, output: output || err.message });
      });
    }),
  read: (path) => readFile(path, "utf8").catch(() => null),
};

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
export async function checkSandbox(
  provider: AgentProvider | null,
  system: SandboxSystem = realSystem,
): Promise<SandboxReadiness> {
  if (system.platform !== "linux") return { ready: true, missing: [], distro: null, appArmorRestrictsUserns: null };
  const needs = (what: SandboxMissing) => provider === null || SANDBOX_NEEDS[what].includes(provider);
  const missing: SandboxMissing[] = [];
  let detail: string | undefined;

  const bwrap = await system.which("bwrap");
  if (!bwrap) missing.push("bwrap");
  else {
    const probe = await system.run(bwrap, BWRAP_PROBE, PROBE_TIMEOUT_MS);
    if (!probe.ok) {
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
