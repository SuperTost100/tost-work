/** @vitest-environment node */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { giveAgentsOwnHomes } from "./agentHomes";

describe("agent homes", () => {
  it("points both CLIs at Tost Work's homes, with outside instructions and skills off", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "tw-agents-")), "agents");
    const env: NodeJS.ProcessEnv = { HOME: "/home/giulia" };
    giveAgentsOwnHomes(root, env);
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
    const claude = JSON.parse(await readFile(join(root, "claude", "settings.json"), "utf8"));
    expect(claude).toMatchObject({ disableBundledSkills: true, syncClaudeAiSkills: false });
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
});
