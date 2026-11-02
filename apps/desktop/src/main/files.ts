import { constants } from "node:fs";
import { copyFile, lstat, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import type { Task } from "../shared/model";
import { UserError } from "./userError";

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
  if (!listed) throw new UserError("error.fileNotInTask");
  const real = await realpath(requested);
  const isAttachment = task.attachments.includes(requested);
  if (!isAttachment && !inside(await realpath(task.workdir), real)) throw new UserError("error.fileOutside");
  const info = await stat(real);
  if (!info.isFile()) throw new UserError("error.notFile");
  // The limit protects the preview's memory; opening or showing a big file in its own app is fine.
  if (limitSize && info.size > MAX_PREVIEW_BYTES) throw new UserError("error.fileTooBig");
  return real;
}

/** The files a task made that still exist, resolved through symlinks, each checked to sit inside the task's folder. */
export async function savablePaths(task: Task): Promise<string[]> {
  const folder = await realpath(task.workdir);
  const made = [...new Set(task.files.filter((f) => f.role === "made" && f.kind !== "delete").map((f) => f.path))];
  const real: string[] = [];
  for (const path of made) {
    // A file removed outside the app has nothing to save; the rest still are.
    const resolved = await realpath(path).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (resolved === null) continue;
    if (!inside(folder, resolved)) throw new UserError("error.fileOutside");
    real.push(resolved);
  }
  return real;
}

/** A file inside the task's folder, resolved through symlinks. Throws for anything outside, so a link can't point out. */
export async function taskFile(task: Task, path: string): Promise<string> {
  const real = await realpath(path);
  if (!inside(await realpath(task.workdir), real)) throw new UserError("error.fileOutside");
  return real;
}

/**
 * Where to write a file of the task that may no longer exist, such as one the user removed before restoring it. An
 * existing file goes through taskFile; a missing one must sit in a folder inside the task's folder, and a broken link
 * left at its name is refused, since writing through it would land wherever it points.
 */
export async function writablePath(task: Task, path: string): Promise<string> {
  try {
    return await taskFile(task, path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const link = await lstat(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (link) throw new UserError("error.fileBrokenLink");
  const folder = await realpath(task.workdir);
  const parent = await realpath(dirname(path));
  if (parent !== folder && !inside(folder, parent)) throw new UserError("error.fileOutside");
  return join(parent, basename(path));
}

export const describe = (path: string) => ({ name: basename(path), ext: extname(path).slice(1).toLowerCase() });

// lstat, not access: a dangling link still takes the name, and an exclusive copy onto it would fail.
const exists = (path: string) =>
  lstat(path).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return false;
      throw err;
    },
  );

/** A name that isn't taken in the folder yet: "letter.docx", then "letter (2).docx", "letter (3).docx" and so on. */
export async function freeName(folder: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const candidate = join(folder, n === 1 ? name : `${stem} (${n})${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new UserError("error.tooManyFiles", { name });
}

/** Copies the user's files into a quick edit's folder, so the agent edits copies and the originals stay untouched. */
export async function copyInto(paths: string[], folder: string): Promise<string[]> {
  const copies: string[] = [];
  try {
    for (const path of paths) {
      const info = await stat(path);
      if (!info.isFile()) throw new UserError("error.notAFile", { name: basename(path) });
      const target = await freeName(folder, basename(path));
      await copyFile(path, target, constants.COPYFILE_EXCL);
      copies.push(target);
    }
  } catch (err) {
    // A batch that fails part way leaves nothing behind, so a retry doesn't add numbered copies to the folder.
    await removeCopies(copies);
    throw err;
  }
  return copies;
}

/** Removes copies made for a message that was then refused. */
export const removeCopies = (copies: string[]) => Promise.all(copies.map((copy) => rm(copy, { force: true })));

/** What to do when a file with the same name is already in the folder the user picked. */
export type Conflict = "replace" | "keep-both" | "cancel";

/**
 * Copies a task's files into a folder the user picked. A file already there is never overwritten without asking:
 * "replace" moves the old one to the Trash first, "keep-both" saves under a free name, and "cancel" stops.
 * Returns the paths written, including those written before a cancel.
 */
export async function saveCopies(
  sources: string[],
  folder: string,
  ask: (name: string) => Promise<Conflict>,
  trash: (path: string) => Promise<void>,
): Promise<{ saved: string[]; cancelled: boolean }> {
  const saved: string[] = [];
  const destination = await realpath(folder);
  for (const source of sources) {
    let target = join(destination, basename(source));
    // The user picked the folder the file is already in: it's saved, and Replace would trash the only copy.
    if (target === source) {
      saved.push(target);
      continue;
    }
    if (await exists(target)) {
      const choice = await ask(basename(source));
      if (choice === "cancel") return { saved, cancelled: true };
      if (choice === "replace") await trash(target);
      else target = await freeName(destination, basename(source));
    }
    await copyFile(source, target, constants.COPYFILE_EXCL);
    saved.push(target);
  }
  return { saved, cancelled: false };
}
