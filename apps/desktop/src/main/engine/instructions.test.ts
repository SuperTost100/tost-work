/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { Project, Task } from "../../shared/model";
import { instructionsFor } from "./instructions";

const task = { workdir: "/Users/giulia/Proposte", attachments: [] } as unknown as Task;
const project = { name: "Proposte", instructions: "Use our template.\n" } as Project;

describe("instructionsFor", () => {
  it("names the folder, the language, the rules and the project's instructions", () => {
    const text = instructionsFor(task, project, "it");
    expect(text).toContain("/Users/giulia/Proposte");
    expect(text).toContain("plain Italian");
    // The work goes in a file, and the chat stays short; questions go through the card.
    expect(text).toContain("never in a message");
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
    expect(text).toContain('"Giulia Rossi" as their author');
    expect(instructionsFor(task, project, "it")).not.toContain("officecli");
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
});
