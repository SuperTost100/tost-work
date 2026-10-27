import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillVersion } from "../shared/model";

/** A version as kept: what the list shows, and the whole SKILL.md to put back. */
interface Kept extends SkillVersion {
  text: string;
}

/** The most versions kept per skill; the oldest go first. */
export const MAX_VERSIONS = 50;

/**
 * Earlier versions of each skill, in Tost Work's own data rather than the skill's folder, so the folder stays a plain
 * SKILL.md folder to copy into Claude or Codex. One file per skill, named after its folder.
 */
export class SkillVersions {
  constructor(private root: string) {}

  private file(id: string): string {
    return join(this.root, `${id}.json`);
  }

  private async read(id: string): Promise<Kept[]> {
    const text = await readFile(this.file(id), "utf8").catch(() => null);
    if (!text) return [];
    try {
      const list = JSON.parse(text) as unknown;
      return Array.isArray(list) ? (list as Kept[]) : [];
    } catch {
      return [];
    }
  }

  /** Newest first, without the text. */
  async list(id: string): Promise<SkillVersion[]> {
    return (await this.read(id)).map(({ text: _text, ...v }) => v).reverse();
  }

  async count(id: string): Promise<number> {
    const list = await this.read(id);
    return list.at(-1)?.n ?? 0;
  }

  async text(id: string, n: number): Promise<string | null> {
    return (await this.read(id)).find((v) => v.n === n)?.text ?? null;
  }

  /** Keeps the SKILL.md as just saved, as the next version. Saving the same text again adds nothing. */
  async record(id: string, text: string, at: string, more: { note?: string; restoredFrom?: number } = {}) {
    const list = await this.read(id);
    const last = list.at(-1);
    if (last?.text === text && !more.restoredFrom) return;
    const note = more.note?.trim();
    const next: Kept = {
      n: (last?.n ?? 0) + 1,
      at,
      ...(note ? { note } : {}),
      ...(more.restoredFrom ? { restoredFrom: more.restoredFrom } : {}),
      text,
    };
    await this.write(id, [...list, next].slice(-MAX_VERSIONS));
  }

  /** The versions follow a skill whose folder was renamed. */
  async rename(from: string, to: string): Promise<void> {
    if (from === to) return;
    await rename(this.file(from), this.file(to)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
  }

  /** Drops the versions under a folder name, for an import that didn't finish. */
  async forget(id: string): Promise<void> {
    await rm(this.file(id), { force: true });
  }

  /**
   * Sets aside the versions under a folder name, so a new skill made later with the same name starts its own.
   * They stay on disk, in case the old skill comes back from the Trash.
   */
  async setAside(id: string, at: string): Promise<void> {
    await rename(this.file(id), join(this.root, `${id}.${at.replace(/[:.]/g, "-")}.old`)).catch(
      (err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      },
    );
  }

  private async write(id: string, list: Kept[]): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const temp = join(this.root, `.${id}.${randomUUID()}`);
    await writeFile(temp, JSON.stringify(list), { flag: "wx" });
    await rename(temp, this.file(id));
  }
}
