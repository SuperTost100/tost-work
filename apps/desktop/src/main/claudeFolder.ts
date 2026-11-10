import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { UserError } from "./userError";

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
 * The first file Claude Code would read from the task's folder or a folder above it that could change Tost Work's
 * checks, or null. Claude Code reads these by itself in every run, and Tost Work can't tell it not to (cli-funnel
 * passes `--setting-sources` only to runs without tools):
 * - .claude/settings.json in the task's folder, whose hooks run outside the sandbox when the task starts;
 * - .claude/settings.local.json in the task's folder or at the top of the git repository it's in, whose allow rules
 *   let commands and file changes through without asking Tost Work, and whose hooks run too. Claude Code doesn't read
 *   the one in the home folder, which is where a Claude Code user's own ~/.claude is, so that one doesn't count;
 * - .mcp.json in the task's folder or in any folder above it, the home folder included, whose servers start outside
 *   the sandbox without asking.
 * Every folder above is checked for .claude/settings.local.json rather than finding the repository's top, which is
 * simpler and covers it.
 * shortcut: subagents, skills and commands in a .claude folder still load; they add instructions but can't skip a
 * check (a subagent's permissionMode still asks Tost Work), so they're left alone until one can.
 */
export async function claudeFolderSettings(workdir: string, home: string = homedir()): Promise<string | null> {
  const homes = new Set(await bothNames(home));
  for (const folder of await bothNames(workdir)) {
    for (const own of [join(".claude", "settings.json"), join(".claude", "settings.local.json"), ".mcp.json"])
      if (await present(join(folder, own))) return join(folder, own);
    for (const dir of upFrom(folder).slice(1)) {
      const local = join(dir, ".claude", "settings.local.json");
      if (!homes.has(dir) && (await present(local))) return local;
      if (await present(join(dir, ".mcp.json"))) return join(dir, ".mcp.json");
    }
  }
  return null;
}

/** Throws a UserError naming the file when a Claude task can't start in `workdir` (see claudeFolderSettings). */
export async function checkClaudeFolder(workdir: string, home: string = homedir()): Promise<void> {
  const path = await claudeFolderSettings(workdir, home);
  if (path) throw new UserError("error.claudeFolderSettings", { path });
}
