/** @vitest-environment node */
import { chmod, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { formatSkill, IMPORT_LIMITS, parseSkill, SkillFolder, skillName } from "./skills";
import { SkillVersions } from "./skillVersions";

async function folder() {
  const base = await mkdtemp(join(tmpdir(), "tw-skills-"));
  const root = join(base, "Skills");
  const guides = join(base, "guides");
  await mkdir(join(guides, "word"), { recursive: true });
  await writeFile(
    join(guides, "word", "SKILL.md"),
    "---\nname: word\ndescription: Make a Word file.\n---\n\n# Word documents\n\nUse officecli.",
  );
  const trashed: string[] = [];
  let clock = 0;
  const skills = new SkillFolder(root, async (p) => void trashed.push(p), {
    builtIns: guides,
    versions: new SkillVersions(join(base, "versions")),
    now: () => new Date(Date.UTC(2026, 9, 27, 9, 0, clock++)).toISOString(),
  });
  return { base, root, trashed, skills };
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

  it("lists the built-in guides read-only, and duplicates one among the user's skills", async () => {
    const { root, skills } = await folder();
    const [word] = await skills.builtIns();
    expect(word).toMatchObject({ id: "@word", title: "Word documents", builtIn: true });
    // A guide's id can't be used as one of the user's skills.
    await expect(skills.save("@word", { title: "x", description: "", steps: "" })).rejects.toThrow(/isn't a skill/);
    const copy = await skills.duplicate("@word");
    expect(copy).toMatchObject({
      id: "word-documents-copy",
      title: "Word documents (copy)",
      steps: "Use officecli.",
      version: 1,
    });
    const text = await readFile(join(root, "word-documents-copy", "SKILL.md"), "utf8");
    expect(parseSkill(text).name).toBe("word-documents-copy");
    expect((await skills.duplicate("@word", (t) => `${t} (copia)`)).title).toBe("Word documents (copia)");
  });

  it("keeps a version per save, with its note, and puts an old one back as a new version", async () => {
    const { skills } = await folder();
    const made = await skills.create("Proposal writer", "Proposals.", "1. Read.");
    await skills.save(
      made.id,
      { title: "Proposal writer", description: "Proposals.", steps: "1. Read.\n2. Price." },
      "price step",
    );
    // Saving the same text again keeps no new version.
    const again = await skills.save(made.id, {
      title: "Proposal writer",
      description: "Proposals.",
      steps: "1. Read.\n2. Price.",
    });
    expect(again.version).toBe(2);
    expect((await skills.history(made.id)).map((v) => [v.n, v.note])).toEqual([
      [2, "price step"],
      [1, undefined],
    ]);
    // Restore makes v1 current again, with no new version, and v2 stays to come back to.
    const back = await skills.restore(made.id, 1);
    expect(back).toMatchObject({ steps: "1. Read.", version: 1 });
    expect((await skills.history(made.id)).map((v) => v.n)).toEqual([2, 1]);
    expect(await skills.restore(made.id, 2)).toMatchObject({ version: 2 });
    // A change after a restore is the next version.
    await skills.restore(made.id, 1);
    const changed = await skills.save(made.id, {
      title: "Proposal writer",
      description: "Proposals.",
      steps: "1. Skim.",
    });
    expect(changed.version).toBe(3);
  });

  it("takes the versions along when a new title renames the folder, and a new skill with an old name starts afresh", async () => {
    const { skills } = await folder();
    const made = await skills.create("Old name");
    const renamed = await skills.save(made.id, { title: "New name", description: "", steps: "x" });
    expect(renamed).toMatchObject({ id: "new-name", version: 2 });
    // v1, kept under the old name, comes back as v1 under the new one, not as a new version.
    expect(await skills.restore("new-name", 1)).toMatchObject({ id: "new-name", name: "new-name", version: 1 });
    expect((await skills.history("new-name")).map((v) => v.n)).toEqual([2, 1]);
    expect((await skills.create("Old name")).version).toBe(1);
  });

  it("imports a SKILL.md folder with its subfolders, leaving out links and hidden files", async () => {
    const { base, root, skills } = await folder();
    const source = join(base, "downloads", "Meeting Notes");
    await mkdir(join(source, "templates"), { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: notes\ndescription: Minutes.\nlicense: MIT\n---\n# Notes\n\nDo it.",
    );
    await writeFile(join(source, "templates", "minutes.docx"), "x");
    await writeFile(join(source, ".DS_Store"), "x");
    await symlink("/etc/passwd", join(source, "passwd"));
    const imported = await skills.import(source);
    expect(imported).toMatchObject({ id: "notes", title: "Notes", version: 1 });
    expect((await readdir(join(root, "notes"))).sort()).toEqual(["SKILL.md", "templates"]);
    expect(await readFile(join(root, "notes", "SKILL.md"), "utf8")).toContain("license: MIT");
    // The same skill again gets a numbered folder, and its name follows it.
    const second = await skills.import(source);
    expect(second.id).toBe("notes-2");
    expect(second.name).toBe("notes-2");
    await expect(skills.import(join(base, "downloads"))).rejects.toThrow(/no SKILL.md/);
  });

  it("imports a zipped skill from its folder inside the zip, and refuses a path that leaves it", async () => {
    const { base, root, skills } = await folder();
    const zip = new JSZip();
    zip.file("brand-voice/SKILL.md", "---\nname: brand-voice\ndescription: Tone.\n---\n# Brand voice\n\nBe direct.");
    zip.file("brand-voice/examples/good.md", "x");
    zip.file("__MACOSX/brand-voice/._SKILL.md", "x");
    zip.file("README.txt", "outside the skill");
    await writeFile(join(base, "brand.zip"), await zip.generateAsync({ type: "nodebuffer" }));
    expect(await skills.import(join(base, "brand.zip"))).toMatchObject({ id: "brand-voice", title: "Brand voice" });
    expect((await readdir(join(root, "brand-voice"))).sort()).toEqual(["SKILL.md", "examples"]);

    const bad = new JSZip();
    bad.file("SKILL.md", "---\nname: bad\ndescription: x\n---\nx");
    bad.file("../../escape.txt", "x");
    await writeFile(join(base, "bad.zip"), await bad.generateAsync({ type: "nodebuffer" }));
    await expect(skills.import(join(base, "bad.zip"))).rejects.toThrow(/outside its folder/);
    // Nothing was left behind by the refused import.
    expect((await readdir(root)).filter((n) => !n.startsWith(".")).sort()).toEqual(["brand-voice"]);
    expect((await readdir(root)).some((n) => n.startsWith(".import-"))).toBe(false);
  });

  it("keeps every version when two saves of one skill come at once", async () => {
    const { skills } = await folder();
    const made = await skills.create("Notes");
    await Promise.all([
      skills.save(made.id, { title: "Notes", description: "", steps: "A" }, "first"),
      skills.save(made.id, { title: "Notes", description: "", steps: "B" }, "second"),
    ]);
    expect((await skills.history(made.id)).map((v) => v.note)).toEqual(["second", "first", undefined]);
  });

  it("stops unpacking a zip entry at the size limit, and leaves nothing behind", async () => {
    const { base, root, skills } = await folder();
    const zip = new JSZip();
    zip.file("SKILL.md", "---\nname: big\ndescription: x\n---\nx");
    zip.file("huge.bin", Buffer.alloc(4096, 1));
    await writeFile(join(base, "big.zip"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    const limit = IMPORT_LIMITS.bytes;
    IMPORT_LIMITS.bytes = 1024;
    try {
      await expect(skills.import(join(base, "big.zip"))).rejects.toThrow(/too big/);
    } finally {
      IMPORT_LIMITS.bytes = limit;
    }
    expect(await readdir(root)).toEqual([]);
  });

  it("takes a half-done import back out when keeping its version fails", async () => {
    const base = await mkdtemp(join(tmpdir(), "tw-skills-"));
    const root = join(base, "Skills");
    // A file where the versions folder should be, so keeping the version fails after the folder is in place.
    await writeFile(join(base, "versions"), "not a folder");
    const skills = new SkillFolder(root, async () => {}, { versions: new SkillVersions(join(base, "versions")) });
    const source = join(base, "notes");
    await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: notes\ndescription: x\n---\n# Notes\n\nx");
    await expect(skills.import(source)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });

  it("keeps an older skill's history when setting it aside fails during an import", async () => {
    const base = await mkdtemp(join(tmpdir(), "tw-skills-"));
    const versions = new SkillVersions(join(base, "versions"));
    await versions.record("notes", "old text", "2026-10-01T00:00:00Z");
    versions.setAside = async () => {
      throw new Error("disk full");
    };
    const skills = new SkillFolder(join(base, "Skills"), async () => {}, { versions });
    const source = join(base, "notes");
    await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: notes\ndescription: x\n---\n# Notes\n\nx");
    await expect(skills.import(source)).rejects.toThrow(/disk full/);
    expect(await versions.text("notes", 1)).toBe("old text");
  });
});
