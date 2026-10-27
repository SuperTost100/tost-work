/** @vitest-environment node */
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSkill, parseSkill, SkillFolder, skillName } from "./skills";

async function folder() {
  const root = join(await mkdtemp(join(tmpdir(), "tw-skills-")), "Skills");
  const trashed: string[] = [];
  return { root, trashed, skills: new SkillFolder(root, async (p) => void trashed.push(p)) };
}

describe("SKILL.md", () => {
  it("reads plain, quoted and folded descriptions", () => {
    expect(parseSkill("---\nname: word\ndescription: Make a Word file.\n---\n\n# Word\n\nSteps")).toEqual({
      name: "word",
      description: "Make a Word file.",
      body: "# Word\n\nSteps",
      extra: "",
    });
    expect(parseSkill('---\nname: x\ndescription: "Use it: always"\n---\nBody').description).toBe("Use it: always");
    expect(parseSkill("---\nname: x\ndescription: >\n  One line\n  and another\n---\nBody").description).toBe(
      "One line and another",
    );
    // No frontmatter: all of it is the body.
    expect(parseSkill("# Just text")).toEqual({ name: "", description: "", body: "# Just text", extra: "" });
  });

  it("writes what it reads back, with a colon in the description kept as text", () => {
    const text = formatSkill("proposal-writer", "When: a client asks for a proposal", "# Proposal writer\n\n1. Read");
    expect(parseSkill(text)).toEqual({
      name: "proposal-writer",
      description: "When: a client asks for a proposal",
      body: "# Proposal writer\n\n1. Read\n",
      extra: "",
    });
  });

  it("keeps a backslash as one backslash, however often it's saved", () => {
    let text = formatSkill("x", "Use C:\\Templates", "Body");
    for (let i = 0; i < 3; i++) text = formatSkill("x", parseSkill(text).description, "Body");
    expect(parseSkill(text).description).toBe("Use C:\\Templates");
    expect(parseSkill("---\nname: x\ndescription: 'It''s here'\n---\n").description).toBe("It's here");
  });

  it("names a skill the way the Agent Skills format asks", () => {
    expect(skillName("Proposte per l'ufficio è più")).toBe("proposte-per-l-ufficio-e-piu");
    expect(skillName("  ")).toBe("skill");
    expect(skillName("x".repeat(80))).toHaveLength(64);
  });
});

describe("SkillFolder", () => {
  it("makes, lists, edits and renames skills as SKILL.md folders", async () => {
    const { root, skills } = await folder();
    expect(await skills.list()).toEqual([]);
    const made = await skills.create("Proposal writer", "A client asks for a proposal.", "1. Read the notes.");
    expect(made).toMatchObject({ id: "proposal-writer", title: "Proposal writer", steps: "1. Read the notes." });
    expect(await readFile(join(root, "proposal-writer", "SKILL.md"), "utf8")).toBe(
      '---\nname: proposal-writer\ndescription: "A client asks for a proposal."\n---\n\n# Proposal writer\n\n1. Read the notes.\n',
    );

    // A second skill with the same title gets its own folder.
    expect((await skills.create("Proposal writer")).id).toBe("proposal-writer-2");

    const renamed = await skills.save("proposal-writer", {
      title: "Wine proposals",
      description: "A wine shop asks for a proposal.",
      steps: "1. Read.\n2. Price it.",
    });
    expect(renamed.id).toBe("wine-proposals");
    expect((await skills.list()).map((s) => s.title)).toEqual(["Proposal writer", "Wine proposals"]);
    await expect(skills.get("proposal-writer")).resolves.toBeNull();
  });

  it("brings files along, and skips folders without a SKILL.md", async () => {
    const { root, skills } = await folder();
    const made = await skills.create("Price table");
    const source = join(root, "..", "template.xlsx");
    await writeFile(source, "x");
    await skills.addFiles(made.id, [source, source]);
    expect((await skills.get(made.id))?.files).toEqual(["template (2).xlsx", "template.xlsx"]);
    await mkdir(join(root, "notes"));
    expect((await skills.list()).map((s) => s.id)).toEqual(["price-table"]);
  });

  it("reads a skill made elsewhere, titled after its name when it has no heading", async () => {
    const { root, skills } = await folder();
    await mkdir(join(root, "meeting-notes"), { recursive: true });
    await writeFile(
      join(root, "meeting-notes", "SKILL.md"),
      "---\nname: meeting-notes\ndescription: Notes.\n---\nDo it.",
    );
    expect(await skills.get("meeting-notes")).toMatchObject({ title: "Meeting notes", steps: "Do it." });
  });

  it("keeps the folder of a numbered skill whose title stays the same", async () => {
    const { skills } = await folder();
    await skills.create("Proposal writer");
    const second = await skills.create("Proposal writer");
    const saved = await skills.save(second.id, { title: "Proposal writer", description: "Edited", steps: "" });
    expect(saved.id).toBe("proposal-writer-2");
    expect((await skills.save(saved.id, { title: "Proposal writer", description: "Again", steps: "" })).id).toBe(
      "proposal-writer-2",
    );
  });

  it("keeps the folder when a new title's name is already the folder's name", async () => {
    const { skills } = await folder();
    await skills.create("Proposal writer");
    const second = await skills.create("Proposal writer");
    const saved = await skills.save(second.id, { title: "Proposal writer 2", description: "", steps: "" });
    expect(saved.id).toBe("proposal-writer-2");
  });

  it("doesn't take a linked SKILL.md for a skill", async () => {
    const { root, skills } = await folder();
    const outside = await mkdtemp(join(tmpdir(), "tw-outside-"));
    await writeFile(join(outside, "SKILL.md"), "---\nname: x\ndescription: y\n---\nBody");
    await mkdir(join(root, "linked-file"), { recursive: true });
    await symlink(join(outside, "SKILL.md"), join(root, "linked-file", "SKILL.md"));
    expect(await skills.list()).toEqual([]);
    await expect(skills.save("linked-file", { title: "linked file", description: "", steps: "" })).rejects.toThrow(
      /isn't there any more/,
    );
  });

  it("keeps frontmatter fields the editor doesn't show", async () => {
    const { root, skills } = await folder();
    await mkdir(join(root, "pdf-check"), { recursive: true });
    await writeFile(
      join(root, "pdf-check", "SKILL.md"),
      "---\nname: pdf-check\ndescription: Check a PDF.\nlicense: MIT\nmetadata:\n  author: Giulia\n---\n# PDF check\n\nDo it.",
    );
    await skills.save("pdf-check", { title: "PDF check", description: "Check any PDF.", steps: "Do it well." });
    const text = await readFile(join(root, "pdf-check", "SKILL.md"), "utf8");
    expect(text).toContain("license: MIT\nmetadata:\n  author: Giulia\n---");
    expect(parseSkill(text).description).toBe("Check any PDF.");
  });

  it("puts the folder back when a renamed skill can't be written", async () => {
    const { root, skills } = await folder();
    const made = await skills.create("Old name");
    await chmod(join(root, made.id), 0o555);
    await expect(skills.save(made.id, { title: "New name", description: "", steps: "" })).rejects.toThrow();
    await chmod(join(root, made.id), 0o755);
    expect((await skills.list()).map((s) => s.id)).toEqual(["old-name"]);
  });

  it("refuses a link in the Skills folder, which could lead outside it", async () => {
    const { root, skills } = await folder();
    await mkdir(root, { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), "tw-outside-"));
    await writeFile(join(outside, "SKILL.md"), "---\nname: x\ndescription: y\n---\nBody");
    await symlink(outside, join(root, "linked"));
    await expect(skills.save("linked", { title: "linked", description: "", steps: "" })).rejects.toThrow(
      /isn't a skill/,
    );
    await expect(skills.addFiles("linked", [])).rejects.toThrow(/isn't a skill/);
    expect(await readFile(join(outside, "SKILL.md"), "utf8")).toContain("Body");
  });

  it("moves a removed skill to the Trash and refuses ids that point outside the folder", async () => {
    const { root, skills, trashed } = await folder();
    const made = await skills.create("Old");
    await skills.remove(made.id);
    expect(trashed).toEqual([join(root, "old")]);
    await expect(skills.get("../escape")).rejects.toThrow(/isn't a skill/);
    await expect(skills.remove("..")).rejects.toThrow(/isn't a skill/);
  });
});
