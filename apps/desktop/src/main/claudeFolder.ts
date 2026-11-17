import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Capabilities, Installation } from "cli-funnel";
import { UserError } from "./userError";

/** Compares dotted version numbers as cli-funnel does: below 0 when `a` is older, 0 when equal, above 0 when newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The oldest Claude Code that takes `folderConfig: "ignore"`, as the message to a user with an older one says it. */
export const CLAUDE_FOLDER_MIN_VERSION = "2.1.325";

/** What leavesFolderOut needs from a cli-funnel provider. */
export interface FolderConfigSupport {
  capabilities: Pick<Capabilities, "folderConfig" | "folderConfigMinVersion">;
  detect(): Promise<Pick<Installation, "version">>;
}

/**
 * Whether a run on this AI can pass `folderConfig: "ignore"`, which keeps everything the task's folder carries for
 * the CLI out of the run: settings, hooks, permission rules, MCP servers, skills and instruction files. cli-funnel
 * takes it only from a CLI it knows keeps them out (Claude Code 2.1.325, Codex 0.150.0) and refuses the run on an
 * older CLI or one whose version it can't read. The same rule is applied here before the run, so such a CLI runs
 * without the option, as before it existed, and a Claude task there keeps the folder check (checkClaudeFolder).
 * shortcut: cli-funnel keeps the version it read for up to a minute, so in the minute after the CLI updates itself
 * this can see the new version while cli-funnel still has the old one, and that task fails with cli-funnel's message;
 * the next one runs. Read the version through cli-funnel's own cache if it ever offers one.
 */
export async function leavesFolderOut(provider: FolderConfigSupport): Promise<boolean> {
  if (!provider.capabilities.folderConfig?.includes("ignore")) return false;
  const min = provider.capabilities.folderConfigMinVersion;
  if (!min) return true;
  // A CLI that can't be started or asked has no version to go by, which counts as too old, as in cli-funnel.
  const { version } = await provider.detect().catch(() => ({ version: undefined }));
  return version !== undefined && compareVersions(version, min) >= 0;
}

/** Whether something is at `path`, a link that leads nowhere included. Any error other than a missing path is thrown. */
async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw err;
  }
}

/** A folder and every folder above it, up to the top of the disk. */
function upFrom(folder: string): string[] {
  const chain = [folder];
  for (let dir = dirname(folder); dir !== chain[chain.length - 1]; dir = dirname(dir)) chain.push(dir);
  return chain;
}

/** A path as given and with its links resolved, which may be the same. A path that isn't there stays as given. */
const bothNames = async (path: string) => [
  ...new Set([resolve(path), await realpath(path).catch(() => resolve(path))]),
];

/**
 * Every file Claude Code would read from the task's folder or a folder above it that could change Tost Work's
 * checks, in the order it finds them, each once. A Claude Code too old for `folderConfig: "ignore"`
 * (leavesFolderOut) reads these by itself in every run, and Tost Work can't tell it not to:
 * - .claude/settings.json in the task's folder, whose hooks run outside the sandbox when the task starts;
 * - .claude/settings.local.json in the task's folder or at the top of the git repository it's in, whose allow rules
 *   let commands and file changes through without asking Tost Work, and whose hooks run too. Claude Code doesn't read
 *   the one in the home folder, which is where a Claude Code user's own ~/.claude is, so that one doesn't count;
 * - .mcp.json in the task's folder or in any folder above it, the home folder included, whose servers start outside
 *   the sandbox without asking.
 * Every folder above is checked for .claude/settings.local.json rather than finding the repository's top, which is
 * simpler and covers it. A file reached through a link to the task's folder, and again by its real path, counts once.
 * shortcut: subagents, skills and commands in a .claude folder still load; they add instructions but can't skip a
 * check (a subagent's permissionMode still asks Tost Work), so they're left alone until one can.
 */
export async function claudeFolderSettings(workdir: string, home: string = homedir()): Promise<string[]> {
  const homes = new Set(await bothNames(home));
  const found = new Map<string, string>();
  const add = async (path: string) => {
    if (!(await present(path))) return;
    // The same file under another name for its folder is the same file: key it by its folder's real path.
    const key = join(await realpath(dirname(path)).catch(() => dirname(path)), basename(path));
    if (!found.has(key)) found.set(key, path);
  };
  for (const folder of await bothNames(workdir)) {
    for (const own of [join(".claude", "settings.json"), join(".claude", "settings.local.json"), ".mcp.json"])
      await add(join(folder, own));
    for (const dir of upFrom(folder).slice(1)) {
      if (!homes.has(dir)) await add(join(dir, ".claude", "settings.local.json"));
      await add(join(dir, ".mcp.json"));
    }
  }
  return [...found.values()];
}

/**
 * Throws a UserError naming every such file when a Claude task can't start in `workdir` (see claudeFolderSettings).
 * Only a run without `folderConfig: "ignore"` needs it. `version` is the installed Claude Code's, when it's known: the
 * message says it, so the user sees what they have and what they need.
 */
export async function checkClaudeFolder(workdir: string, home: string = homedir(), version?: string): Promise<void> {
  const paths = await claudeFolderSettings(workdir, home);
  if (paths.length === 0) return;
  const files = paths.join("\n");
  throw version
    ? new UserError("error.claudeFolderSettings", { files, min: CLAUDE_FOLDER_MIN_VERSION, version })
    : new UserError("error.claudeFolderSettingsNoVersion", { files, min: CLAUDE_FOLDER_MIN_VERSION });
}
