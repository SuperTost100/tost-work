import { constants } from "node:fs";
import { access, copyFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";
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

/** The files a task made that still exist, resolved through symlinks, each checked to sit inside the task's folder. */
export async function savablePaths(task: Task): Promise<string[]> {
  const folder = await realpath(task.workdir);
  const made = [...new Set(task.files.filter((f) => f.role === "made" && f.kind !== "delete").map((f) => f.path))];
  const real: string[] = [];
  for (const path of made) {
    const resolved = await realpath(path);
    if (!inside(folder, resolved)) throw new Error("That file is outside the task's folder");
    real.push(resolved);
  }
  return real;
}

/** A file inside the task's folder, resolved through symlinks. Throws for anything outside, so a link can't point out. */
export async function taskFile(task: Task, path: string): Promise<string> {
  const real = await realpath(path);
  if (!inside(await realpath(task.workdir), real)) throw new Error("That file is outside the task's folder");
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

/** Copies the user's files into a quick edit's folder, so the agent edits copies and the originals stay untouched. */
export async function copyInto(paths: string[], folder: string): Promise<string[]> {
  const copies: string[] = [];
  for (const path of paths) {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${basename(path)} isn't a file`);
    const target = await freeName(folder, basename(path));
    await copyFile(path, target, constants.COPYFILE_EXCL);
    copies.push(target);
  }
  return copies;
}

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
  for (const source of sources) {
    let target = join(folder, basename(source));
    if (await exists(target)) {
      const choice = await ask(basename(source));
      if (choice === "cancel") return { saved, cancelled: true };
      if (choice === "replace") await trash(target);
      else target = await freeName(folder, basename(source));
    }
    await copyFile(source, target, constants.COPYFILE_EXCL);
    saved.push(target);
  }
  return { saved, cancelled: false };
}
