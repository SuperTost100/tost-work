/** @vitest-environment node */
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Task } from "../shared/model";
import { copyInto, freeName, MAX_PREVIEW_BYTES, readablePath, savablePaths, saveCopies, writablePath } from "./files";

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

  it("allows a name that starts with two dots", async () => {
    const path = join(work, "..notes.md");
    await writeFile(path, "x");
    await expect(readablePath(base([{ path, kind: "add", role: "made" }]), path)).resolves.toMatch(/\.\.notes\.md$/);
  });

  it("limits the size for a preview only", async () => {
    const path = join(work, "big.pdf");
    await writeFile(path, "");
    await truncate(path, MAX_PREVIEW_BYTES + 1);
    const task = base([{ path, kind: "add", role: "made" }]);
    await expect(readablePath(task, path)).rejects.toThrow(/too big/);
    await expect(readablePath(task, path, false)).resolves.toMatch(/big\.pdf$/);
  });

  it("counts a dangling link as a taken name", async () => {
    await symlink(join(root, "gone.docx"), join(work, "Dangling.docx"));
    expect(await freeName(work, "Dangling.docx")).toBe(join(work, "Dangling (2).docx"));
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

  it("leaves no copies behind when one file of the batch fails", async () => {
    const [src, dest] = await Promise.all([folder(), folder()]);
    await writeFile(join(src, "notes.txt"), "notes");
    await expect(copyInto([join(src, "notes.txt"), join(src, "gone.txt")], dest)).rejects.toThrow();
    expect(await readdir(dest)).toEqual([]);
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

  it("saves nothing over a file when the user picks the folder it's already in", async () => {
    const dir = await folder();
    const source = join(dir, "a.txt");
    await writeFile(source, "mine");
    const result = await saveCopies(
      [source],
      dir,
      async () => {
        throw new Error("nothing should be asked");
      },
      async () => {
        throw new Error("nothing should be trashed");
      },
    );
    expect(result).toEqual({ saved: [source], cancelled: false });
    expect(await readFile(source, "utf8")).toBe("mine");
  });

  it("skips a made file that was removed outside the app when saving", async () => {
    const kept = join(work, "kept.docx");
    await writeFile(kept, "x");
    const files: Task["files"] = [
      { path: join(work, "removed.docx"), kind: "add", role: "made" },
      { path: kept, kind: "add", role: "made" },
    ];
    expect(await savablePaths(base(files))).toHaveLength(1);
  });

  it("lets a missing file be written back inside the folder, but not through a broken link or outside", async () => {
    const task = base([]);
    expect(await writablePath(task, join(work, "back.docx"))).toBe(join(await realpath(work), "back.docx"));
    await symlink(join(root, "nowhere.docx"), join(work, "broken.docx"));
    await expect(writablePath(task, join(work, "broken.docx"))).rejects.toThrow(/broken link/);
    await expect(writablePath(task, join(root, "outside.docx"))).rejects.toThrow(/outside/);
  });
});
