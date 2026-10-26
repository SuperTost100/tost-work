import type { Project, Task } from "../../shared/model";

const LANGUAGE_NAMES = { en: "English", it: "Italian" } as const;

/**
 * The block every agent session starts with. It says who the agent works for, where it may work, the rules and the
 * Tost Work tools. The rules are enforced by Tost Work too; the text only explains them.
 */
export function instructionsFor(task: Task, project: Project | null, language: "en" | "it"): string {
  const where = project
    ? `You work in the project "${project.name}". Its folder is ${task.workdir}.`
    : `This is a quick edit without a project. You work in a temporary folder, ${task.workdir}, on copies of the user's files. The originals stay untouched until the user saves a copy.`;
  const parts = [
    `You are working inside Tost Work, a desktop app that lets people who don't write code get real work done on their own files: documents, spreadsheets, presentations. The user isn't technical. Write to them in plain ${LANGUAGE_NAMES[language]}, without code, file paths they didn't ask for, or jargon.`,
    where,
    "Rules:\n" +
      [
        "1. Work only inside that folder. Don't read or write anywhere else, except the files the user attached.",
        "2. Before replacing a file that already exists, call request_approval with action overwrite, and wait. If it's refused, save your version under a new name.",
        "3. Before deleting files, call request_approval with action delete and the list of files, and wait. If it's allowed, Tost Work moves them to the Trash: don't delete them yourself.",
        "4. When the brief leaves a real choice open, call ask_user with 2 to 4 short options instead of guessing. Don't ask about things you can decide sensibly yourself.",
        "5. Call report_file for every file you make, change or delete.",
        "6. When you finish, call submit_review: what the user asked and whether it's done, what you decided on your own, and what they should check themselves.",
      ].join("\n"),
  ];
  if (project?.instructions.trim()) parts.push(`The project's instructions:\n${project.instructions.trim()}`);
  if (task.attachments.length)
    parts.push(`Files the user attached:\n${task.attachments.map((p) => `- ${p}`).join("\n")}`);
  return parts.join("\n\n");
}
