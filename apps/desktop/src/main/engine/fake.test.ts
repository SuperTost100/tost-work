/** @vitest-environment node */
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineEvent, Task } from "../../shared/model";
import { FakeEngine, type FakeScript } from "./fake";

const script: FakeScript = {
  steps: ["Write"],
  files: [{ path: "Proposta.docx", kind: "add", afterStep: 0 }],
  review: { asked: [], decided: [], checkYourself: [] },
  summary: "Done.",
};

async function folders() {
  const samples = await mkdtemp(join(tmpdir(), "tw-fake-samples-"));
  const work = await mkdtemp(join(tmpdir(), "tw-fake-work-"));
  await writeFile(join(samples, "Proposta.docx"), "sample");
  return { samples, work };
}

/** Runs the fake to the end, refusing every approval it asks for. */
const run = async (engine: FakeEngine, work: string, controller = new AbortController()) => {
  const events: EngineEvent[] = [];
  const task = { id: "t", files: [], attachments: [] } as unknown as Task;
  for await (const e of engine.run({ task, project: null, workdir: work, followUp: null, signal: controller.signal })) {
    events.push(e);
    if (e.type === "approval") engine.decide(task.id, e.approval.id, false);
  }
  return events;
};

describe("FakeEngine samples", () => {
  it("asks before replacing a file already in the folder, and keeps it when refused", async () => {
    const { samples, work } = await folders();
    await writeFile(join(work, "Proposta.docx"), "the user's own");
    const events = await run(new FakeEngine(script, 0, samples), work);
    expect(events.some((e) => e.type === "approval")).toBe(true);
    expect(await readFile(join(work, "Proposta.docx"), "utf8")).toBe("the user's own");
    expect(await readFile(join(work, "Proposta (2).docx"), "utf8")).toBe("sample");
    expect(events).toContainEqual({
      type: "file",
      change: { path: join(work, "Proposta (2).docx"), kind: "add", role: "made" },
    });
  });

  it("writes nothing once stopped during a step", async () => {
    const { samples, work } = await folders();
    const controller = new AbortController();
    const engine = new FakeEngine(script, 50, samples);
    const events: EngineEvent[] = [];
    const task = { id: "t", files: [], attachments: [] } as unknown as Task;
    for await (const e of engine.run({
      task,
      project: null,
      workdir: work,
      followUp: null,
      signal: controller.signal,
    })) {
      events.push(e);
      if (e.type === "plan") controller.abort();
    }
    expect(events.at(-1)).toEqual({ type: "stopped" });
    expect(await readdir(work)).toEqual([]);
  });

  it("doesn't hang when Stop lands just before it asks for an approval", async () => {
    const { samples, work } = await folders();
    await writeFile(join(work, "old.txt"), "x");
    const remove: FakeScript = { steps: ["Tidy"], files: [], remove: { path: "old.txt", afterStep: 0 }, summary: "" };
    const controller = new AbortController();
    const engine = new FakeEngine(remove, 50, samples);
    const events: EngineEvent[] = [];
    const task = { id: "t", files: [], attachments: [] } as unknown as Task;
    for await (const e of engine.run({
      task,
      project: null,
      workdir: work,
      followUp: null,
      signal: controller.signal,
    })) {
      events.push(e);
      if (e.type === "plan") controller.abort();
    }
    expect(events.at(-1)).toEqual({ type: "stopped" });
  });
});
