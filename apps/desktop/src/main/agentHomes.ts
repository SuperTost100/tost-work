import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Codex's settings in Tost Work's own Codex home: no AGENTS.md files from the folder or above it, and no skill catalog,
 * so neither the user's skills in ~/.agents/skills nor Codex's own bundled ones reach a task, and the bundled ones
 * stay off. Tost Work's instructions arrive as developer instructions and list the skills to use, which this leaves
 * alone. The agent could still read skill folders on disk with a command, as it could any file: rule 1 of those
 * instructions keeps it in the task's folder.
 *
 * ChatGPT's apps and plugins are off too: a task doesn't use them, they could reach the accounts the user connected
 * in ChatGPT, and their tools cost tokens on every request (#194). Turning off more, such as image generation, would
 * save a little more but change the start of every request, which then misses the cache that every other Codex user
 * keeps warm: measured, the first call cached 0 tokens instead of 12,160.
 *
 * Analytics stay off as Tost Work promises: app-server already keeps them off by default, and the setting says so
 * outright in case that default changes.
 */
export const CODEX_CONFIG = `# Written by Tost Work each time it starts. Changes here are replaced.
project_doc_max_bytes = 0

[skills]
include_instructions = false

[skills.bundled]
enabled = false

[features]
apps = false
plugins = false
remote_plugin = false
tool_suggest = false
skill_search = false

[analytics]
enabled = false
`;

/**
 * Claude Code's settings in Tost Work's own Claude home: no bundled skills, no memory, nothing synced from the user's
 * claude.ai account (skills, plugins, connectors), and no CLAUDE.md or AGENTS.md instruction files.
 */
export const CLAUDE_SETTINGS = {
  disableBundledSkills: true,
  autoMemoryEnabled: false,
  syncClaudeAiSkills: false,
  syncClaudeAiPlugins: false,
  disableClaudeAiConnectors: true,
  // Claude Code's own skill for making plugins, which is no use for office work.
  enabledPlugins: { "cc-plugin-plugin-authoring@builtin": false },
  pluginConfigs: { "cc-plugin-agents-md@builtin": { options: { instructionFiles: "managed-only" } } },
};

/**
 * The same for Claude Code through its environment, which also holds when a run loads no settings files. Its usage
 * telemetry and error reports stay off too. CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC would cover both, but it also
 * stops Claude Code from updating itself.
 */
export const CLAUDE_ENV = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
};

/**
 * Gives Codex and Claude Code their own homes under `root`, so a task sees only what Tost Work gives it: not the
 * user's own instructions, skills, hooks, plugins or MCP servers from ~/.codex and ~/.claude. Each CLI keeps its
 * sign-in in its home, so the user signs in once more inside Tost Work. Set before any CLI starts: every one inherits
 * the environment, including sign-in and the model list.
 */
export function giveAgentsOwnHomes(root: string, env: NodeJS.ProcessEnv = process.env): void {
  const codex = join(root, "codex");
  const claude = join(root, "claude");
  mkdirSync(codex, { recursive: true, mode: 0o700 });
  mkdirSync(claude, { recursive: true, mode: 0o700 });
  writeFileSync(join(codex, "config.toml"), CODEX_CONFIG);
  writeFileSync(join(claude, "settings.json"), `${JSON.stringify(CLAUDE_SETTINGS, null, 2)}\n`);
  Object.assign(env, { CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude, ...CLAUDE_ENV });
}
