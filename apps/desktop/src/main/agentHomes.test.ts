/** @vitest-environment node */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codexConfig, giveAgentsOwnHomes } from "./agentHomes";

describe("agent homes", () => {
  it("points both CLIs at Tost Work's homes, with outside instructions and skills off", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "tw-agents-")), "agents");
    const env: NodeJS.ProcessEnv = { HOME: "/home/giulia" };
    giveAgentsOwnHomes(root, env, "linux");
    expect(env).toMatchObject({
      HOME: "/home/giulia",
      CODEX_HOME: join(root, "codex"),
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      // No usage telemetry or error reports from Claude Code: Tost Work has no telemetry.
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
    });
    const codex = await readFile(join(root, "codex", "config.toml"), "utf8");
    expect(codex).toContain("project_doc_max_bytes = 0");
    expect(codex).toMatch(/\[skills\]\ninclude_instructions = false/);
    expect(codex).toMatch(/\[skills\.bundled\]\nenabled = false/);
    // ChatGPT's apps and plugins stay out: a task doesn't use them, and they'd reach the user's connected accounts.
    expect(codex).toMatch(/\[features\]\napps = false\nplugins = false\nremote_plugin = false\n/);
    expect(codex).toMatch(/\[analytics\]\nenabled = false/);
    // Hooks stay on for Tost Work's check before each step, whose address and token commands don't get.
    expect(codex).toMatch(/\nhooks = true\n/);
    expect(codex).toMatch(/\[shell_environment_policy\]\nexclude = \["TOST_WORK_HOOK_\*"\]\n/);
    const claude = JSON.parse(await readFile(join(root, "claude", "settings.json"), "utf8"));
    expect(claude).toMatchObject({ disableBundledSkills: true, syncClaudeAiSkills: false });
  });

  it("writes Tost Work's hook into Codex's home, run by the app's executable, and returns it for the check", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "tw-agents-")), "agents");
    const hook = giveAgentsOwnHomes(root, {}, "linux", "/tmp/.mount_tostAb12/tost-work");
    const home = join(root, "codex");
    expect(hook).toMatchObject({ home, file: join(home, "hooks.json"), config: codexConfig("linux") });
    const json = JSON.parse(await readFile(hook.file, "utf8"));
    expect(json.hooks.PreToolUse[0].hooks[0]).toMatchObject({ type: "command", command: hook.command });
    expect(hook.command).toContain(`'/tmp/.mount_tostAb12/tost-work' '${join(home, "tost-work-hook.cjs")}'`);
    expect(await readFile(join(home, "tost-work-hook.cjs"), "utf8")).toContain("TOST_WORK_HOOK_URL");
    // The next start writes the executable's new place: an AppImage mounts itself somewhere new each time.
    const next = giveAgentsOwnHomes(root, {}, "linux", "/tmp/.mount_tostCd34/tost-work");
    expect(JSON.parse(await readFile(next.file, "utf8")).hooks.PreToolUse[0].hooks[0].command).toContain(
      "/tmp/.mount_tostCd34/tost-work",
    );
  });

  it("puts its settings back each start, and leaves the sign-in alone", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "tw-agents-")), "agents");
    giveAgentsOwnHomes(root, {});
    await writeFile(join(root, "codex", "config.toml"), "project_doc_max_bytes = 32768\n");
    await writeFile(join(root, "codex", "auth.json"), "{}");
    giveAgentsOwnHomes(root, {});
    expect(await readFile(join(root, "codex", "config.toml"), "utf8")).toContain("project_doc_max_bytes = 0");
    expect(await readFile(join(root, "codex", "auth.json"), "utf8")).toBe("{}");
  });

  it("picks a Windows sandbox that needs no administrator, so Codex can write in the task's folder", () => {
    const windows = codexConfig("win32");
    // Without a Windows sandbox, Codex turns workspace-write into read-only. MXC where Windows has it, else unelevated.
    expect(windows).toMatch(/\[features\]\n(?:[a-z_]+ = false\n)+hooks = true\nprefer_mxc = true\n\n\[analytics\]/);
    expect(windows).toMatch(/\n\[windows\]\nsandbox = "unelevated"\n$/);
    // Each table once: TOML refuses a table defined twice, and Codex would then refuse the whole file.
    for (const table of ["[features]", "[windows]", "[shell_environment_policy]"])
      expect(windows.split(table)).toHaveLength(2);
    for (const platform of ["darwin", "linux"] as const) {
      const other = codexConfig(platform);
      expect(other).not.toContain("prefer_mxc");
      expect(other).not.toContain("[windows]");
    }
  });
});
