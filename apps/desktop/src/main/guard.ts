import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { KeptCopy, Task } from "../shared/model";
import { taskFile, writablePath } from "./files";

/** What Tost Work does to files on the user's behalf, so the rules hold whatever the agent does. */
export interface Guard {
  /** Copies a file before it's replaced, so the user can restore it. */
  keep(task: Task, path: string, reason: KeptCopy["reason"]): Promise<KeptCopy>;
  /** Moves a file to the system Trash, never straight to erasure. */
  trash(task: Task, path: string): Promise<void>;
  /** Puts a kept copy back in place of the file. */
  restore(task: Task, kept: KeptCopy): Promise<void>;
}

/** The guard on disk: copies go to `keptDir/<task id>/`, deletions through the system Trash. */
export function fileGuard(keptDir: string, trashItem: (path: string) => Promise<void>, now = () => new Date()): Guard {
  return {
    async keep(task, path, reason) {
      const real = await taskFile(task, path);
      const folder = join(keptDir, task.id);
      await mkdir(folder, { recursive: true });
      const at = now();
      // The time orders the copies for people; the random part keeps two copies in one millisecond apart.
      const copy = join(folder, `${at.getTime()}-${randomUUID().slice(0, 8)}-${basename(real)}`);
      await copyFile(real, copy, constants.COPYFILE_EXCL);
      return { path, copy, at: at.toISOString(), reason };
    },
    async trash(task, path) {
      await trashItem(await taskFile(task, path));
    },
    async restore(task, kept) {
      // The file may be gone, removed by the user after the edit; restoring puts it back.
      await copyFile(kept.copy, await writablePath(task, kept.path));
    },
  };
}
