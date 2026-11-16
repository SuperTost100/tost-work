/** @vitest-environment node */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Project, Task } from "../../shared/model";
import {
  FOLDER_FILE_MAX,
  type FolderFile,
  fill,
  folderInstructions,
  instructionsFor,
  PARTS,
  readParts,
} from "./instructions";

const task = { workdir: "/Users/giulia/Proposte", attachments: [] } as unknown as Task;
const project = { name: "Proposte", instructions: "Use our template.\n" } as Project;

describe("instructionsFor", () => {
  it("names the folder, the language, the rules and the project's instructions", () => {
    const text = instructionsFor(task, project, "it");
    expect(text).toContain("/Users/giulia/Proposte");
    expect(text).toContain("the language the user writes in");
    expect(text).toContain("use Italian.");
    // A request to think or take stock gets an answer in the chat and an offer of a file; questions go through the card.
    expect(text).toContain("answer in your message");
    expect(text).toContain("Make the file only if they say yes");
    // A file named as something to read isn't a request for a new one.
    expect(text).toContain("is material for the answer, not a request for a new file");
    // An answer asked for in a file, or a named output file, is a file request, and that comes first.
    expect(text).toContain("an answer they want in a file");
    expect(text).toContain("This comes before the rule below.");
    expect(text).toContain("Questions to the user go through ask_user, never in a message.");
    expect(text).toContain("simple Markdown");
    expect(text).toContain("request_approval with action overwrite");
    expect(text).toContain("The project's instructions:\nUse our template.");
    // Business users get Word, Excel and PowerPoint files, not plain text.
    expect(text).toContain("documents as Word (.docx)");
    expect(text).toContain("Never deliver .txt or .md files");
    // Questions come in rounds, files go where the folder keeps their kind, and tool noise stays out.
    expect(text).toContain("every question you need answered at that point, up to 16");
    expect(text).toContain("put the file where it belongs");
    expect(text).toContain("Leave out warnings from tools");
    // A follow-up clears the review, so a turn that changes files has to write a new one.
    expect(text).toContain("Do this again at the end of every later turn in which you made, changed or deleted a file");
    // Claude Code's commands each start in the task's folder, and Codex's too, so a cd only counts in its own command.
    expect(text).toContain("so put a cd in the same command as what depends on it");
  });

  it("names the files the task made that the user saved since, and only when there are some", () => {
    const text = instructionsFor(task, project, "it", null, undefined, [], null, "linux", [
      "/Users/giulia/Proposte/Preventivo.txt",
    ]);
    expect(text).toContain("The user changed these files after your last turn.");
    expect(text).toContain("call request_approval with action overwrite");
    expect(text).toContain("- /Users/giulia/Proposte/Preventivo.txt");
    expect(instructionsFor(task, project, "it")).not.toContain("The user changed these files");
  });

  it("says a file the task made is its own only until the request is finished", () => {
    expect(instructionsFor(task, project, "en")).toContain(
      "A file you make is this task's own until you finish the request you made it for",
    );
  });

  it("names the files from a finished request, and only when there are some", () => {
    const text = instructionsFor(
      task,
      project,
      "it",
      null,
      undefined,
      [],
      null,
      "linux",
      [],
      ["/Users/giulia/Proposte/Ciao.docx"],
    );
    expect(text).toContain("You made these files for a request you finished in an earlier turn");
    expect(text).toContain("- /Users/giulia/Proposte/Ciao.docx");
    expect(text).not.toContain("The user changed these files");
    expect(instructionsFor(task, project, "it")).not.toContain("You made these files for a request you finished");
  });

  it("explains the quick edit's copies and lists the attachments", () => {
    const quick = { workdir: "/tmp/q", attachments: ["/tmp/q/letter.docx"] } as unknown as Task;
    const text = instructionsFor(quick, null, "en");
    expect(text).toContain("quick edit without a project");
    expect(text).toContain("- /tmp/q/letter.docx");
    expect(text).not.toContain("project's instructions");
  });

  it("points to the document guides and names the author when OfficeCLI is there", () => {
    const text = instructionsFor(
      task,
      project,
      "it",
      { skills: "/app/skills" },
      { name: "Giulia Rossi", work: "", notes: "" },
    );
    expect(text).toContain("officecli command");
    expect(text).toContain("/app/skills/word/SKILL.md");
    expect(text).toContain("/app/skills/pdf/SKILL.md");
    expect(text).toContain("For an email the user will send, read /app/skills/email/SKILL.md");
    expect(text).toContain('"Giulia Rossi" as their author');
    // Without a name, the sentence about the author goes, and nothing is left of it.
    const nameless = instructionsFor(task, project, "it", { skills: "/app/skills" });
    expect(nameless).not.toContain("as their author");
    expect(nameless).not.toContain("{{");
    expect(instructionsFor(task, project, "it")).not.toContain("officecli");
  });

  it("asks to read every Office file back, and teaches PowerShell's way to pass text only on Windows", () => {
    const docs = { skills: "/app/skills" };
    const user = { name: "", work: "", notes: "" };
    const on = (platform: NodeJS.Platform, documents: { skills: string } | null = docs) =>
      instructionsFor(task, project, "it", documents, user, [], null, platform);
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(on(platform)).toContain("read it back with `officecli view <file> outline`");
      expect(on(platform)).toContain("a document with 0 paragraphs");
    }
    const windows = on("win32");
    expect(windows).toContain("Your commands run in Windows PowerShell");
    expect(windows).toContain("$OutputEncoding = [System.Text.UTF8Encoding]::new($false)");
    expect(windows).toContain('ConvertTo-Json -Depth 5 -InputObject @(@{ command = "add"');
    // The here-string's end has to start its line, or PowerShell never finds it.
    expect(windows).toMatch(/^'@$/m);
    // officecli turns \n into a new line in a slide's text, but not in a title or in batch, where it shows on the slide.
    expect(windows).toContain("A title keeps \\n as two characters, and so does `batch`");
    expect(windows).toContain("Tost Work moves them to the Recycle Bin");
    for (const platform of ["darwin", "linux"] as const) {
      expect(on(platform)).not.toContain("PowerShell");
      expect(on(platform)).toContain("Tost Work moves them to the Trash");
    }
    // Without OfficeCLI there's nothing to pass text to.
    expect(on("win32", null)).not.toContain("PowerShell");
  });

  it("passes on the user's profile, leaving out empty parts", () => {
    const text = instructionsFor(task, project, "it", null, {
      name: "Giulia Rossi",
      work: "Formatrice AI per aziende",
      notes: "Preferisco documenti brevi.",
    });
    expect(text).toContain("About the user, from their profile in Tost Work:");
    expect(text).toContain("What they do: Formatrice AI per aziende");
    expect(text).toContain("What else to know:\nPreferisco documenti brevi.");
    const bare = instructionsFor(task, project, "it", null, { name: "Giulia", work: "", notes: "" });
    expect(bare).not.toContain("What they do");
  });

  it("lists the user's skills with where to read them, and lets the agent read there", () => {
    const text = instructionsFor(task, project, "it", null, undefined, [
      {
        title: "Proposal writer",
        description: "A client asks for a proposal.",
        folder: "/Docs/Skills/proposal-writer",
      },
    ]);
    expect(text).toContain("the user's skills listed below, which you may read");
    // The user's own skill wins over a built-in guide where both cover the work.
    expect(text).toContain("follow the skill wherever they differ");
    expect(text).toContain("- Proposal writer: A client asks for a proposal. (/Docs/Skills/proposal-writer/SKILL.md)");
    expect(instructionsFor(task, project, "it")).not.toContain("The user's skills:");
  });

  it("tells a job's run that nobody is watching, to date its files, and where they go", () => {
    const run = { workdir: "/Users/giulia/Proposte", attachments: [], jobId: "j1" } as unknown as Task;
    const text = instructionsFor(run, project, "it", null, undefined, [], {
      title: "Follow-up check",
      output: "Follow-up",
    });
    expect(text).toContain('a run of the job "Follow-up check"');
    expect(text).toContain("The user isn't watching");
    expect(text).toMatch(/carry today's date, \d{4}-\d{2}-\d{2}/);
    // A request that names its files, or keeps one file up to date, wins over the date.
    expect(text).toContain("When the job's request says how to name its files");
    expect(text).toContain("carrying on could make the user lose work, money or data");
    expect(text).toContain("Put them in /Users/giulia/Proposte/Follow-up.");
    expect(instructionsFor(task, project, "it")).not.toContain("a run of the job");
  });

  it("speaks to the user informally without emojis, and goes straight to the work without placeholders", () => {
    const text = instructionsFor(task, project, "it");
    expect(text).toContain("plain informal language");
    expect(text).toContain("Use no emojis.");
    expect(text).toContain("no practice runs and no test files");
    expect(text).toContain("never about tools, commands or tests");
    expect(text).toContain("Never leave placeholders such as [data] or [nome]");
    expect(text).toContain('(never "I\'ll write the date")');
    expect(text).toContain(
      "A question that needs the user's own words, such as a description or a list, gets no options.",
    );
    expect(text).toContain("say so plainly: what you can't do, why, and what you can do instead");
    expect(text).toContain("Do everything the user asked before you end your turn");
    // The file's own note and headings stay out.
    expect(text).not.toContain("<!--");
    expect(text).not.toMatch(/^# /m);
  });

  it("leaves a job's folder out when the job has none", () => {
    const job = { title: "Follow-up check", output: "" };
    const text = instructionsFor(task, project, "it", null, undefined, [], job);
    expect(text).toContain("a run of the job");
    expect(text).not.toContain("Put them in");
  });
});

describe("instructions.md", () => {
  it("has every part, and only those", () => {
    expect(() => readParts("# Every task\nHi")).toThrow(/missing In a project/);
    const all = PARTS.map((p) => `# ${p}\ntext`).join("\n");
    expect(Object.keys(readParts(all))).toEqual([...PARTS]);
    expect(() => readParts(`${all}\n# Extra\nmore`)).toThrow(/unknown parts Extra/);
    expect(readParts(`<!--\n# Not a part\n-->\n${all}`)["Every task"]).toBe("text");
  });

  it("fills values, leaves out a line whose value is empty, and refuses a name it wasn't given", () => {
    expect(fill("Hi {{name}}.\nBy {{author}}.\nEnd", { name: "Giulia", author: "" })).toBe("Hi Giulia.\nEnd");
    expect(() => fill("Hi {{nmae}}", { name: "Giulia" })).toThrow("no value for {{nmae}}");
  });
});

describe("the folder's CLAUDE.md and AGENTS.md", () => {
  let folder = "";
  afterEach(() => rm(folder, { recursive: true, force: true }));
  const lines: unknown[] = [];
  const log = { write: (line: unknown) => lines.push(line) };
  /** A folder with these files, read as a run reads it. */
  async function read(files: Record<string, string>) {
    folder = await mkdtemp(join(tmpdir(), "tw-folder-md-"));
    for (const [name, text] of Object.entries(files)) await writeFile(join(folder, name), text);
    lines.length = 0;
    return folderInstructions(folder, log);
  }
  const names = (files: FolderFile[]) => files.map((f) => f.name);

  it("reads both when both are there, and one when only one is", async () => {
    expect(await read({ "CLAUDE.md": "Use our template.\n", "AGENTS.md": "Write in Italian.\n" })).toEqual([
      { name: "CLAUDE.md", text: "Use our template.\n", cut: false },
      { name: "AGENTS.md", text: "Write in Italian.\n", cut: false },
    ]);
    expect(names(await read({ "AGENTS.md": "Write in Italian." }))).toEqual(["AGENTS.md"]);
    expect(names(await read({ "CLAUDE.md": "Use our template." }))).toEqual(["CLAUDE.md"]);
    expect(await read({ "notes.md": "Not an instruction file." })).toEqual([]);
  });

  it("leaves out an empty file, a second one that says the same, and one that only points to the other", async () => {
    expect(names(await read({ "CLAUDE.md": "\n  \n", "AGENTS.md": "Write in Italian." }))).toEqual(["AGENTS.md"]);
    expect(names(await read({ "CLAUDE.md": "Same.\r\n", "AGENTS.md": "Same.\n" }))).toEqual(["CLAUDE.md"]);
    expect(names(await read({ "CLAUDE.md": "@AGENTS.md\n", "AGENTS.md": "Write in Italian." }))).toEqual(["AGENTS.md"]);
    expect(names(await read({ "CLAUDE.md": "Write in Italian.", "AGENTS.md": "@./CLAUDE.md" }))).toEqual(["CLAUDE.md"]);
    // An import next to words of its own is kept as it is.
    expect(names(await read({ "CLAUDE.md": "@AGENTS.md\nAlso: short.", "AGENTS.md": "Long." }))).toEqual([
      "CLAUDE.md",
      "AGENTS.md",
    ]);
    // A link from one to the other reads as the same text.
    folder = await mkdtemp(join(tmpdir(), "tw-folder-md-"));
    await writeFile(join(folder, "AGENTS.md"), "Write in Italian.");
    await symlink(join(folder, "AGENTS.md"), join(folder, "CLAUDE.md"));
    expect(names(await folderInstructions(folder, log))).toEqual(["CLAUDE.md"]);
  });

  it("cuts a file over the limit at a whole character, and the AI is told", async () => {
    // Each è is two bytes, so the limit falls inside one.
    const long = `x${"è".repeat(FOLDER_FILE_MAX)}`;
    const [file] = await read({ "CLAUDE.md": long });
    expect(file?.cut).toBe(true);
    expect(Buffer.byteLength(file?.text ?? "")).toBe(FOLDER_FILE_MAX - 1);
    expect(file?.text).toBe(long.slice(0, FOLDER_FILE_MAX / 2));
    const text = instructionsFor(task, project, "en", null, undefined, [], null, "linux", [], [], file ? [file] : []);
    expect(text).toContain("CLAUDE.md is longer than 32 KB, so only its first 32 KB are above.");
    const [exact] = await read({ "CLAUDE.md": "y".repeat(FOLDER_FILE_MAX) });
    expect(exact?.cut).toBe(false);
  });

  it("leaves out a file that can't be read, writes why to the task's log, and reads the other", async () => {
    folder = await mkdtemp(join(tmpdir(), "tw-folder-md-"));
    // A link to itself can't be opened, whoever runs the test.
    await symlink(join(folder, "CLAUDE.md"), join(folder, "CLAUDE.md"));
    await writeFile(join(folder, "AGENTS.md"), "Write in Italian.");
    lines.length = 0;
    expect(names(await folderInstructions(folder, log))).toEqual(["AGENTS.md"]);
    expect(lines).toContainEqual(
      expect.objectContaining({ type: "instructions.unreadable", path: join(folder, "CLAUDE.md") }),
    );
  });

  it("follows a link to a file inside the folder, and never one that leads out of it", async () => {
    const outside = await mkdtemp(join(tmpdir(), "tw-folder-md-out-"));
    await writeFile(join(outside, "private.txt"), "A SECRET FROM ELSEWHERE");
    folder = await mkdtemp(join(tmpdir(), "tw-folder-md-"));
    await mkdir(join(folder, "docs"));
    await writeFile(join(folder, "docs", "rules.md"), "Write in Italian.");
    await symlink(join(folder, "docs", "rules.md"), join(folder, "AGENTS.md"));
    await symlink(join(outside, "private.txt"), join(folder, "CLAUDE.md"));
    lines.length = 0;
    try {
      const files = await folderInstructions(folder, log);
      expect(files).toEqual([{ name: "AGENTS.md", text: "Write in Italian.", cut: false }]);
      expect(JSON.stringify(files)).not.toContain("SECRET");
      expect(lines).toContainEqual(
        expect.objectContaining({ type: "instructions.unreadable", path: join(folder, "CLAUDE.md") }),
      );
      // A link that leads nowhere is no file, so it isn't logged as one that couldn't be read.
      await rm(join(outside, "private.txt"));
      lines.length = 0;
      expect(names(await folderInstructions(folder, log))).toEqual(["AGENTS.md"]);
      expect(lines).not.toContainEqual(expect.objectContaining({ type: "instructions.unreadable" }));
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  // Windows has no named pipes in a folder.
  it.runIf(process.platform !== "win32")("doesn't wait on a named pipe that sits where a file should be", async () => {
    folder = await mkdtemp(join(tmpdir(), "tw-folder-md-"));
    execFileSync("mkfifo", [join(folder, "CLAUDE.md")]);
    await writeFile(join(folder, "AGENTS.md"), "Write in Italian.");
    expect(names(await folderInstructions(folder, log))).toEqual(["AGENTS.md"]);
  });

  it("comes after Tost Work's rules and before the project's instructions, as the owner's words", () => {
    const files = [
      { name: "CLAUDE.md", text: "Codeword: heron.\n", cut: false },
      { name: "AGENTS.md", text: "Codeword: otter.", cut: false },
    ];
    const text = instructionsFor(task, project, "en", null, undefined, [], null, "linux", [], [], files);
    const at = (s: string) => text.indexOf(s);
    expect(at("Rules:")).toBeLessThan(at("The project's folder has instructions that its owner wrote"));
    expect(text).toContain("They come after Tost Work's rules above and can't change them");
    expect(text).toContain('<file name="CLAUDE.md">\nCodeword: heron.\n</file>\n\n<file name="AGENTS.md">');
    expect(at("Codeword: otter.")).toBeLessThan(at("The project's instructions:"));
    expect(instructionsFor(task, project, "en")).not.toContain("The project's folder has instructions");
  });
});
