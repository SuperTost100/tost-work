/** @vitest-environment node */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFunnel } from "cli-funnel";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_FOLDER_MIN_VERSION,
  checkClaudeFolder,
  claudeFolderSettings,
  compareVersions,
  leavesFolderOut,
} from "./claudeFolder";
import { UserError } from "./userError";

let root = "";
afterEach(() => rm(root, { recursive: true, force: true }));

/** A home folder with Documents/task inside, and `files` written relative to the home folder. */
async function layout(files: string[]) {
  root = await realpath(await mkdtemp(join(tmpdir(), "tw-claude-folder-")));
  const home = join(root, "home");
  const work = join(home, "Documents", "task");
  await mkdir(work, { recursive: true });
  for (const file of files) {
    await mkdir(dirname(join(home, file)), { recursive: true });
    await writeFile(join(home, file), "{}");
  }
  return { home, work };
}

describe("Claude Code settings a task's folder brings", () => {
  it("finds none in a plain folder, or in what only the user's own Claude Code reads", async () => {
    const { home, work } = await layout([
      "Documents/task/report.docx",
      // In the home folder, Claude Code's own ~/.claude: Claude Code doesn't read these for a folder inside it.
      ".claude/settings.json",
      ".claude/settings.local.json",
      // A folder above only counts through its local settings.
      "Documents/.claude/settings.json",
      "Documents/.claude/agents/helper.md",
    ]);
    expect(await claudeFolderSettings(work, home)).toEqual([]);
    await checkClaudeFolder(work, home);
  });

  it("finds the task folder's own settings and MCP servers", async () => {
    for (const file of [".claude/settings.json", ".claude/settings.local.json", ".mcp.json"]) {
      const { home, work } = await layout([`Documents/task/${file}`]);
      expect(await claudeFolderSettings(work, home), file).toEqual([join(work, file)]);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds local settings in a folder above, such as a repository's top, and MCP servers anywhere above", async () => {
    let { home, work } = await layout(["Documents/.claude/settings.local.json"]);
    expect(await claudeFolderSettings(work, home)).toEqual([join(home, "Documents", ".claude", "settings.local.json")]);
    await rm(root, { recursive: true, force: true });
    ({ home, work } = await layout([".mcp.json"]));
    expect(await claudeFolderSettings(work, home)).toEqual([join(home, ".mcp.json")]);
  });

  it("follows a link to the task's folder, as Claude Code does", async () => {
    const { home } = await layout(["Elsewhere/.mcp.json"]);
    await mkdir(join(home, "Elsewhere", "task"));
    await symlink(join(home, "Elsewhere", "task"), join(root, "link"));
    expect(await claudeFolderSettings(join(root, "link"), home)).toEqual([join(home, "Elsewhere", ".mcp.json")]);
  });

  it("finds every file at once, in the task's folder and above it, in the order Claude Code's folders go up", async () => {
    const { home, work } = await layout([
      "Documents/task/.claude/settings.json",
      "Documents/task/.claude/settings.local.json",
      "Documents/task/.mcp.json",
      "Documents/.claude/settings.local.json",
      "Documents/.mcp.json",
      ".mcp.json",
    ]);
    expect(await claudeFolderSettings(work, home)).toEqual([
      join(work, ".claude", "settings.json"),
      join(work, ".claude", "settings.local.json"),
      join(work, ".mcp.json"),
      join(home, "Documents", ".claude", "settings.local.json"),
      join(home, "Documents", ".mcp.json"),
      join(home, ".mcp.json"),
    ]);
  });

  it("names a file once when the folder is reached through a link and again by its real path", async () => {
    const { home } = await layout(["Elsewhere/task/.mcp.json", "Elsewhere/.mcp.json"]);
    await symlink(join(home, "Elsewhere", "task"), join(root, "link"));
    expect(await claudeFolderSettings(join(root, "link"), home)).toEqual([
      join(root, "link", ".mcp.json"),
      join(home, "Elsewhere", ".mcp.json"),
    ]);
  });

  it("refuses naming every file, in the user's language, and the version when it's known", async () => {
    const { home, work } = await layout([
      "Documents/task/.claude/settings.local.json",
      "Documents/task/.mcp.json",
      ".mcp.json",
    ]);
    const paths = [join(work, ".claude", "settings.local.json"), join(work, ".mcp.json"), join(home, ".mcp.json")];
    const refusal = (version?: string) =>
      checkClaudeFolder(work, home, version).then(
        () => null,
        (e: unknown) => e as UserError,
      );
    const known = await refusal("2.1.321");
    expect(known).toBeInstanceOf(UserError);
    expect(known).toMatchObject({
      key: "error.claudeFolderSettings",
      vars: { files: paths.join("\n"), min: CLAUDE_FOLDER_MIN_VERSION, version: "2.1.321" },
    });
    for (const lang of ["en", "it"] as const) {
      const text = known?.say(lang) ?? "";
      for (const path of paths) expect(text, `${lang} ${path}`).toContain(path);
      expect(text, lang).toContain("2.1.321");
      expect(text, lang).toContain(CLAUDE_FOLDER_MIN_VERSION);
      expect(text, lang).toContain("claude update");
      expect(text, lang).not.toMatch(/\{\w+\}/);
    }
    expect(known?.say("en")).not.toMatch(/by itself|updates itself/);
    expect(known?.say("it")).not.toMatch(/da solo/);
    // A version that couldn't be read is left out, and the message says so instead of naming one.
    const unknown = await refusal();
    expect(unknown).toMatchObject({ key: "error.claudeFolderSettingsNoVersion" });
    for (const lang of ["en", "it"] as const) {
      const text = unknown?.say(lang) ?? "";
      for (const path of paths) expect(text, `${lang} ${path}`).toContain(path);
      expect(text, lang).toContain("claude update");
      expect(text, lang).not.toMatch(/\{\w+\}|undefined/);
    }
  });
});

describe("leaving the folder's own settings out of a run", () => {
  // The real capabilities, so a change in cli-funnel's minimum versions shows here.
  const funnel = createFunnel();
  afterAll(() => funnel.close());
  const on = (provider: "claude" | "codex", version: string | undefined | Error) =>
    leavesFolderOut({
      capabilities: funnel.providers[provider].capabilities,
      detect: async () => {
        if (version instanceof Error) throw version;
        return { version };
      },
    });

  it("is on from Claude Code 2.1.325 and Codex 0.150.0", async () => {
    expect(funnel.providers.claude.capabilities.folderConfigMinVersion).toBe("2.1.325");
    // The version the refusal names as the one to have.
    expect(CLAUDE_FOLDER_MIN_VERSION).toBe("2.1.325");
    expect(funnel.providers.codex.capabilities.folderConfigMinVersion).toBe("0.150.0");
    expect(await on("claude", "2.1.325")).toBe(true);
    expect(await on("claude", "2.1.330 (Claude Code)")).toBe(true);
    expect(await on("claude", "2.2.0")).toBe(true);
    expect(await on("codex", "0.150.0")).toBe(true);
    expect(await on("codex", "0.166.0")).toBe(true);
  });

  it("is off on an older CLI, on one whose version can't be read, and on one that can't be asked", async () => {
    expect(await on("claude", "2.1.323")).toBe(false);
    expect(await on("claude", "2.0.999")).toBe(false);
    expect(await on("codex", "0.149.9")).toBe(false);
    expect(await on("claude", undefined)).toBe(false);
    expect(await on("codex", new Error("spawn codex ENOENT"))).toBe(false);
  });

  it("is off for a CLI that doesn't take the option, and on for one that needs no minimum version", async () => {
    const detect = async () => ({ version: "9.9.9" });
    expect(await leavesFolderOut({ capabilities: funnel.providers.agent.capabilities, detect })).toBe(false);
    expect(await leavesFolderOut({ capabilities: { folderConfig: ["ignore"] }, detect })).toBe(true);
    expect(await leavesFolderOut({ capabilities: { folderConfig: ["instructions"] }, detect })).toBe(false);
  });

  it("compares versions by their numbers", () => {
    expect(compareVersions("2.1.325", "2.1.325")).toBe(0);
    expect(compareVersions("2.1.40", "2.1.325")).toBeLessThan(0);
    expect(compareVersions("10.0.0", "9.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.150", "0.150.0")).toBe(0);
  });
});
