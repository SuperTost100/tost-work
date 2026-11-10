/** @vitest-environment node */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codexConfig } from "./agentHomes";
import {
  appServerLister,
  CodexConfigFile,
  type CodexHook,
  type ConfigReading,
  checkCodexHook,
  folderKeys,
  HOOK_TIMEOUT_S,
  type HookLister,
  type HookListing,
  hookCommand,
  hooksJson,
  type ListedHook,
  trustLines,
  untrustedLines,
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

  it("doubles every quote PowerShell ends a single-quoted string at, such as the curly one in D’Angelo", () => {
    const command = hookCommand("win32", "C:\\Users\\D’Angelo‘‚‛\\Tost Work.exe", "C:\\Users\\D’Angelo\\h.cjs");
    expect(command).toContain(
      "& 'C:\\Users\\D’’Angelo‘‘‚‚‛‛\\Tost Work.exe' 'C:\\Users\\D’’Angelo\\h.cjs' | Out-Null;",
    );
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

/** The folders config.toml lists as untrusted, read back as Codex would. */
const untrustedIn = (config: string): ConfigReading["projects"] =>
  Object.fromEntries(
    [...config.matchAll(/^\[projects\.("(?:[^"\\]|\\.)*")\]\ntrust_level = "untrusted"$/gm)].map((m) => [
      JSON.parse(m[1] as string),
      { trust_level: "untrusted" },
    ]),
  );

/**
 * A Codex that lists what `answer` says, given config.toml as it is on disk each time, and reads the folders'
 * settings as `read` says, by default none in use and the folders config.toml lists as untrusted.
 */
function fakeCodex(
  answer: (config: string) => HookListing,
  read: (config: string) => ConfigReading = (config) => ({ layers: [], projects: untrustedIn(config) }),
) {
  const log = { lists: 0, reads: 0, closed: 0 };
  const config = () => readFile(join(home, "config.toml"), "utf8");
  const open = async (): Promise<HookLister> => ({
    list: async () => {
      log.lists++;
      return answer(await config());
    },
    read: async () => {
      log.reads++;
      return read(await config());
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
      hook.config.base + trustLines(`${hook.file}:pre_tool_use:0:0`, "sha256:abc") + untrustedLines("/w"),
    );
    expect(codex.log).toEqual({ lists: 2, reads: 1, closed: 1 });
    // Trusted already, it only looks.
    await checkCodexHook(hook, "/w", codex.open, "linux");
    expect(codex.log).toEqual({ lists: 3, reads: 2, closed: 2 });
  });

  it("trusts a hook again when Codex hashes it differently, as after an update", async () => {
    const hook = await written();
    await hook.config.trust(`${hook.file}:pre_tool_use:0:0`, "old");
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
      read: () => Promise.reject(new Error("Unknown method config/read")),
      close: () => {},
    });
    await expect(checkCodexHook(hook, "/w", unknown, "linux")).rejects.toMatchObject({ key: "error.codexHookOff" });
  });

  it("lists the task's folder as untrusted first, and refuses when Codex would still use the folder's settings", async () => {
    const hook = await written();
    const trusted = () => ({ hooks: [listed(hook)], errors: [] });
    const cases: [string, (config: string) => ConfigReading][] = [
      [
        "a .codex folder in use",
        (config) => ({
          layers: [{ name: { type: "project", dotCodexFolder: "/w/.codex" } }],
          projects: untrustedIn(config),
        }),
      ],
      ["the folder not listed as untrusted", () => ({ layers: [], projects: {} })],
      ["the folder trusted", () => ({ layers: [], projects: { "/w": { trust_level: "trusted" } } })],
    ];
    for (const [name, read] of cases) {
      const codex = fakeCodex(trusted, read);
      codex.at(hook.home);
      await expect(checkCodexHook(hook, "/w", codex.open, "linux"), name).rejects.toMatchObject({
        key: "error.codexHookOff",
      });
    }
    // A folder's settings that Codex lists but won't use are fine.
    const off = fakeCodex(trusted, (config) => ({
      layers: [{ name: { type: "project", dotCodexFolder: "/w/.codex" }, disabledReason: "untrusted" }],
      projects: untrustedIn(config),
    }));
    off.at(hook.home);
    await checkCodexHook(hook, "/w", off.open, "linux");
  });
});

describe("config.toml in Tost Work's Codex home", () => {
  it("names a folder as Codex looks it up: with links resolved first, then as given", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "tw-folder-keys-")));
    try {
      await mkdir(join(root, "real"));
      await symlink(join(root, "real"), join(root, "link"));
      expect(folderKeys(join(root, "link"))).toEqual([join(root, "real"), join(root, "link")]);
      expect(folderKeys(join(root, "real", "..", "real"))).toEqual([join(root, "real")]);
      expect(folderKeys(join(root, "missing"))).toEqual([join(root, "missing")]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes each change after the one before, keeping every task's folder and the hook's trust", async () => {
    const home = await mkdtemp(join(tmpdir(), "tw-config-"));
    const path = join(home, "config.toml");
    const writes: string[] = [];
    let writing = false;
    const slow = async (p: string, text: string) => {
      expect(writing).toBe(false);
      writing = true;
      await new Promise((r) => setTimeout(r, 5));
      await writeFile(p, text);
      writes.push(text);
      writing = false;
    };
    const file = new CodexConfigFile(path, "base\n", slow);
    file.writeNow();
    await Promise.all([file.untrust(["/a"]), file.trust("k", "h"), file.untrust(["/b", "/a"]), file.untrust(["/c"])]);
    const want = `base\n${trustLines("k", "h")}${untrustedLines("/a")}${untrustedLines("/b")}${untrustedLines("/c")}`;
    expect(await readFile(path, "utf8")).toBe(want);
    expect(writes).toHaveLength(4);
    // Nothing new to write: the file stays as it is.
    await file.untrust(["/b"]);
    expect(writes).toHaveLength(4);
    // The next start writes the settings alone.
    new CodexConfigFile(path, "base\n").writeNow();
    expect(await readFile(path, "utf8")).toBe("base\n");
    await rm(home, { recursive: true, force: true });
  });

  it("writes into a new file and renames it over config.toml, leaving no temporary file", async () => {
    const home = await mkdtemp(join(tmpdir(), "tw-config-"));
    const file = new CodexConfigFile(join(home, "config.toml"), "base\n");
    file.writeNow();
    await file.untrust(['C:\\Users\\D’Angelo\\"Lavoro"\u007f']);
    const text = await readFile(join(home, "config.toml"), "utf8");
    expect(text).toContain('[projects."C:\\\\Users\\\\D’Angelo\\\\\\"Lavoro\\"\\u007f"]');
    expect(untrustedIn(text)).toEqual({ 'C:\\Users\\D’Angelo\\"Lavoro"\u007f': { trust_level: "untrusted" } });
    expect(await readdir(home)).toEqual(["config.toml"]);
    await rm(home, { recursive: true, force: true });
  });
});

/** The installed Codex, when this computer has one: the check needs no sign-in. Set TOST_WORK_LIVE to run it. */
const codexBin = posix ? spawnSync("sh", ["-c", "command -v codex"]).stdout.toString().trim() : "";

/** A `codex app-server` on a home, for requests the check itself doesn't make. */
function appServer(env: NodeJS.ProcessEnv) {
  const child = spawn(codexBin, ["app-server"], { env });
  child.stderr.resume();
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.startsWith("{")) continue;
      const message = JSON.parse(line) as { id?: number; method?: string; result?: unknown; error?: unknown };
      const p = typeof message.id === "number" && !message.method ? pending.get(message.id) : undefined;
      if (message.error) p?.reject(new Error(JSON.stringify(message.error)));
      else p?.resolve(message.result);
    }
  });
  const request = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  return {
    async start() {
      await request("initialize", { clientInfo: { name: "test", title: null, version: "0" }, capabilities: {} });
      child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    },
    request,
    /** Ends it, and waits until it has, since Codex writes into its home until it exits. */
    close: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.stdin.end();
        child.kill();
      }),
  };
}

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

  it("keeps the hook and the sandbox when the task's folder, or a repository above it, brings its own .codex settings", {
    timeout: 120_000,
  }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "tw-codex-folder-")));
    const server = { close: async () => {} };
    try {
      const { giveAgentsOwnHomes } = await import("./agentHomes");
      const env: NodeJS.ProcessEnv = { ...process.env };
      const hook = giveAgentsOwnHomes(join(root, "agents"), env, "linux", process.execPath);
      const outside = join(root, "outside");
      await mkdir(outside);
      // Settings a zip or a shared folder could bring: hooks off, and commands allowed to write outside.
      const settings = `[features]\nhooks = false\n\n[sandbox_workspace_write]\nwritable_roots = [${JSON.stringify(outside)}]\n`;
      const own = join(root, "task");
      await mkdir(join(own, ".codex"), { recursive: true });
      await writeFile(join(own, ".codex", "config.toml"), settings);
      const repo = join(root, "repo");
      await mkdir(join(repo, ".codex"), { recursive: true });
      await writeFile(join(repo, ".codex", "config.toml"), settings);
      expect(spawnSync("git", ["init", "-q"], { cwd: repo }).status).toBe(0);
      const inRepo = join(repo, "sub");
      await mkdir(inRepo);
      const codex = appServer(env);
      server.close = codex.close;
      await codex.start();
      for (const folder of [own, inRepo]) {
        await checkCodexHook(hook, folder, () => appServerLister(codexBin, env), "linux");
        // What the task's own Codex then does: start the thread, which may trust the folder, and list its hooks.
        const started = (await codex.request("thread/start", {
          cwd: folder,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          ephemeral: true,
        })) as { thread: { id: string }; sandbox: { writableRoots?: string[] } };
        expect(started.sandbox.writableRoots ?? [], folder).not.toContain(outside);
        const hooks = (await codex.request("hooks/list", { threadId: started.thread.id })) as {
          data: { hooks: ListedHook[] }[];
        };
        expect(
          hooks.data.flatMap((d) => d.hooks).map((h) => [h.sourcePath, h.trustStatus]),
          folder,
        ).toEqual([[hook.file, "trusted"]]);
      }
      expect(await readFile(join(hook.home, "config.toml"), "utf8")).not.toMatch(/trust_level = "trusted"/);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
