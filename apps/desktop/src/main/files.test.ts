/** @vitest-environment node */
import { mkdir, mkdtemp, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Task } from "../shared/model";
import { freeName, MAX_PREVIEW_BYTES, readablePath } from "./files";

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
