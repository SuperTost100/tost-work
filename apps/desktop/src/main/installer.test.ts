/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { Installer, installCommand, installFailure, runProcess } from "./installer";

describe("installCommand", () => {
  it("runs the official installer with bash and pipefail, or with PowerShell on Windows", () => {
    expect(installCommand("claude", "darwin")).toEqual({
      file: "/bin/bash",
      args: ["-c", "set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash"],
    });
    const codex = installCommand("codex", "linux").args[1];
    expect(codex).toContain("https://chatgpt.com/codex/install.sh");
    expect(codex).toContain("CODEX_NON_INTERACTIVE=1");
    const windows = installCommand("claude", "win32");
    expect(windows.file).toBe("powershell.exe");
    expect(windows.args.at(-1)).toBe("irm https://claude.ai/install.ps1 | iex");
  });
});

describe("installFailure", () => {
  it("names the likely cause of a failed install", () => {
    expect(installFailure("curl: (6) Could not resolve host: claude.ai").reason).toBe("offline");
    expect(installFailure("tar: write error: No space left on device").reason).toBe("space");
    expect(installFailure("line 1\nline 2\nline 3\nbash: line 1: curl: command not found")).toEqual({
      ok: false,
      reason: "failed",
      detail: "line 2\nline 3\nbash: line 1: curl: command not found",
    });
  });
});

describe("Installer", () => {
  it("runs one install per CLI at a time, and reports how it went", async () => {
    const runs: string[][] = [];
    let finish: (r: { code: number | null; output: string }) => void = () => {};
    const installer = new Installer(
      (_file, args) =>
        new Promise((resolve) => {
          runs.push(args);
          finish = resolve;
        }),
      "linux",
    );
    const first = installer.install("claude");
    const second = installer.install("claude");
    expect(runs).toHaveLength(1);
    finish({ code: 0, output: "Claude Code installed" });
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });

    const failed = installer.install("claude");
    finish({ code: 6, output: "curl: (6) Could not resolve host: claude.ai" });
    expect(await failed).toMatchObject({ ok: false, reason: "offline" });
    expect(runs).toHaveLength(2);
  });
});

describe.runIf(process.platform !== "win32")("runProcess", () => {
  it("stops the whole process tree on timeout and says so", async () => {
    const started = Date.now();
    // A shell whose child keeps the output pipe open, as a stalled download would.
    const result = await runProcess("/bin/bash", ["-c", "sleep 30 & echo started; wait"], 300);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.code).toBeNull();
    expect(result.output).toMatch(/started[\s\S]*was stopped/);
  });

  it("keeps the end of the output of a run that finishes", async () => {
    expect(await runProcess("/bin/bash", ["-c", "echo one; echo two >&2; exit 3"])).toEqual({
      code: 3,
      output: "one\ntwo\n",
    });
  });
});
