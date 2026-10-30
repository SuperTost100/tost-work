import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import type { Skill, SkillDraft, SkillVersion } from "../shared/model";
import type { SkillVersions } from "./skillVersions";

/** The most an imported skill may hold, so a folder or zip picked by mistake can't fill the disk. */
export const IMPORT_LIMITS = { files: 500, bytes: 50 * 1024 * 1024 };

/** What to show for a built-in guide, by its folder name, such as in the user's language; null shows the file's text. */
export type GuideText = (name: string) => { title: string; description: string; steps?: string } | null;

/** A YAML scalar as written on one line: double quotes as JSON, single quotes with '' for a quote, else as it is. */
function scalar(value: string): string {
  if (/^".*"$/.test(value)) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

/**
 * The parts of a SKILL.md: the frontmatter's name and description, the other frontmatter lines as they are (such as
 * `license` or `allowed-tools`, so saving keeps them), and the body. Only the plain `key: value` form and YAML's folded
 * (`>`) and literal (`|`) blocks are read, which covers the files agents and people write.
 */
export function parseSkill(text: string): { name: string; description: string; body: string; extra: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { name: "", description: "", body: text, extra: "" };
  const fields: Record<string, string> = {};
  const extra: string[] = [];
  const lines = (match[1] ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    const key = field?.[1] ?? "";
    // A line of another field, with whatever is indented under it, goes back into the file unchanged.
    if (key !== "name" && key !== "description") {
      extra.push(line);
      continue;
    }
    let value = (field?.[2] ?? "").trim();
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block: string[] = [];
      while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1] ?? "")) block.push((lines[++i] ?? "").trim());
      value = block.join(value.startsWith(">") ? " " : "\n").trim();
    } else value = scalar(value);
    fields[key] = value;
  }
  return {
    name: fields.name ?? "",
    description: fields.description ?? "",
    body: (match[2] ?? "").replace(/^\n+/, ""),
    extra: extra.join("\n").trim(),
  };
}

/** A SKILL.md with the standard frontmatter. The description is quoted, so a colon in it stays text. */
export function formatSkill(name: string, description: string, body: string, extra = ""): string {
  const quoted = JSON.stringify(description.replace(/\s+/g, " ").trim());
  const more = extra.trim() ? `${extra.trim()}\n` : "";
  return `---\nname: ${name}\ndescription: ${quoted}\n${more}---\n\n${body.trim()}\n`;
}

/**
 * The folder and `name` for a title: lowercase letters, digits and hyphens, at most 64 characters, as the Agent Skills
 * format asks, so the folder can be copied to Claude or Codex as it is.
 */
export function skillName(title: string): string {
  const name = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return name || "skill";
}

/** The title people see: the body's first heading, else the name with its hyphens as spaces. */
function titleOf(name: string, body: string): string {
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  if (heading) return heading;
  const words = name.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The body without its first heading, which the editor shows as the title. */
function stepsOf(body: string): string {
  return body.replace(/^#\s+.+\r?\n?/m, "").trim();
}

/**
 * The user's skills: standard SKILL.md folders in Documents/Tost Work/Skills, so people can see, back up and copy them.
 * A folder without a SKILL.md isn't a skill and is left alone.
 */
export class SkillFolder {
  /** Changes run one at a time, so two saves can't both read the versions and keep only one, or take one free name. */
  private queue: Promise<unknown> = Promise.resolve();
  private builtInRoot: string | null;
  private versions: SkillVersions | null;
  private now: () => string;

  constructor(
    private root: string,
    private trash: (path: string) => Promise<void>,
    options: {
      /** The guides Tost Work comes with, one SKILL.md folder each. */
      builtIns?: string | null;
      versions?: SkillVersions | null;
      now?: () => string;
    } = {},
  ) {
    this.builtInRoot = options.builtIns ?? null;
    this.versions = options.versions ?? null;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * The guides Tost Work comes with, read-only, with ids that start with @ so they can't be taken for a folder here.
   * `text` can give the title, description and steps to show; the guide's name and files stay as they are.
   */
  async builtIns(text?: GuideText): Promise<Skill[]> {
    const root = this.builtInRoot;
    if (!root) return [];
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const guides = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          const file = await readFile(join(root, e.name, "SKILL.md"), "utf8").catch(() => null);
          if (file === null) return null;
          const { name, description, body } = parseSkill(file);
          const shown = text?.(e.name);
          const skill: Skill = {
            id: `@${e.name}`,
            name: name || e.name,
            title: shown?.title ?? titleOf(name || e.name, body),
            description: shown?.description ?? description,
            steps: shown?.steps ?? stepsOf(body),
            files: [],
            folder: join(root, e.name),
            updatedAt: "",
            builtIn: true,
          };
          return skill;
        }),
    );
    return guides.filter((s): s is Skill => s !== null).sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * A copy of a built-in guide among the user's skills, to change as they like. `titled` names the copy, such as
   * "Word documents (copy)", so the list never shows two skills with the same name. The copy is named after the
   * title `text` shows, so it matches what the user clicked, and gets the steps `text` shows, so it reads in the same
   * language; its description stays the guide's own, which the agent reads.
   */
  duplicate(
    id: string,
    titled: (title: string) => string = (title) => `${title} (copy)`,
    text?: GuideText,
  ): Promise<Skill> {
    return this.serial(() => this.duplicateNow(id, titled, text));
  }

  private async duplicateNow(id: string, titled: (title: string) => string, text?: GuideText): Promise<Skill> {
    const guide = (await this.builtIns(text)).find((s) => s.id === id);
    if (!guide) throw new Error("That isn't one of Tost Work's guides");
    await mkdir(this.root, { recursive: true });
    const title = titled(guide.title);
    const copy = await this.freeName(skillName(title));
    await this.copyFolder(guide.folder, join(this.root, copy));
    const { description, extra } = parseSkill(await readFile(join(this.root, copy, "SKILL.md"), "utf8"));
    await this.writeText(copy, formatSkill(copy, description, `# ${title}\n\n${guide.steps}`, extra));
    await this.versions?.setAside(copy, this.now());
    await this.keep(copy);
    return (await this.read(copy)) as Skill;
  }

  /**
   * Brings in a skill made elsewhere: a folder with a SKILL.md, or a .zip of one. It gets a folder of its own here,
   * numbered when the name is taken, and its `name` follows that folder. Links and hidden files stay behind.
   */
  import(source: string): Promise<Skill> {
    return this.serial(() => this.importNow(source));
  }

  private async importNow(source: string): Promise<Skill> {
    await mkdir(this.root, { recursive: true });
    const staging = join(this.root, `.import-${randomUUID()}`);
    try {
      if (/\.zip$/i.test(source)) await unzipSkill(source, staging);
      else {
        const info = await lstat(join(source, "SKILL.md")).catch(() => null);
        if (!info?.isFile()) throw new Error("That folder has no SKILL.md");
        await this.copyFolder(source, staging);
      }
      const { name } = parseSkill(await readFile(join(staging, "SKILL.md"), "utf8"));
      const id = await this.freeName(skillName(name || basename(source).replace(/\.zip$/i, "")));
      await rename(staging, join(this.root, id));
      // Only once older history is set aside may a failure drop the version file: before that, it's the old skill's.
      let setAside = false;
      try {
        await this.rewriteName(id);
        await this.versions?.setAside(id, this.now());
        setAside = true;
        await this.keep(id);
        const skill = await this.read(id);
        if (!skill) throw new Error("That skill couldn't be read after importing it");
        return skill;
      } catch (err) {
        // A half-done import goes, with the version it kept; history set aside from an older skill stays.
        await rm(join(this.root, id), { recursive: true, force: true });
        if (setAside) await this.versions?.forget(id);
        throw err;
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /** Newest first. */
  async history(id: string): Promise<SkillVersion[]> {
    return this.versions ? this.versions.list(await this.checked(id)) : [];
  }

  /** Puts an earlier version back. It becomes the current version again; the one it replaced stays in the list. */
  restore(id: string, n: number): Promise<Skill> {
    return this.serial(() => this.restoreNow(id, n));
  }

  private async restoreNow(id: string, n: number): Promise<Skill> {
    const current = await this.checked(id);
    const text = await this.versions?.text(current, n);
    if (text == null) throw new Error("That version isn't kept any more");
    const { description, body, extra } = parseSkill(text);
    await this.writeText(current, formatSkill(current, description, body, extra));
    await this.keep(current);
    return (await this.read(current)) as Skill;
  }

  async list(): Promise<Skill[]> {
    await mkdir(this.root, { recursive: true });
    const entries = await readdir(this.root, { withFileTypes: true });
    const skills = await Promise.all(
      entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => this.read(e.name)),
    );
    return skills.filter((s): s is Skill => s !== null).sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Null when no folder has that name, as after a rename elsewhere. */
  async get(id: string): Promise<Skill | null> {
    const exists = await lstat(join(this.root, valid(id))).catch(() => null);
    return exists ? this.read(await this.checked(id)) : null;
  }

  /** Makes a skill with a starting text, in a folder named after the title (with a number if it's taken). */
  create(title: string, description = "", steps = ""): Promise<Skill> {
    return this.serial(() => this.createNow(title, description, steps));
  }

  private async createNow(title: string, description: string, steps: string): Promise<Skill> {
    await mkdir(this.root, { recursive: true });
    const id = await this.freeName(skillName(title));
    await mkdir(join(this.root, id));
    await this.write(id, { title, description, steps });
    await this.versions?.setAside(id, this.now());
    // An empty skill is a blank page, not a version: the first save of what the user writes is version 1.
    if (description.trim() || steps.trim()) await this.keep(id);
    return (await this.read(id)) as Skill;
  }

  /**
   * Saves the editor's fields. A title whose name changes renames the folder too, so it keeps matching the skill's
   * name; a skill in a numbered folder keeps its folder while its title's name stays the same. A failed write puts
   * the folder back.
   */
  save(id: string, draft: SkillDraft, note = ""): Promise<Skill> {
    return this.serial(() => this.saveNow(id, draft, note));
  }

  private async saveNow(id: string, draft: SkillDraft, note: string): Promise<Skill> {
    const current = await this.checked(id);
    const before = await this.read(current);
    if (!before) throw new Error("That skill isn't there any more");
    let target = current;
    const wanted = skillName(draft.title);
    if (wanted !== skillName(before.title) && wanted !== current) {
      target = await this.freeName(wanted);
      await rename(join(this.root, current), join(this.root, target));
    }
    try {
      await this.write(target, draft);
    } catch (err) {
      if (target !== current) await rename(join(this.root, target), join(this.root, current));
      throw err;
    }
    if (target !== current) {
      // A deleted skill's versions may still be under the new name. They aren't this skill's, and a skill without
      // versions of its own, such as a blank new one, would otherwise take them over.
      await this.versions?.setAside(target, this.now());
      await this.versions?.rename(current, target, (text) => {
        const { description, body, extra } = parseSkill(text);
        return formatSkill(target, description, body, extra);
      });
    }
    await this.keep(target, { note });
    return (await this.read(target)) as Skill;
  }

  /** Copies files the skill brings, such as a template, into its folder, with a new name if one is taken. */
  async addFiles(id: string, paths: string[]): Promise<Skill> {
    const checked = await this.checked(id);
    const folder = join(this.root, checked);
    for (const source of paths) {
      const name = await freeFile(folder, basename(source));
      await copyFile(source, join(folder, name));
    }
    return (await this.read(checked)) as Skill;
  }

  /** Moves the skill's folder to the system Trash, so a mistake can be undone there. */
  async remove(id: string): Promise<void> {
    await this.trash(join(this.root, await this.checked(id)));
  }

  /**
   * The skill as a .zip with its folder as the top level, so importing it gives the same skill back. Links and hidden
   * files stay out, as in an import, and the same size limits apply so the zip can be imported again.
   */
  async zip(id: string): Promise<{ name: string; data: Buffer }> {
    const name = await this.checked(id);
    const zip = new JSZip();
    let files = 0;
    let bytes = 0;
    const walk = async (dir: string, inZip: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        if (e.isDirectory()) await walk(join(dir, e.name), `${inZip}/${e.name}`);
        else if (e.isFile()) {
          const path = join(dir, e.name);
          // Sized before it's read, so a huge file stops the export without filling memory first.
          const tooBig = (more: number) => files + 1 > IMPORT_LIMITS.files || bytes + more > IMPORT_LIMITS.bytes;
          if (tooBig((await stat(path)).size)) throw new Error("That skill is too big to export");
          const data = await readFile(path);
          // It may have grown since.
          if (tooBig(data.length)) throw new Error("That skill is too big to export");
          files++;
          bytes += data.length;
          zip.file(`${inZip}/${e.name}`, data);
        }
      }
    };
    await walk(join(this.root, name), name);
    // Its SKILL.md may have gone since the list was read: a zip without one wouldn't import, so it fails here instead.
    if (!zip.file(`${name}/SKILL.md`)) throw new Error("That skill has no SKILL.md to export");
    return { name, data: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) };
  }

  async folderOf(id: string): Promise<string> {
    return join(this.root, await this.checked(id));
  }

  private async read(id: string): Promise<Skill | null> {
    const folder = join(this.root, id);
    // A SKILL.md that is a link isn't read: saving would replace the link and leave the file it points to unchanged.
    const info = await lstat(join(folder, "SKILL.md")).catch(() => null);
    if (!info?.isFile()) return null;
    const text = await readFile(join(folder, "SKILL.md"), "utf8").catch(() => null);
    if (text === null) return null;
    const { name, description, body } = parseSkill(text);
    const files = (await readdir(folder, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name !== "SKILL.md" && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
    const { mtime } = await stat(join(folder, "SKILL.md"));
    return {
      id,
      name: name || id,
      title: titleOf(name || id, body),
      description,
      steps: stepsOf(body),
      files,
      folder,
      updatedAt: mtime.toISOString(),
      version: (await this.versions?.current(id, text)) ?? 0,
    };
  }

  /** Keeps the SKILL.md as it is now as the skill's next version. */
  private async keep(id: string, more: { note?: string } = {}): Promise<void> {
    if (!this.versions) return;
    const text = await readFile(join(this.root, id, "SKILL.md"), "utf8");
    await this.versions.record(id, text, this.now(), more);
  }

  /** Sets the SKILL.md's `name` to its folder's, as the format asks, keeping the rest of the file. */
  private async rewriteName(id: string): Promise<void> {
    const { description, body, extra } = parseSkill(await readFile(join(this.root, id, "SKILL.md"), "utf8"));
    await this.writeText(id, formatSkill(id, description, body, extra));
  }

  /** Copies a skill's folder: its files and subfolders, without links or hidden files, within the import limits. */
  private async copyFolder(from: string, to: string): Promise<void> {
    let files = 0;
    let bytes = 0;
    const walk = async (dir: string, out: string) => {
      await mkdir(out, { recursive: true });
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        if (e.isDirectory()) await walk(join(dir, e.name), join(out, e.name));
        else if (e.isFile()) {
          files++;
          bytes += (await stat(join(dir, e.name))).size;
          if (files > IMPORT_LIMITS.files || bytes > IMPORT_LIMITS.bytes)
            throw new Error("That skill is too big to import");
          await copyFile(join(dir, e.name), join(out, e.name));
        }
      }
    };
    await walk(from, to);
  }

  private async write(id: string, draft: SkillDraft): Promise<void> {
    const body = `# ${draft.title.trim()}\n\n${draft.steps.trim()}`;
    // Fields the editor doesn't show, such as a license, stay in the file.
    const { extra } = parseSkill(await readFile(join(this.root, id, "SKILL.md"), "utf8").catch(() => ""));
    await this.writeText(id, formatSkill(id, draft.description, body, extra));
  }

  /** Writes SKILL.md through a temporary file, so a crash can't leave half a skill. */
  private async writeText(id: string, text: string): Promise<void> {
    const temp = join(this.root, id, `.SKILL.md.${randomUUID()}`);
    await writeFile(temp, text, { flag: "wx" });
    await rename(temp, join(this.root, id, "SKILL.md"));
  }

  private async freeName(name: string): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? name : `${name.slice(0, 60)}-${n}`;
      const taken = await stat(join(this.root, candidate)).then(
        () => true,
        () => false,
      );
      if (!taken) return candidate;
    }
  }

  /**
   * A skill id is the name of a real folder in the Skills folder. Anything that could point elsewhere is refused,
   * including a link, which could lead outside it.
   */
  private async checked(id: string): Promise<string> {
    const info = await lstat(join(this.root, valid(id))).catch(() => null);
    if (!info?.isDirectory()) throw new Error("That isn't a skill");
    return id;
  }
}

/** A folder name and nothing more: no path separators, not hidden, "." or "..", and not a built-in guide's @ id. */
function valid(id: string): string {
  if (!id || id.startsWith(".") || id.startsWith("@") || /[\\/]/.test(id)) throw new Error("That isn't a skill");
  return id;
}

/**
 * Unpacks the skill in a .zip into `to`. The SKILL.md nearest the top marks the skill's folder; the zip's other
 * entries outside it, links, hidden files and macOS's __MACOSX folder stay out. A path that would leave the folder
 * is refused.
 */
async function unzipSkill(source: string, to: string): Promise<void> {
  const zip = await JSZip.loadAsync(await readFile(source));
  const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.[^/]*)(\/|$)/.test(f.name));
  const marker = entries
    .filter((f) => /(^|\/)SKILL\.md$/.test(f.name))
    .sort((a, b) => a.name.split("/").length - b.name.split("/").length)[0];
  if (!marker) throw new Error("That zip has no SKILL.md");
  const prefix = marker.name.slice(0, -"SKILL.md".length);
  const inside = entries.filter((f) => f.name.startsWith(prefix));
  if (inside.length > IMPORT_LIMITS.files) throw new Error("That skill is too big to import");
  let bytes = 0;
  for (const f of inside) {
    // Unix permissions say when an entry is a link, which would point outside the folder.
    if (f.unixPermissions != null && (Number(f.unixPermissions) & 0o170000) === 0o120000) continue;
    const rel = normalize(f.name.slice(prefix.length));
    // JSZip cleans a name that climbs out (../), keeping the original: a zip made that way is refused, not repaired.
    const climbed = f.unsafeOriginalName !== undefined && f.unsafeOriginalName !== f.name;
    if (climbed || rel.startsWith("..") || rel.startsWith(sep) || /^[a-zA-Z]:/.test(rel))
      throw new Error("That zip has a file outside its folder");
    await mkdir(dirname(join(to, rel)), { recursive: true });
    // Streamed and counted as it unpacks, so one huge entry stops at the limit instead of filling memory.
    // A half-written file stays in the staging folder, which import removes.
    const counted = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        done(bytes > IMPORT_LIMITS.bytes ? new Error("That skill is too big to import") : null, chunk);
      },
    });
    await pipeline(f.nodeStream("nodebuffer"), counted, createWriteStream(join(to, rel), { flags: "wx" }));
  }
}

async function freeFile(folder: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    if (candidate === "SKILL.md") continue;
    const taken = await stat(join(folder, candidate)).then(
      () => true,
      () => false,
    );
    if (!taken) return candidate;
  }
}
