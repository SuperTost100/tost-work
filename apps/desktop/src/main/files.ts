import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative } from "node:path";
import type { Task } from "../shared/model";

/** The biggest file the interface may load for a preview. */
export const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;

// On Windows a path on another drive comes back absolute from relative().
const inside = (folder: string, path: string) => {
  const rel = relative(folder, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/**
 * Whether the interface may read a file for a task. Only files the task made, used or was given count, and a file the
 * task made must sit inside the task's folder. The path is resolved through symlinks first, so a link can't point out.
 */
export async function readablePath(task: Task, requested: string): Promise<string> {
  const listed =
    task.files.some((f) => f.path === requested && f.kind !== "delete") || task.attachments.includes(requested);
  if (!listed) throw new Error("That file isn't part of this task");
  const real = await realpath(requested);
  const isAttachment = task.attachments.includes(requested);
  if (!isAttachment && !inside(await realpath(task.workdir), real))
    throw new Error("That file is outside the task's folder");
  const info = await stat(real);
  if (!info.isFile()) throw new Error("That isn't a file");
  if (info.size > MAX_PREVIEW_BYTES) throw new Error("That file is too big to preview");
  return real;
}

export const describe = (path: string) => ({ name: basename(path), ext: extname(path).slice(1).toLowerCase() });
