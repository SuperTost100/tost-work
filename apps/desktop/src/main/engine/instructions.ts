import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import source from "../../../resources/instructions.md?raw";
import { trashName } from "../../shared/i18n";
import type { Job, Project, Skill, Task } from "../../shared/model";
import type { TaskLog } from "../debugLog";
import { inside } from "../files";

const LANGUAGE_NAMES = { en: "English", it: "Italian" } as const;

/** The parts of resources/instructions.md, by heading, in the order the file has them. */
export const PARTS = [
  "Every task",
  "In a project",
  "In a quick edit",
  "Rules",
  "Files the user changed",
  "Files from a finished request",
  "Office files",
  "Office files on Windows",
  "The user's skills",
  "A job's run",
  "The folder's instructions",
] as const;
type Part = (typeof PARTS)[number];

/** Splits the file into its parts, leaving out the note at the top. Throws when a part is missing or unknown. */
export function readParts(text: string): Record<Part, string> {
  const body = text.replace(/^\s*<!--[\s\S]*?-->/, "");
  const parts: Partial<Record<string, string>> = {};
  for (const chunk of body.split(/^# /m).slice(1)) {
    const [heading = "", ...rest] = chunk.split("\n");
    parts[heading.trim()] = rest.join("\n").trim();
  }
  const found = Object.keys(parts);
  const unknown = found.filter((h) => !(PARTS as readonly string[]).includes(h));
  const missing = PARTS.filter((p) => !found.includes(p));
  if (unknown.length || missing.length)
    throw new Error(
      `instructions.md: unknown parts ${unknown.join(", ") || "none"}, missing ${missing.join(", ") || "none"}`,
    );
  return parts as Record<Part, string>;
}

/**
 * Fills a part's {{values}}. A line whose value is empty is left out, so an optional sentence goes with its value.
 * A name the part doesn't get throws, so a typo in the file shows in the tests rather than reaching the AI.
 */
export function fill(text: string, values: Record<string, string>): string {
  return text
    .split("\n")
    .filter((line) =>
      [...line.matchAll(/\{\{(\w+)\}\}/g)].every(([, name = ""]) => {
        if (!(name in values)) throw new Error(`instructions.md: no value for {{${name}}}`);
        return values[name]?.trim() !== "";
      }),
    )
    .map((line) => line.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? ""))
    .join("\n");
}

const PART = readParts(source);

/** The instruction files a project's folder can have for AI tools, in the order they're passed on. */
export const FOLDER_FILES = ["CLAUDE.md", "AGENTS.md"] as const;
/** The most of each file that's passed on: 32 KiB, Codex's own default for its project file. */
export const FOLDER_FILE_MAX = 32 * 1024;

/** One of the folder's instruction files, as it's passed on. `cut` when only its first FOLDER_FILE_MAX bytes are. */
export interface FolderFile {
  name: string;
  text: string;
  cut: boolean;
}

/**
 * A file's first `max` bytes as text, or null when there's no regular file there. Other errors are thrown. A link is
 * followed only to a file inside `folder`: one that leads out of it throws, so a folder that came from someone else
 * can't make Tost Work send a file from elsewhere on the computer to the AI. A link that leads nowhere counts as no
 * file.
 */
async function readStart(folder: string, path: string, max: number): Promise<{ text: string; cut: boolean } | null> {
  let file: Awaited<ReturnType<typeof open>>;
  try {
    const [root, real] = await Promise.all([realpath(folder), realpath(path)]);
    if (!inside(root, real)) throw new Error("It links to a file outside the project's folder");
    // Opened without waiting: a named pipe in place of the file would hold the run until something wrote to it. It's
    // turned down by the check below, as anything that isn't a regular file is.
    file = await open(real, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
  try {
    if (!(await file.stat()).isFile()) return null;
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const cut = size > max;
    let end = Math.min(size, max);
    // A cut in the middle of a character goes back to where that character starts.
    if (cut) while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end--;
    return { text: buffer.subarray(0, end).toString("utf8"), cut };
  } finally {
    await file.close();
  }
}

/** Whether a file's whole content is an import of another file (`@AGENTS.md`), which then says nothing of its own. */
function onlyPointsTo(text: string, other: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.length > 0 && lines.every((line) => line.replace(/^@(\.[\\/])?/, "").toLowerCase() === other.toLowerCase())
  );
}

/**
 * The CLAUDE.md and AGENTS.md in a project's folder, which people who use Claude Code or Codex there keep for them.
 * Only the folder itself is read, not the folders above or inside it, and a link is followed only to a file inside it. A file that's empty, says the same as the one
 * before it, or only imports the other one (a CLAUDE.md holding `@AGENTS.md`) is left out. Each is passed on up to
 * FOLDER_FILE_MAX bytes. A file that can't be read is left out and written to the task's log, and the task still runs.
 * shortcut: Claude Code also follows the imports (`@docs/style.md`) inside a CLAUDE.md; they're passed on as written,
 * not followed. Follow them if people rely on it.
 */
export async function folderInstructions(folder: string, log: TaskLog): Promise<FolderFile[]> {
  const read: FolderFile[] = [];
  for (const name of FOLDER_FILES) {
    const path = join(folder, name);
    const start = await readStart(folder, path, FOLDER_FILE_MAX).catch((err: unknown) => {
      log.write({ type: "instructions.unreadable", path, error: err instanceof Error ? err.message : String(err) });
      return null;
    });
    if (start?.text.trim()) read.push({ name, ...start });
  }
  const same = (a: string, b: string) => a.replace(/\r\n/g, "\n").trim() === b.replace(/\r\n/g, "\n").trim();
  const kept = read.filter(
    (file, i) =>
      !FOLDER_FILES.some((other) => other !== file.name && onlyPointsTo(file.text, other)) &&
      !read.slice(0, i).some((earlier) => same(earlier.text, file.text)),
  );
  if (read.length)
    log.write({
      type: "instructions.folder",
      files: read.map((f) => ({ name: f.name, cut: f.cut, passed: kept.includes(f) })),
    });
  return kept;
}

/** The folder's instruction files as the AI gets them, under the words from instructions.md. */
function folderPart(files: FolderFile[]): string {
  return [
    fill(PART["The folder's instructions"], {}),
    ...files.map((f) =>
      [
        `<file name="${f.name}">`,
        f.text.trim(),
        "</file>",
        ...(f.cut
          ? [
              `${f.name} is longer than ${FOLDER_FILE_MAX / 1024} KB, so only its first ${FOLDER_FILE_MAX / 1024} KB are above.`,
            ]
          : []),
      ].join("\n"),
    ),
  ].join("\n\n");
}

/**
 * The block every agent session starts with. It says who the agent works for, where it may work, the rules and the
 * Tost Work tools. The rules are enforced by Tost Work too; the text only explains them. The words are in
 * resources/instructions.md; this picks the parts that apply and fills them in. `platform` picks the words that
 * differ by system: where deleted files go, and on Windows how to pass text to officecli in PowerShell. `saved` are
 * files the task made that the user has saved since its last run: they're the user's again, so changing one asks.
 * `finished` are files the task made for a request it finished in an earlier run, which are the user's now too.
 * `folderFiles` are the project folder's CLAUDE.md and AGENTS.md (folderInstructions), which come after Tost Work's own
 * parts, below its rules, and before the project's instructions.
 */
export function instructionsFor(
  task: Task,
  project: Project | null,
  language: "en" | "it",
  documents: { skills: string } | null = null,
  user: { name: string; work: string; notes: string } = { name: "", work: "", notes: "" },
  skills: Pick<Skill, "title" | "description" | "folder">[] = [],
  job: Pick<Job, "title" | "output"> | null = null,
  platform: string = process.platform,
  saved: string[] = [],
  finished: string[] = [],
  folderFiles: FolderFile[] = [],
): string {
  const parts = [
    fill(PART["Every task"], { language: LANGUAGE_NAMES[language] }),
    project
      ? fill(PART["In a project"], { project: project.name, folder: task.workdir })
      : fill(PART["In a quick edit"], { folder: task.workdir }),
    fill(PART.Rules, { trash: trashName(platform) }),
  ];
  if (saved.length)
    parts.push(fill(PART["Files the user changed"], { files: saved.map((path) => `- ${path}`).join("\n") }));
  if (finished.length)
    parts.push(fill(PART["Files from a finished request"], { files: finished.map((path) => `- ${path}`).join("\n") }));
  if (documents) {
    const guide = (kind: string) => join(documents.skills, kind, "SKILL.md");
    parts.push(
      fill(PART["Office files"], {
        word: guide("word"),
        excel: guide("excel"),
        powerpoint: guide("powerpoint"),
        pdf: guide("pdf"),
        email: guide("email"),
        author: user.name.trim(),
      }),
    );
    if (platform === "win32") parts.push(fill(PART["Office files on Windows"], {}));
  }
  const about = [
    user.name.trim() && `Name: ${user.name.trim()}`,
    user.work.trim() && `What they do: ${user.work.trim()}`,
    user.notes.trim() && `What else to know:\n${user.notes.trim()}`,
  ].filter(Boolean);
  if (about.length) parts.push(`About the user, from their profile in Tost Work:\n${about.join("\n")}`);
  if (skills.length)
    parts.push(
      [
        fill(PART["The user's skills"], {}),
        ...skills.map(
          (s) => `- ${s.title}: ${s.description.trim() || "(no description)"} (${join(s.folder, "SKILL.md")})`,
        ),
      ].join("\n"),
    );
  if (job) {
    // The computer's own date, as the user reads it, not UTC's, which is a day off around midnight.
    const now = new Date();
    const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((n) => String(n).padStart(2, "0"))
      .join("-");
    parts.push(
      fill(PART["A job's run"], {
        job: job.title,
        today,
        output: job.output ? join(task.workdir, job.output) : "",
      }),
    );
  }
  if (folderFiles.length) parts.push(folderPart(folderFiles));
  if (project?.instructions.trim()) parts.push(`The project's instructions:\n${project.instructions.trim()}`);
  if (task.attachments.length)
    parts.push(`Files the user attached:\n${task.attachments.map((p) => `- ${p}`).join("\n")}`);
  return parts.join("\n\n");
}
