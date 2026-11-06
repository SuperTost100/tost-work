/** @vitest-environment node */
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createFunnel } from "cli-funnel";
import { afterAll, describe, expect, it } from "vitest";
import { type AiId, questionItems, SUBSCRIPTIONS, type Task } from "../../shared/model";
import { giveAgentsOwnHomes } from "../agentHomes";
import { fileGuard } from "../guard";
import { ToolServer } from "../mcp/server";
import { Store } from "../store/store";
import { AgentEngine } from "./agent";
import { TaskRunner } from "./runner";

// Runs real tasks on the signed-in Codex and Claude Code. They spend a little of each account's usage, so they run
// only when asked: TOST_WORK_LIVE=1 for both, or a list such as TOST_WORK_LIVE=claude.
const asked = process.env.TOST_WORK_LIVE ?? "";
// TOST_WORK_LIVE_HOMES=<folder> runs the CLIs in their own homes there, as the app does, so the tester's own
// instructions, skills and MCP servers stay out. The folder needs a copy of each CLI's sign-in.
if (process.env.TOST_WORK_LIVE_HOMES) giveAgentsOwnHomes(process.env.TOST_WORK_LIVE_HOMES);
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
        if (t.approval) await runner.decide(task.id, "allow");
        else if (t.question)
          runner.answer(
            task.id,
            questionItems(t.question).map((q) => q.options[0] ?? "Go ahead"),
          );
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

    it("writes a new review after a follow-up that changes a file", { timeout: 600_000 }, async () => {
      const work = await mkdtemp(join(tmpdir(), "tw-live-r-"));
      const kept = await mkdtemp(join(tmpdir(), "tw-live-r-kept-"));
      const engine = new AgentEngine(funnel, () => "en", { ai: async () => ai });
      const tools = new ToolServer(engine);
      await tools.start();
      engine.attachTools(tools);
      const store = new Store(":memory:");
      // An agent that asks before changing hello.md gets a yes, and the guard keeps a copy as the app does.
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
        brief: "Create hello.md with the single line 'hello'.",
      });
      const go = async (t: Task) => {
        if (t.approval) await runner.decide(task.id, "allow");
        else if (t.question)
          runner.answer(
            task.id,
            questionItems(t.question).map((q) => q.options[0] ?? "Go ahead"),
          );
      };
      runner.launch(task.id);
      const first = await settle(runner, store, task.id, go);
      expect(first.review).not.toBeNull();
      const text = "Add a second line 'world' to hello.md.";
      runner.followUp(task.id, text);
      runner.launch(task.id, text);
      const final = await settle(runner, store, task.id, go);
      await tools.stop();
      console.log(JSON.stringify({ status: final.status, review: final.review }, null, 2));
      expect(final.status).toBe("done");
      expect(await readFile(join(work, "hello.md"), "utf8")).toMatch(/world/);
      expect(final.review).not.toBeNull();
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
        runner.answer(task.id, ["Agree the course dates"]);
      });
      await tools.stop();
      console.log(JSON.stringify({ status: final.status, messages: final.messages.map((m) => m.text) }, null, 2));
      expect(final.status).toBe("done");
      expect(await readFile(join(work, "goal.md"), "utf8")).toMatch(/dates/i);
    });

    it("keeps a shell command's writes inside the task's folder", { timeout: 600_000 }, async () => {
      const work = await mkdtemp(join(tmpdir(), "tw-live-sb-"));
      // Outside the folder and outside the temp folders a sandbox lets commands write to.
      const outside = await mkdtemp(join(homedir(), ".tw-live-outside-"));
      const engine = new AgentEngine(funnel, () => "en", { ai: async () => ai });
      const tools = new ToolServer(engine);
      await tools.start();
      engine.attachTools(tools);
      const store = new Store(":memory:");
      const runner = new TaskRunner(store, engine, () => {});
      try {
        const { provider, model } = await engine.defaults();
        store.saveProject({ id: "p", name: "Live", description: "", folder: work, instructions: "", createdAt: "" });
        const task = runner.create({
          projectId: "p",
          workdir: work,
          provider,
          model,
          effort: "low",
          brief: `I'm testing the sandbox. With your shell tool, run exactly: printf x > '${join(outside, "escaped.txt")}' ; printf y > inside.txt\nThen tell me in one line what each command did. Don't ask me anything and don't try another way.`,
        });
        runner.launch(task.id);
        const final = await settle(runner, store, task.id, async (t) => {
          if (t.approval) await runner.decide(task.id, "allow");
          else if (t.question)
            runner.answer(
              task.id,
              questionItems(t.question).map((q) => q.options[0] ?? "Go ahead"),
            );
        });
        console.log(
          JSON.stringify(
            { status: final.status, error: final.error, messages: final.messages.map((m) => m.text) },
            null,
            2,
          ),
        );
        expect(final.status).toBe("done");
        await expect(access(join(outside, "escaped.txt"))).rejects.toThrow();
        // The sandbox still lets commands write inside the folder.
        expect(await readFile(join(work, "inside.txt"), "utf8")).toBe("y");
      } finally {
        await tools.stop();
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("answers a request to take stock in the chat, and offers a file instead of making one", {
      timeout: 600_000,
    }, async () => {
      const work = await mkdtemp(join(tmpdir(), "tw-live-chat-"));
      await writeFile(
        join(work, "call-filippo.txt"),
        "Call with Filippo, 27 Oct: he wants the course material by Friday. Next call on Friday at 10.\n",
      );
      await writeFile(
        join(work, "call-engineers.txt"),
        "Call with the engineers' association, 27 Oct: they propose two dates in November; I must answer by Thursday.\n",
      );
      const engine = new AgentEngine(funnel, () => "en", { ai: async () => ai });
      const tools = new ToolServer(engine);
      await tools.start();
      engine.attachTools(tools);
      const store = new Store(":memory:");
      const words: string[] = [];
      const runner = new TaskRunner(
        store,
        engine,
        () => {},
        undefined,
        undefined,
        (_id, text) => words.push(text),
      );
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
            "Today I had both calls, with Filippo and with the engineers' association. Help me sort things out and take stock.",
        });
        runner.launch(task.id);
        const final = await settle(runner, store, task.id, async (t) => {
          if (t.approval) await runner.decide(task.id, "refuse");
          else if (t.question)
            runner.answer(
              task.id,
              questionItems(t.question).map((q) => q.options[0] ?? "Nothing else"),
            );
        });
        console.log(
          JSON.stringify(
            { status: final.status, files: final.files, messages: final.messages.map((m) => m.text) },
            null,
            2,
          ),
        );
        expect(final.status).toBe("done");
        expect(final.files.filter((f) => f.role === "made")).toEqual([]);
        expect(final.messages.at(-1)?.text).toMatch(/Friday/);
        expect(final.messages.at(-1)?.text).toMatch(/Word|Excel|file|document/i);
        // The answer came in pieces as it was written, and they add up to it.
        const answer = final.messages.at(-1)?.text;
        expect(answer).toBeTruthy();
        expect(words.length).toBeGreaterThan(3);
        expect(words.join("").replace(/\s+/g, " ")).toContain(String(answer).replace(/\s+/g, " ").slice(0, 80));
      } finally {
        await tools.stop();
      }
    });

    it("runs a job's task without asking, saving a dated file in the job's folder", { timeout: 600_000 }, async () => {
      const work = await mkdtemp(join(tmpdir(), "tw-live-job-"));
      await writeFile(join(work, "proposals.txt"), "Rossi: sent 1 Oct, no answer\nBianchi: sent 20 Oct, answered\n");
      const job = { title: "Follow-up check", output: "Follow-ups" };
      const engine = new AgentEngine(funnel, () => "en", { ai: async () => ai, job: () => job });
      const tools = new ToolServer(engine);
      await tools.start();
      engine.attachTools(tools);
      const store = new Store(":memory:");
      const runner = new TaskRunner(store, engine, () => {});
      try {
        const { provider, model } = await engine.defaults();
        store.saveProject({ id: "p", name: "Live", description: "", folder: work, instructions: "", createdAt: "" });
        const task = runner.create({
          projectId: "p",
          workdir: work,
          provider,
          model,
          effort: "low",
          jobId: "j",
          title: "Follow-up check",
          brief: "List the proposals with no answer in a short plain text file (.txt).",
        });
        runner.launch(task.id);
        const asked: string[] = [];
        const final = await settle(runner, store, task.id, async (t) => {
          if (t.question) asked.push(t.question.text);
          if (t.approval) await runner.decide(task.id, "refuse");
          else if (t.question)
            runner.answer(
              task.id,
              questionItems(t.question).map((q) => q.options[0] ?? "Go ahead"),
            );
        });
        const made = final.files.filter((f) => f.role === "made").map((f) => f.path);
        console.log(
          JSON.stringify({ status: final.status, asked, made, messages: final.messages.map((m) => m.text) }, null, 2),
        );
        expect(final.status).toBe("done");
        expect(asked).toEqual([]);
        const now = new Date();
        const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
          .map((n) => String(n).padStart(2, "0"))
          .join("-");
        const dated = made.find(
          (p) => p.startsWith(join(work, "Follow-ups")) && p.includes(today) && p.endsWith(".txt"),
        );
        expect(dated).toBeDefined();
        // The list itself: the proposal with no answer, and not the one that was answered.
        const list = await readFile(dated ?? "", "utf8");
        expect(list).toMatch(/Rossi/);
        expect(list).not.toMatch(/Bianchi/);
      } finally {
        await tools.stop();
      }
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
          if (t.approval) await runner.decide(task.id, "allow");
          else if (t.question)
            runner.answer(
              task.id,
              questionItems(t.question).map((q) => q.options[0] ?? "Go ahead"),
            );
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
