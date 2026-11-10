/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { Project, Task } from "../../shared/model";
import { fill, instructionsFor, PARTS, readParts } from "./instructions";

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
