/** @vitest-environment node */
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Task } from "../shared/model";
import { copyInto, freeName, readablePath, savablePaths, saveCopies } from "./files";

let root = "";
let work = "";
const base = (files: Task["files"], attachments: string[] = []): Task => ({
  id: "t",
  projectId: null,
  title: "t",
  brief: "b",
  attachments,
  workdir: work,
  model: "m",
  effort: "medium",
  status: "done",
  steps: [],
  files,
  messages: [],
  question: null,
  approval: null,
  review: null,
  error: null,
  createdAt: "",
  updatedAt: "",
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tw-files-"));
  work = join(root, "work");
  await mkdir(work);
  await writeFile(join(work, "Proposta.docx"), "doc");
  await writeFile(join(root, "secret.txt"), "secret");
  await symlink(join(root, "secret.txt"), join(work, "link.txt"));
  await writeFile(join(root, "notes.docx"), "notes");
});

describe("readablePath", () => {
  it("allows a file the task made inside its folder", async () => {
    const path = join(work, "Proposta.docx");
    await expect(readablePath(base([{ path, kind: "add", role: "made" }]), path)).resolves.toMatch(/Proposta\.docx$/);
  });

  it("refuses a file the task doesn't list", async () => {
    await expect(readablePath(base([]), join(work, "Proposta.docx"))).rejects.toThrow(/isn't part/);
  });

  it("refuses a listed file outside the folder, and a link that points out", async () => {
    const outside = join(root, "secret.txt");
    await expect(readablePath(base([{ path: outside, kind: "add", role: "made" }]), outside)).rejects.toThrow(
      /outside/,
    );
    const link = join(work, "link.txt");
    await expect(readablePath(base([{ path: link, kind: "add", role: "made" }]), link)).rejects.toThrow(/outside/);
  });

  it("allows an attachment wherever it is, and refuses a deleted file", async () => {
    const notes = join(root, "notes.docx");
    await expect(readablePath(base([], [notes]), notes)).resolves.toMatch(/notes\.docx$/);
    const path = join(work, "Proposta.docx");
    await expect(readablePath(base([{ path, kind: "delete", role: "made" }]), path)).rejects.toThrow(/isn't part/);
  });
});

describe("saving and copying files", () => {
  const folder = async () => mkdtemp(join(tmpdir(), "tw-save-"));

  it("saves only made files, once each, and refuses one that links out of the folder", async () => {
    const doc = join(work, "Proposta.docx");
    const files: Task["files"] = [
      { path: doc, kind: "add", role: "made" },
      { path: doc, kind: "update", role: "made" },
      { path: join(work, "gone.docx"), kind: "delete", role: "made" },
      { path: join(root, "notes.docx"), kind: "add", role: "used" },
    ];
    expect(await savablePaths(base(files))).toHaveLength(1);
    const link = join(work, "link.txt");
    await expect(savablePaths(base([{ path: link, kind: "add", role: "made" }]))).rejects.toThrow(/outside/);
  });

  it("picks the next free name", async () => {
    const dir = await folder();
    expect(await freeName(dir, "letter.docx")).toBe(join(dir, "letter.docx"));
    await writeFile(join(dir, "letter.docx"), "1");
    await writeFile(join(dir, "letter (2).docx"), "2");
    expect(await freeName(dir, "letter.docx")).toBe(join(dir, "letter (3).docx"));
  });

  it("copies two files with the same name into a quick edit folder without losing one", async () => {
    const [a, b, dest] = await Promise.all([folder(), folder(), folder()]);
    await writeFile(join(a, "notes.txt"), "from a");
    await writeFile(join(b, "notes.txt"), "from b");
    const copies = await copyInto([join(a, "notes.txt"), join(b, "notes.txt")], dest);
    expect(copies).toEqual([join(dest, "notes.txt"), join(dest, "notes (2).txt")]);
    expect(await readFile(copies[1] ?? "", "utf8")).toBe("from b");
  });

  it("asks before replacing, and sends the old file to the trash", async () => {
    const [src, dest] = await Promise.all([folder(), folder()]);
    await writeFile(join(src, "a.txt"), "new");
    await writeFile(join(dest, "a.txt"), "old");
    const asked: string[] = [];
    const trashed: string[] = [];
    const result = await saveCopies(
      [join(src, "a.txt")],
      dest,
      async (name) => {
        asked.push(name);
        return "replace";
      },
      async (path) => {
        trashed.push(path);
        await rm(path);
      },
    );
    expect(asked).toEqual(["a.txt"]);
    expect(trashed).toEqual([join(dest, "a.txt")]);
    expect(result).toEqual({ saved: [join(dest, "a.txt")], cancelled: false });
    expect(await readFile(join(dest, "a.txt"), "utf8")).toBe("new");
  });

  it("keeps both under a free name, and stops on cancel", async () => {
    const [src, dest] = await Promise.all([folder(), folder()]);
    for (const n of ["a.txt", "b.txt", "c.txt"]) await writeFile(join(src, n), n);
    await writeFile(join(dest, "a.txt"), "old a");
    await writeFile(join(dest, "c.txt"), "old c");
    const answers = ["keep-both", "cancel"] as const;
    let i = 0;
    const result = await saveCopies(
      ["a.txt", "b.txt", "c.txt"].map((n) => join(src, n)),
      dest,
      async () => answers[i++] ?? "cancel",
      async () => {
        throw new Error("nothing should be trashed");
      },
    );
    expect(result.cancelled).toBe(true);
    expect(result.saved).toEqual([join(dest, "a (2).txt"), join(dest, "b.txt")]);
    expect((await readdir(dest)).sort()).toEqual(["a (2).txt", "a.txt", "b.txt", "c.txt"]);
    expect(await readFile(join(dest, "c.txt"), "utf8")).toBe("old c");
  });
});
