import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Skill, SkillDraft } from "../shared/model";

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
  constructor(
    private root: string,
    private trash: (path: string) => Promise<void>,
  ) {}

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
  async create(title: string, description = "", steps = ""): Promise<Skill> {
    await mkdir(this.root, { recursive: true });
    const id = await this.freeName(skillName(title));
    await mkdir(join(this.root, id));
    await this.write(id, { title, description, steps });
    return (await this.read(id)) as Skill;
  }

  /**
   * Saves the editor's fields. A title whose name changes renames the folder too, so it keeps matching the skill's
   * name; a skill in a numbered folder keeps its folder while its title's name stays the same. A failed write puts
   * the folder back.
   */
  async save(id: string, draft: SkillDraft): Promise<Skill> {
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
    };
  }

  /** Writes SKILL.md through a temporary file, so a crash can't leave half a skill. */
  private async write(id: string, draft: SkillDraft): Promise<void> {
    const body = `# ${draft.title.trim()}\n\n${draft.steps.trim()}`;
    const target = join(this.root, id, "SKILL.md");
    // Fields the editor doesn't show, such as a license, stay in the file.
    const { extra } = parseSkill(await readFile(target, "utf8").catch(() => ""));
    const temp = join(this.root, id, `.SKILL.md.${randomUUID()}`);
    await writeFile(temp, formatSkill(id, draft.description, body, extra), { flag: "wx" });
    await rename(temp, target);
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

/** A folder name and nothing more: no path separators, and not hidden, "." or "..". */
function valid(id: string): string {
  if (!id || id.startsWith(".") || /[\\/]/.test(id)) throw new Error("That isn't a skill");
  return id;
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
