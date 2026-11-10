import { join } from "node:path";
import source from "../../../resources/instructions.md?raw";
import { trashName } from "../../shared/i18n";
import type { Job, Project, Skill, Task } from "../../shared/model";

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

/**
 * The block every agent session starts with. It says who the agent works for, where it may work, the rules and the
 * Tost Work tools. The rules are enforced by Tost Work too; the text only explains them. The words are in
 * resources/instructions.md; this picks the parts that apply and fills them in. `platform` picks the words that
 * differ by system: where deleted files go, and on Windows how to pass text to officecli in PowerShell. `saved` are
 * files the task made that the user has saved since its last run: they're the user's again, so changing one asks.
 * `finished` are files the task made for a request it finished in an earlier run, which are the user's now too.
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
  if (project?.instructions.trim()) parts.push(`The project's instructions:\n${project.instructions.trim()}`);
  if (task.attachments.length)
    parts.push(`Files the user attached:\n${task.attachments.map((p) => `- ${p}`).join("\n")}`);
  return parts.join("\n\n");
}
