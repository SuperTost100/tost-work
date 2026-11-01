/** @vitest-environment node */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../shared/model";
import { fileGuard } from "./guard";

// A copy can fail with ENOENT because of its destination; this lets one test make it so.
const failing = vi.hoisted(() => ({ copy: false }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    copyFile: (...args: Parameters<typeof fs.copyFile>) =>
      failing.copy
        ? Promise.reject(Object.assign(new Error("ENOENT: no such file or directory, copyfile"), { code: "ENOENT" }))
        : fs.copyFile(...args),
  };
});

describe("fileGuard", () => {
  it("keeps two copies made in the same millisecond apart", async () => {
    const work = await mkdtemp(join(tmpdir(), "tw-guard-work-"));
    const kept = await mkdtemp(join(tmpdir(), "tw-guard-kept-"));
    const task = { id: "t1", workdir: work } as Task;
    const path = join(work, "a.txt");
    const guard = fileGuard(
      kept,
      async () => {},
      () => new Date(0),
    );

    await writeFile(path, "first");
    const one = await guard.keep(task, path, "overwrite");
    await writeFile(path, "second");
    const two = await guard.keep(task, path, "restore");

    expect(one.copy).not.toBe(two.copy);
    expect(await readFile(one.copy, "utf8")).toBe("first");
    expect(await readFile(two.copy, "utf8")).toBe("second");
  });

  it("doesn't pass a failed copy off as a missing file", async () => {
    const work = await mkdtemp(join(tmpdir(), "tw-guard-work-"));
    const kept = await mkdtemp(join(tmpdir(), "tw-guard-kept-"));
    const task = { id: "t1", workdir: work } as Task;
    const guard = fileGuard(kept, async () => {});
    await writeFile(join(work, "a.txt"), "data");
    failing.copy = true;
    try {
      const err = await guard.keep(task, join(work, "a.txt"), "overwrite").catch((e: NodeJS.ErrnoException) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as NodeJS.ErrnoException).code).toBeUndefined();
      expect((err as Error).message).toMatch(/Couldn't keep a copy of a\.txt/);
    } finally {
      failing.copy = false;
    }
  });
});
