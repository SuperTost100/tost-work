import { access, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";
import type { Task } from "../shared/model";

/** The biggest file the interface may load for a preview. */
export const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;

// A parent step is ".." alone or followed by a separator; a name like "..notes.md" is fine. On Windows a path on
// another drive comes back absolute from relative().
export const inside = (folder: string, path: string) => {
  const rel = relative(folder, path);
  return rel !== "" && !/^\.\.(?:[\\/]|$)/.test(rel) && !isAbsolute(rel);
};

/**
 * Whether the interface may read a file for a task. Only files the task made, used or was given count, and a file the
 * task made must sit inside the task's folder. The path is resolved through symlinks first, so a link can't point out.
 */
export async function readablePath(task: Task, requested: string, limitSize = true): Promise<string> {
  const listed =
    task.files.some((f) => f.path === requested && f.kind !== "delete") || task.attachments.includes(requested);
  if (!listed) throw new Error("That file isn't part of this task");
  const real = await realpath(requested);
  const isAttachment = task.attachments.includes(requested);
  if (!isAttachment && !inside(await realpath(task.workdir), real))
    throw new Error("That file is outside the task's folder");
  const info = await stat(real);
  if (!info.isFile()) throw new Error("That isn't a file");
  // The limit protects the preview's memory; opening or showing a big file in its own app is fine.
  if (limitSize && info.size > MAX_PREVIEW_BYTES) throw new Error("That file is too big to preview");
  return real;
}

export const describe = (path: string) => ({ name: basename(path), ext: extname(path).slice(1).toLowerCase() });

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** A name that isn't taken in the folder yet: "letter.docx", then "letter (2).docx", "letter (3).docx" and so on. */
export async function freeName(folder: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const candidate = join(folder, n === 1 ? name : `${stem} (${n})${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Too many files called ${name} in that folder`);
}
