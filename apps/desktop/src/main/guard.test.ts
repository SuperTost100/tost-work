/** @vitest-environment node */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Task } from "../shared/model";
import { fileGuard } from "./guard";

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
});
