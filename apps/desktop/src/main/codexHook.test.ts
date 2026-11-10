/** @vitest-environment node */
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codexConfig } from "./agentHomes";
import {
  appServerLister,
  type CodexHook,
  checkCodexHook,
  HOOK_TIMEOUT_S,
  type HookLister,
  type HookListing,
  hookCommand,
  hooksJson,
  type ListedHook,
  trustLines,
  writeCodexHook,
} from "./codexHook";
import { type HookAnswer, ToolServer } from "./mcp/server";

const posix = process.platform !== "win32";

describe("the hook's command", () => {
  it("runs the helper with the app's executable as Node, quoting both paths for sh, bash and zsh", () => {
    const command = hookCommand(
      "darwin",
      "/Applications/Tost Work.app/Contents/MacOS/Tost Work",
      "/Users/d'Amico/h.cjs",
    );
    expect(command).toContain(`ELECTRON_RUN_AS_NODE=1 '/Applications/Tost Work.app/Contents/MacOS/Tost Work'`);
    expect(command).toContain(`'/Users/d'\\''Amico/h.cjs'`);
    expect(command).toMatch(/exit 2$/);
  });

  it("runs the helper from PowerShell on Windows, waiting for it, with each path quoted for PowerShell", () => {
    const exe = "C:\\Users\\Giulia D'Amico\\AppData\\Local\\Programs\\tost-work\\Tost Work.exe";
    const command = hookCommand("win32", exe, "C:\\Users\\Giulia D'Amico\\AppData\\Roaming\\Tost Work\\h.cjs");
    expect(command).toContain(
      "$env:ELECTRON_RUN_AS_NODE='1';& 'C:\\Users\\Giulia D''Amico\\AppData\\Local\\Programs\\tost-work\\Tost Work.exe' 'C:\\Users\\Giulia D''Amico\\AppData\\Roaming\\Tost Work\\h.cjs' | Out-Null;",
    );
    expect(command).not.toContain('"');
    expect(command).toMatch(/exit 2$/);
  });

  it("sends the step from PowerShell itself inside the Microsoft Store package, with no program path", () => {
    const command = hookCommand(
      "win32",
      "C:\\Program Files\\WindowsApps\\Tost.TostWork_1\\app\\Tost Work.exe",
      "x",
      true,
    );
    expect(command).not.toContain('"');
    expect(command).not.toContain("Tost Work.exe");
    expect(command).toContain("$env:TOST_WORK_HOOK_URL");
    expect(command).toContain("$env:TOST_WORK_HOOK_TOKEN");
    expect(command).toMatch(/catch\{\$a=\$null\}/);
    expect(command).toMatch(/exit 2$/);
  });

  it("writes one PreToolUse hook for every tool, waiting a week for a card", () => {
    expect(JSON.parse(hooksJson("x"))).toEqual({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "x", timeout: HOOK_TIMEOUT_S }] }] },
    });
    expect(HOOK_TIMEOUT_S).toBe(604_800);
  });
});

/** The shells Codex may run the hook with on this computer. */
const shells = ["sh", "bash", "zsh"].filter((s) => posix && spawnSync("sh", ["-c", `command -v ${s}`]).status === 0);

describe.runIf(posix)("the hook, run as Codex runs it", () => {
  const steps: unknown[] = [];
  const server = new ToolServer({
    ask: async () => "",
    approve: async () => "",
    reportFile: async () => {},
    makePdf: async () => "",
    review: async () => {},
    gate: async (_taskId, body): Promise<HookAnswer> => {
      steps.push(body);
      const command = (body as { tool_input?: { command?: string } }).tool_input?.command ?? "";
      if (command === "ls") return { decision: "allow" };
      if (command === "slow") await new Promise((r) => setTimeout(r, 300));
      return { decision: "deny", reason: `Non così: ${command}` };
    },
  });
  let session: { url: string; token: string };
  let home: string;
  beforeAll(async () => {
    await server.start();
    session = server.open("t1");
    // A folder name with a space and an apostrophe, as a user's name can have.
    home = await mkdtemp(join(tmpdir(), "tw hook d'Amico "));
  });
  afterAll(() => server.stop());

  /** Runs the hook's command with `shell -c`, as Codex does, with the step on stdin. */
  const runHook = (
    shell: string,
    command: string,
    stepCommand: string,
    env: Record<string, string | undefined> = {},
  ): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      const child = spawn(shell, ["-c", command], {
        env: {
          ...process.env,
          TOST_WORK_HOOK_URL: new URL("/hook", session.url).toString(),
          TOST_WORK_HOOK_TOKEN: session.token,
          ...env,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(JSON.stringify({ tool_name: "Bash", tool_input: { command: stepCommand }, tool_use_id: "c1" }));
    });

  for (const shell of shells)
    it(`allows with exit 0 and refuses with exit 2 and the reason, under ${shell}`, async () => {
      const hook = writeCodexHook(home, codexConfig("linux"), "linux", process.execPath);
      expect(await runHook(shell, hook.command, "ls")).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(await runHook(shell, hook.command, "rm x")).toEqual({ code: 2, stdout: "", stderr: "Non così: rm x\n" });
      expect((await runHook(shell, hook.command, "slow")).code).toBe(2);
      expect(steps.at(-1)).toMatchObject({ tool_name: "Bash", tool_use_id: "c1" });
    });

  it("refuses when it can't reach Tost Work, can't start, or wasn't given the run's address", async () => {
    const hook = writeCodexHook(home, codexConfig("linux"), "linux", process.execPath);
    const failed = { code: 2, stdout: "", stderr: "Tost Work could not check this step.\n" };
    expect(await runHook("sh", hook.command, "ls", { TOST_WORK_HOOK_URL: "http://127.0.0.1:9/hook" })).toEqual(failed);
    expect(await runHook("sh", hook.command, "ls", { TOST_WORK_HOOK_TOKEN: "not-the-token" })).toEqual(failed);
    expect(await runHook("sh", hook.command, "ls", { TOST_WORK_HOOK_URL: undefined })).toEqual(failed);
    const gone = hookCommand("linux", join(home, "no-such-program"), join(home, "tost-work-hook.cjs"));
    expect(await runHook("sh", gone, "ls")).toMatchObject({
      code: 2,
      stderr: expect.stringMatching(/could not check/),
    });
    // A shell that stops at the first error, as `set -e` in a profile would make it.
    const strict = await runHook("sh", `set -e; ${hook.command}`, "rm x");
    expect(strict.code).toBe(2);
  });
});

const listed = (hook: CodexHook, over: Partial<ListedHook> = {}): ListedHook => ({
  key: `${hook.file}:pre_tool_use:0:0`,
  eventName: "preToolUse",
  handlerType: "command",
  command: hook.command,
  matcher: null,
  timeoutSec: HOOK_TIMEOUT_S,
  sourcePath: hook.file,
  enabled: true,
  currentHash: "sha256:abc",
  trustStatus: "trusted",
  ...over,
});

/** A Codex that lists what `answer` says, given config.toml as it is on disk each time. */
function fakeCodex(answer: (config: string) => HookListing) {
  const log = { lists: 0, closed: 0 };
  const open = async (): Promise<HookLister> => ({
    list: async () => {
      log.lists++;
      return answer(await readFile(join(home, "config.toml"), "utf8"));
    },
    close: () => {
      log.closed++;
    },
  });
  let home = "";
  return {
    log,
    open,
    at: (h: string) => {
      home = h;
    },
  };
}

describe("checking that Codex will run the hook", () => {
  async function written() {
    const home = await mkdtemp(join(tmpdir(), "tw-codex-home-"));
    const config = codexConfig("linux");
    await writeFile(join(home, "config.toml"), config);
    return writeCodexHook(home, config, "linux", "/opt/Tost Work/tost-work");
  }

  it("trusts the hook with the hash Codex gives, then checks that Codex now trusts it", async () => {
    const hook = await written();
    const codex = fakeCodex((config) => ({
      hooks: [listed(hook, { trustStatus: config.includes('trusted_hash = "sha256:abc"') ? "trusted" : "untrusted" })],
      errors: [],
    }));
    codex.at(hook.home);
    await checkCodexHook(hook, "/w", codex.open, "linux");
    expect(await readFile(join(hook.home, "config.toml"), "utf8")).toBe(
      hook.config + trustLines(`${hook.file}:pre_tool_use:0:0`, "sha256:abc"),
    );
    expect(codex.log).toEqual({ lists: 2, closed: 1 });
    // Trusted already, it only looks.
    await checkCodexHook(hook, "/w", codex.open, "linux");
    expect(codex.log).toEqual({ lists: 3, closed: 2 });
  });

  it("trusts a hook again when Codex hashes it differently, as after an update", async () => {
    const hook = await written();
    await writeFile(join(hook.home, "config.toml"), hook.config + trustLines(`${hook.file}:pre_tool_use:0:0`, "old"));
    const codex = fakeCodex((config) => ({
      hooks: [listed(hook, { currentHash: "new", trustStatus: config.includes('"new"') ? "trusted" : "modified" })],
      errors: [],
    }));
    codex.at(hook.home);
    await checkCodexHook(hook, "/w", codex.open, "linux");
    expect(await readFile(join(hook.home, "config.toml"), "utf8")).toContain('trusted_hash = "new"');
  });

  it("refuses when Codex won't run the hook as written", async () => {
    const hook = await written();
    const cases: [string, (config: string) => HookListing][] = [
      ["still untrusted after trusting", () => ({ hooks: [listed(hook, { trustStatus: "untrusted" })], errors: [] })],
      ["not listed, as with hooks turned off", () => ({ hooks: [], errors: [] })],
      ["another command", () => ({ hooks: [listed(hook, { command: "true" })], errors: [] })],
      ["some tools only", () => ({ hooks: [listed(hook, { matcher: "Bash" })], errors: [] })],
      ["a shorter wait", () => ({ hooks: [listed(hook, { timeoutSec: 600 })], errors: [] })],
      ["turned off", () => ({ hooks: [listed(hook, { enabled: false })], errors: [] })],
      ["two hooks", () => ({ hooks: [listed(hook), listed(hook, { key: "x" })], errors: [] })],
      [
        "an mcp_tool hook",
        () => ({ hooks: [listed(hook, { handlerType: "mcpTool", command: undefined })], errors: [] }),
      ],
    ];
    for (const [name, answer] of cases) {
      const codex = fakeCodex(answer);
      codex.at(hook.home);
      await expect(checkCodexHook(hook, "/w", codex.open, "linux"), name).rejects.toMatchObject({
        key: "error.codexHookOff",
      });
      expect(codex.log.closed, name).toBe(1);
    }
    // A Codex that can't start, or doesn't know hooks/list.
    await expect(
      checkCodexHook(hook, "/w", () => Promise.reject(new Error("spawn codex ENOENT")), "linux"),
    ).rejects.toMatchObject({ key: "error.codexHookOff", vars: { detail: "spawn codex ENOENT" } });
    const unknown = async (): Promise<HookLister> => ({
      list: () => Promise.reject(new Error("Unknown method hooks/list")),
      close: () => {},
    });
    await expect(checkCodexHook(hook, "/w", unknown, "linux")).rejects.toMatchObject({ key: "error.codexHookOff" });
  });
});

/** The installed Codex, when this computer has one: the check needs no sign-in. Set TOST_WORK_LIVE to run it. */
const codexBin = posix ? spawnSync("sh", ["-c", "command -v codex"]).stdout.toString().trim() : "";

describe.runIf(process.env.TOST_WORK_LIVE && codexBin)("the check against the installed Codex", () => {
  it("trusts the hook, and refuses once hooks.json changes behind its back", { timeout: 60_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-codex-live-"));
    const home = join(root, "codex");
    const { giveAgentsOwnHomes } = await import("./agentHomes");
    const env: NodeJS.ProcessEnv = { ...process.env };
    const hook = giveAgentsOwnHomes(root, env, "linux", process.execPath);
    const open = () => appServerLister(codexBin, env);
    const started = Date.now();
    await checkCodexHook(hook, root, open, "linux");
    const first = Date.now() - started;
    expect(await readFile(join(home, "config.toml"), "utf8")).toMatch(/\[hooks\.state\..*\]\ntrusted_hash = "sha256:/);
    const again = Date.now();
    await checkCodexHook(hook, root, open, "linux");
    console.log(`check: ${first} ms the first time, ${Date.now() - again} ms once trusted`);
    // Someone else's hook in its place is no longer the one Tost Work trusted.
    await writeFile(hook.file, hooksJson("echo allowed"));
    await expect(checkCodexHook(hook, root, open, "linux")).rejects.toMatchObject({ key: "error.codexHookOff" });
  });
});
