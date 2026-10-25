/** @vitest-environment node */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/model";
import { fileGuard } from "../guard";
import { Store } from "../store/store";
import { FakeEngine, type FakeScript, PROPOSAL_SCRIPT } from "./fake";
import { TaskRunner } from "./runner";

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 2));
  if (!check()) throw new Error("timed out");
};

async function setup(script: FakeScript = PROPOSAL_SCRIPT) {
  const temp = (prefix: string) => mkdtemp(join(tmpdir(), prefix));
  const [samples, work, kept] = await Promise.all([temp("tw-samples-"), temp("tw-work-"), temp("tw-kept-")]);
  await writeFile(join(samples, "Proposta.docx"), "new");
  await writeFile(join(samples, "prezzi.xlsx"), "prices");
  const trashed: string[] = [];
  const store = new Store(":memory:");
  const guard = fileGuard(kept, async (path) => {
    trashed.push(path);
    await rm(path);
  });
  const runner = new TaskRunner(store, new FakeEngine(script, 0, samples), () => {}, undefined, guard);
  const task = runner.create({ projectId: "p1", brief: "Write a proposal", workdir: work });
  const status = () => store.getTask(task.id);
  return { store, runner, task, work, trashed, status };
}

describe("overwrite approvals", () => {
  it("asks before replacing a file, and keeps a copy of it when allowed", async () => {
    const { runner, task, work, status } = await setup();
    await writeFile(join(work, "Proposta.docx"), "old");
    const done = runner.start(task.id);

    await waitFor(() => status()?.approval != null);
    expect(status()?.approval).toMatchObject({ action: "overwrite", paths: [join(work, "Proposta.docx")] });
    await runner.decide(task.id, true);
    await waitFor(() => status()?.question != null);
    runner.answer(task.id, "The client pays it");
    const final = await done;

    expect(await readFile(join(work, "Proposta.docx"), "utf8")).toBe("new");
    expect(final.kept).toHaveLength(1);
    expect(final.kept?.[0]?.reason).toBe("overwrite");
    expect(await readFile(final.kept?.[0]?.copy ?? "", "utf8")).toBe("old");
  });

  it("saves under a new name when refused, and leaves the file alone", async () => {
    const { runner, task, work, status } = await setup();
    await writeFile(join(work, "Proposta.docx"), "old");
    const done = runner.start(task.id);
    await waitFor(() => status()?.approval != null);
    await runner.decide(task.id, false);
    await waitFor(() => status()?.question != null);
    runner.answer(task.id, "The client pays it");
    const final = await done;

    expect(await readFile(join(work, "Proposta.docx"), "utf8")).toBe("old");
    expect(await readFile(join(work, "Proposta (2).docx"), "utf8")).toBe("new");
    expect(final.files.map((f) => f.path)).toContain(join(work, "Proposta (2).docx"));
    expect(final.kept ?? []).toHaveLength(0);
  });

  it("restores the kept copy, and restoring again undoes it", async () => {
    const { runner, task, work, status } = await setup();
    const path = join(work, "Proposta.docx");
    await writeFile(path, "old");
    const done = runner.start(task.id);
    await waitFor(() => status()?.approval != null);
    await runner.decide(task.id, true);
    await waitFor(() => status()?.question != null);
    runner.answer(task.id, "The client pays it");
    await done;

    const restored = await runner.restore(task.id, path);
    expect(await readFile(path, "utf8")).toBe("old");
    expect(restored.kept?.map((k) => k.reason)).toEqual(["overwrite", "restore"]);
    await runner.restore(task.id, path);
    expect(await readFile(path, "utf8")).toBe("new");
  });

  it("refuses a second decision while the first is carried out", async () => {
    const { runner, task, work, status } = await setup();
    await writeFile(join(work, "Proposta.docx"), "old");
    void runner.start(task.id);
    await waitFor(() => status()?.approval != null);
    const first = runner.decide(task.id, true);
    await expect(runner.decide(task.id, true)).rejects.toThrow(/already being carried out/);
    await first;
    runner.stop(task.id);
  });
});

describe("approvals and Stop", () => {
  it("leaves a task stopped when Stop lands while the copy is being kept", async () => {
    const { store, runner, task, work, status } = await setup();
    await writeFile(join(work, "Proposta.docx"), "old");
    // A guard that holds the copy until the test lets it go.
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const slow = {
      keep: async (_t: Task, path: string) => {
        await held;
        return { path, copy: "/kept/x", at: "", reason: "overwrite" as const };
      },
      trash: async () => {},
      restore: async () => {},
    };
    (runner as unknown as { guard: typeof slow }).guard = slow;
    const done = runner.start(task.id);
    await waitFor(() => status()?.approval != null);
    const deciding = runner.decide(task.id, true);
    runner.stop(task.id);
    await done;
    release();
    const after = await deciding;
    expect(after.status).toBe("stopped");
    expect(store.getTask(task.id)?.status).toBe("stopped");
    expect(store.getTask(task.id)?.kept).toHaveLength(1);
  });

  it("records a deletion made just before Stop", async () => {
    const remove: FakeScript = { steps: ["Tidy"], files: [], remove: { path: "draft.txt", afterStep: 0 }, summary: "" };
    const { store, runner, task, work, status } = await setup(remove);
    await writeFile(join(work, "draft.txt"), "draft");
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    (runner as unknown as { guard: unknown }).guard = {
      keep: async () => {
        throw new Error("no copies here");
      },
      trash: async () => held,
      restore: async () => {},
    };
    const done = runner.start(task.id);
    await waitFor(() => status()?.approval != null);
    const deciding = runner.decide(task.id, true);
    runner.stop(task.id);
    await done;
    release();
    await deciding;
    expect(store.getTask(task.id)?.status).toBe("stopped");
    expect(store.getTask(task.id)?.files).toContainEqual({
      path: join(work, "draft.txt"),
      kind: "delete",
      role: "made",
    });
  });

  it("keeps the record of a deletion done before a later one failed", async () => {
    const { store, runner, task, work } = await setup();
    const [a, b] = [join(work, "a.txt"), join(work, "b.txt")];
    store.saveTask({ ...task, status: "needs-you", approval: { id: "ap", action: "delete", paths: [a, b] } });
    (runner as unknown as { guard: unknown }).guard = {
      keep: async () => {
        throw new Error("no copies here");
      },
      trash: async (_t: Task, path: string) => {
        if (path === b) throw new Error("b is locked");
      },
      restore: async () => {},
    };
    await expect(runner.decide(task.id, true)).rejects.toThrow(/locked/);
    const files = store.getTask(task.id)?.files ?? [];
    expect(files).toContainEqual({ path: a, kind: "delete", role: "made" });
    expect(files.some((f) => f.path === b)).toBe(false);

    // The retry does only what's left.
    const tried: string[] = [];
    (runner as unknown as { guard: unknown }).guard = {
      keep: async () => {
        throw new Error("no copies here");
      },
      trash: async (_t: Task, path: string) => {
        tried.push(path);
      },
      restore: async () => {},
    };
    await runner.decide(task.id, true);
    expect(tried).toEqual([b]);
    expect(store.getTask(task.id)?.files).toContainEqual({ path: b, kind: "delete", role: "made" });
  });

  it("refuses a restore while a decision stopped midway is still copying", async () => {
    const { store, runner, task, work, status } = await setup();
    const path = join(work, "Proposta.docx");
    await writeFile(path, "old");
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    (runner as unknown as { guard: unknown }).guard = {
      keep: async (_t: Task, p: string) => {
        await held;
        return { path: p, copy: "/kept/x", at: "", reason: "overwrite" as const };
      },
      trash: async () => {},
      restore: async () => {},
    };
    const done = runner.start(task.id);
    await waitFor(() => status()?.approval != null);
    // An earlier kept copy, so Restore has something to put back.
    store.saveTask({ ...(status() as Task), kept: [{ path, copy: "/kept/earlier", at: "", reason: "overwrite" }] });
    const deciding = runner.decide(task.id, true);
    runner.stop(task.id);
    await done;
    await expect(runner.restore(task.id, path)).rejects.toThrow(/decision to finish/);
    release();
    await deciding;
  });

  it("refuses a second restore while one is under way", async () => {
    const { runner, task, work, status } = await setup();
    const path = join(work, "Proposta.docx");
    await writeFile(path, "old");
    const done = runner.start(task.id);
    await waitFor(() => status()?.approval != null);
    await runner.decide(task.id, true);
    await waitFor(() => status()?.question != null);
    runner.answer(task.id, "The client pays it");
    await done;
    const first = runner.restore(task.id, path);
    await expect(runner.restore(task.id, path)).rejects.toThrow(/already in progress/);
    expect(() => runner.followUp(task.id, "Shorter, please")).toThrow(/restore to finish/);
    expect((await first).kept?.map((k) => k.reason)).toEqual(["overwrite", "restore"]);
  });
});

describe("delete approvals", () => {
  const removing = (path: string): FakeScript => ({
    steps: ["Tidy up"],
    files: [],
    remove: { path, afterStep: 0 },
    summary: "Done.",
  });

  it("moves an allowed deletion to the Trash before the agent goes on", async () => {
    const { runner, task, work, trashed, status } = await setup(removing("draft.txt"));
    await writeFile(join(work, "draft.txt"), "draft");
    const done = runner.start(task.id);
    await waitFor(() => status()?.approval != null);
    expect(status()?.approval?.action).toBe("delete");
    await runner.decide(task.id, true);
    const final = await done;

    expect(trashed).toHaveLength(1);
    expect(await readdir(work)).toEqual([]);
    expect(final.files).toEqual([{ path: join(work, "draft.txt"), kind: "delete", role: "made" }]);
  });

  it("keeps the file when refused", async () => {
    const { runner, task, work, trashed, status } = await setup(removing("draft.txt"));
    await writeFile(join(work, "draft.txt"), "draft");
    const done = runner.start(task.id);
    await waitFor(() => status()?.approval != null);
    await runner.decide(task.id, false);
    await done;
    expect(trashed).toEqual([]);
    expect(await readdir(work)).toEqual(["draft.txt"]);
  });

  it("refuses to delete a file outside the task's folder, and keeps asking", async () => {
    const { runner, task, work, trashed, status } = await setup(removing("../outside.txt"));
    await writeFile(join(work, "..", "outside.txt"), "not yours");
    void runner.start(task.id);
    await waitFor(() => status()?.approval != null);
    await expect(runner.decide(task.id, true)).rejects.toThrow(/outside/);
    expect(trashed).toEqual([]);
    expect(status()?.approval).not.toBeNull();
    runner.stop(task.id);
    await rm(join(work, "..", "outside.txt"));
  });
});
