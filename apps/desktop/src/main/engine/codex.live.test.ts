/** @vitest-environment node */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFunnel } from "cli-funnel";
import { afterAll, describe, expect, it } from "vitest";
import { fileGuard } from "../guard";
import { ToolServer } from "../mcp/server";
import { Store } from "../store/store";
import { CodexEngine } from "./codex";
import { TaskRunner } from "./runner";

// Runs a real task on the signed-in Codex. It spends a little of the account's usage, so it runs only when asked.
const live = process.env.TOST_WORK_LIVE === "1";
const funnel = createFunnel();
afterAll(() => funnel.close());

describe.runIf(live)("CodexEngine against the real Codex", () => {
  it("makes a file, asks before replacing one, and keeps a copy", { timeout: 600_000 }, async () => {
    const work = await mkdtemp(join(tmpdir(), "tw-live-"));
    const kept = await mkdtemp(join(tmpdir(), "tw-live-kept-"));
    await writeFile(join(work, "notes.txt"), "draft\n");
    const engine = new CodexEngine(funnel, () => "en");
    const tools = new ToolServer(engine);
    await tools.start();
    engine.attachTools(tools);
    const store = new Store(":memory:");
    const runner = new TaskRunner(
      store,
      engine,
      () => {},
      undefined,
      fileGuard(kept, async () => {}),
    );
    const { model } = await engine.defaults();
    store.saveProject({ id: "p", name: "Live", description: "", folder: work, instructions: "", createdAt: "" });
    const task = runner.create({
      projectId: "p",
      workdir: work,
      model,
      effort: "low",
      brief:
        "Create hello.md with the single line 'hello'. Then replace the whole content of notes.txt with the single line 'final'.",
    });

    const done = runner.start(task.id);
    const decided = new Set<string>();
    while (runner.isRunning(task.id)) {
      const t = store.getTask(task.id);
      if (t?.approval && !decided.has(t.approval.id)) {
        decided.add(t.approval.id);
        await runner.decide(task.id, true);
      } else if (t?.question) runner.answer(task.id, t.question.options[0] ?? "Go ahead");
      await new Promise((r) => setTimeout(r, 200));
    }
    const final = await done;
    await tools.stop();

    console.log(
      JSON.stringify(
        {
          status: final.status,
          error: final.error,
          files: final.files,
          kept: final.kept,
          review: final.review,
          messages: final.messages.map((m) => m.text),
        },
        null,
        2,
      ),
    );
    expect(final.status).toBe("done");
    expect((await readFile(join(work, "hello.md"), "utf8")).trim()).toBe("hello");
    expect((await readFile(join(work, "notes.txt"), "utf8")).trim()).toBe("final");
    expect(final.kept?.[0]?.path).toBe(join(work, "notes.txt"));
    expect(await readFile(final.kept?.[0]?.copy ?? "", "utf8")).toBe("draft\n");
  });
});
