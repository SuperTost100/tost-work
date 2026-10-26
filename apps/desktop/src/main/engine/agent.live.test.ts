/** @vitest-environment node */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFunnel } from "cli-funnel";
import { afterAll, describe, expect, it } from "vitest";
import { type AiId, SUBSCRIPTIONS, type Task } from "../../shared/model";
import { fileGuard } from "../guard";
import { ToolServer } from "../mcp/server";
import { Store } from "../store/store";
import { AgentEngine } from "./agent";
import { TaskRunner } from "./runner";

// Runs real tasks on the signed-in Codex and Claude Code. They spend a little of each account's usage, so they run
// only when asked: TOST_WORK_LIVE=1 for both, or a list such as TOST_WORK_LIVE=claude.
const asked = process.env.TOST_WORK_LIVE ?? "";
const runs = (ai: AiId) => asked === "1" || asked.split(",").includes(ai);
const funnel = createFunnel();
afterAll(() => funnel.close());

/** Plays the user until the task ends: `reply` handles each question or approval once, across runs. */
async function settle(runner: TaskRunner, store: Store, id: string, reply: (t: Task) => Promise<void>): Promise<Task> {
  const handled = new Set<string>();
  for (;;) {
    const t = store.getTask(id);
    if (!t) throw new Error("The task is gone");
    const open = t.question?.id ?? t.approval?.id;
    if (open && !handled.has(open)) {
      handled.add(open);
      await reply(t);
    } else if (!runner.isRunning(id) && ["done", "failed", "stopped"].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 200));
  }
}

for (const ai of SUBSCRIPTIONS) {
  describe.runIf(runs(ai))(`AgentEngine against the real ${ai}`, () => {
    it("makes a file, asks before replacing one, and keeps a copy", { timeout: 600_000 }, async () => {
      const work = await mkdtemp(join(tmpdir(), "tw-live-"));
      const kept = await mkdtemp(join(tmpdir(), "tw-live-kept-"));
      await writeFile(join(work, "notes.txt"), "draft\n");
      const engine = new AgentEngine(funnel, () => "en", { ai: async () => ai });
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
      const { provider, model } = await engine.defaults();
      store.saveProject({ id: "p", name: "Live", description: "", folder: work, instructions: "", createdAt: "" });
      const task = runner.create({
        projectId: "p",
        workdir: work,
        provider,
        model,
        effort: "low",
        brief:
          "Create hello.md with the single line 'hello'. Then replace the whole content of notes.txt with the single line 'final'.",
      });

      runner.launch(task.id);
      const final = await settle(runner, store, task.id, async (t) => {
        if (t.approval) await runner.decide(task.id, true);
        else if (t.question) runner.answer(task.id, t.question.options[0] ?? "Go ahead");
      });
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

    it("waits for an answer as long as it takes, then carries on with it", { timeout: 600_000 }, async () => {
      const work = await mkdtemp(join(tmpdir(), "tw-live-q-"));
      const engine = new AgentEngine(funnel, () => "en", { ai: async () => ai });
      const tools = new ToolServer(engine);
      await tools.start();
      engine.attachTools(tools);
      const store = new Store(":memory:");
      const runner = new TaskRunner(store, engine, () => {});
      const { provider, model } = await engine.defaults();
      store.saveProject({ id: "p", name: "Live", description: "", folder: work, instructions: "", createdAt: "" });
      const task = runner.create({
        projectId: "p",
        workdir: work,
        provider,
        model,
        effort: "low",
        brief:
          "Write goal.md with one line saying the goal of tomorrow's client call. Ask me which goal to pick, with ask_user, before writing anything.",
      });
      runner.launch(task.id);
      const final = await settle(runner, store, task.id, async (t) => {
        // Longer than the 30 seconds after which Codex hands a running tool back to the model.
        await new Promise((r) => setTimeout(r, 45_000));
        expect(store.getTask(task.id)?.question?.id).toBe(t.question?.id);
        expect(store.getTask(task.id)?.files).toEqual([]);
        runner.answer(task.id, "Agree the course dates");
      });
      await tools.stop();
      console.log(JSON.stringify({ status: final.status, messages: final.messages.map((m) => m.text) }, null, 2));
      expect(final.status).toBe("done");
      expect(await readFile(join(work, "goal.md"), "utf8")).toMatch(/dates/i);
    });

    it("searches the web and says where the facts came from", { timeout: 600_000 }, async () => {
      const work = await mkdtemp(join(tmpdir(), "tw-live-web-"));
      const engine = new AgentEngine(funnel, () => "en", { ai: async () => ai });
      const tools = new ToolServer(engine);
      await tools.start();
      engine.attachTools(tools);
      const store = new Store(":memory:");
      const runner = new TaskRunner(store, engine, () => {});
      // The tool server stops even when the run fails, so a failed live test leaves no listener behind.
      try {
        const { provider, model } = await engine.defaults();
        store.saveProject({ id: "p", name: "Live", description: "", folder: work, instructions: "", createdAt: "" });
        const task = runner.create({
          projectId: "p",
          workdir: work,
          provider,
          model,
          effort: "low",
          brief:
            "Search the web for the latest stable release of Node.js. Write node.md with one line: the version number and the link to the page you read. Don't ask me anything.",
        });
        runner.launch(task.id);
        const final = await settle(runner, store, task.id, async (t) => {
          if (t.approval) await runner.decide(task.id, true);
          else if (t.question) runner.answer(task.id, t.question.options[0] ?? "Go ahead");
        });
        const note = await readFile(join(work, "node.md"), "utf8");
        console.log(JSON.stringify({ status: final.status, error: final.error, note }, null, 2));
        expect(final.status).toBe("done");
        expect(note).toMatch(/\d+\.\d+/);
        expect(note).toMatch(/https?:\/\//);
      } finally {
        await tools.stop();
      }
    });
  });
}
