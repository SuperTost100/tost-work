import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type InstallResult, installLine } from "../shared/install";
import type { AgentProvider } from "../shared/model";

const TIMEOUT_MS = 10 * 60_000;

/** The program that runs an installer line: bash with pipefail, so a failed download fails the line, or PowerShell. */
export function installCommand(provider: AgentProvider, platform: string): { file: string; args: string[] } {
  const line = installLine(provider, platform);
  if (platform === "win32")
    return { file: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", line] };
  return { file: "/bin/bash", args: ["-c", `set -o pipefail; ${line}`] };
}

/** What a failed install's output most likely means. */
export function installFailure(output: string): Exclude<InstallResult, { ok: true }> {
  const lines = output.trim().split("\n");
  const detail = lines.slice(-3).join("\n").trim() || "The installer stopped without saying why.";
  if (
    /could not resolve host|failed to connect|network is unreachable|no such host|unable to connect|timed out/i.test(
      output,
    )
  )
    return { ok: false, reason: "offline", detail };
  if (/no space left|ENOSPC|not enough space|disk is full/i.test(output)) return { ok: false, reason: "space", detail };
  return { ok: false, reason: "failed", detail };
}

/** Where Codex's Windows installer puts it, which cli-funnel doesn't look in on its own. */
const windowsCodex = () => join(process.env.LOCALAPPDATA ?? "", "Programs", "OpenAI", "Codex", "bin", "codex.exe");

/** Points cli-funnel at Codex on Windows, when the official installer put it there. */
export function findInstalledCodex(platform = process.platform): void {
  if (platform === "win32" && !process.env.CLI_FUNNEL_CODEX_BIN && existsSync(windowsCodex()))
    process.env.CLI_FUNNEL_CODEX_BIN = windowsCodex();
}

/** Runs the official installers, one at a time per CLI. */
export class Installer {
  private running = new Map<AgentProvider, Promise<InstallResult>>();

  constructor(
    private run: (file: string, args: string[]) => Promise<{ code: number | null; output: string }> = runProcess,
    private platform = process.platform,
  ) {}

  install(provider: AgentProvider): Promise<InstallResult> {
    const already = this.running.get(provider);
    if (already) return already;
    const { file, args } = installCommand(provider, this.platform);
    const done = this.run(file, args)
      .then(({ code, output }): InstallResult => {
        if (code !== 0) return installFailure(output);
        if (provider === "codex") findInstalledCodex(this.platform);
        return { ok: true };
      })
      .catch((err: unknown): InstallResult => installFailure(err instanceof Error ? err.message : String(err)))
      .finally(() => this.running.delete(provider));
    this.running.set(provider, done);
    return done;
  }
}

/**
 * Runs a program and keeps the end of its output, for the error message. On timeout it stops the whole process tree,
 * not just the shell, because a stalled download would otherwise keep the pipes open and the install "running".
 */
export function runProcess(
  file: string,
  args: string[],
  timeoutMs = TIMEOUT_MS,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    // Its own process group on Mac and Linux, so the group can be stopped as one.
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: !windows });
    let output = "";
    let settled = false;
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      if (settled || child.pid === undefined) return;
      settled = true;
      try {
        if (windows) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone: nothing left to stop.
      }
      resolve({
        code: null,
        output: `${output}\nThe installer took more than ${timeoutMs / 60_000} minutes and was stopped.`,
      });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code, output });
    });
  });
}
