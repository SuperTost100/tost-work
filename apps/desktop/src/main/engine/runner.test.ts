/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { EngineEvent, Task } from "../../shared/model";
import { Store } from "../store/store";
import type { Engine, RunContext } from "./engine";
import { FakeEngine, PROPOSAL_SCRIPT } from "./fake";
import { RESUME_PROMPT, TaskRunner, titleFrom } from "./runner";

function setup() {
  const store = new Store(":memory:");
  const engine = new FakeEngine(PROPOSAL_SCRIPT, 0);
  const seen: Task[] = [];
  let tick = 0;
  const runner = new TaskRunner(
    store,
    engine,
    (t) => seen.push(t),
    () => new Date(Date.UTC(2026, 9, 26, 9, 0, tick++)).toISOString(),
  );
  return { store, runner, seen };
}

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 2));
  if (!check()) throw new Error("timed out");
};

describe("TaskRunner with the fake engine", () => {
  it("pauses on the question, resumes with the answer and finishes with files and a review", async () => {
    const { store, runner } = setup();
    const task = runner.create({
      projectId: null,
      brief: "Write a proposal for Alpi Logistica",
      workdir: "/tmp/project",
    });
    const done = runner.start(task.id);

    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    const waiting = store.getTask(task.id);
    expect(waiting?.question?.options).toHaveLength(3);
    expect(waiting?.files.map((f) => f.path)).toEqual(["/tmp/project/Proposta.docx"]);

    runner.answer(task.id, "Include it in our price");
    const final = await done;

    expect(final.status).toBe("done");
    expect(final.question).toBeNull();
    expect(final.steps.every((s) => s.status === "done")).toBe(true);
    expect(final.files.map((f) => f.path)).toEqual(["/tmp/project/Proposta.docx", "/tmp/project/prezzi.xlsx"]);
    expect(final.review?.checkYourself).toHaveLength(1);
    expect(final.messages.map((m) => m.from)).toEqual(["user", "user", "agent", "agent"]);
  });

  it("stops a task that is waiting for an answer", async () => {
    const { store, runner } = setup();
    const task = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/tmp/p" });
    const done = runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    runner.stop(task.id);
    expect((await done).status).toBe("stopped");
    expect(runner.isRunning(task.id)).toBe(false);
  });

  it("continues a finished task with a follow-up, changing the last file it made", async () => {
    const { store, runner } = setup();
    const task = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/tmp/p" });
    const first = runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    runner.answer(task.id, "The client pays it");
    await first;

    const asked = runner.followUp(task.id, "Make the prices round numbers");
    expect(asked.review).toBeNull();
    const final = await runner.start(task.id, "Make the prices round numbers");

    expect(final.status).toBe("done");
    expect(final.messages.at(-1)?.text).toBe("Done, I made the change.");
    expect(final.files.at(-1)).toEqual({ path: "/tmp/p/prezzi.xlsx", kind: "update", role: "made" });
  });

  it("refuses a follow-up while the task works or waits", async () => {
    const { store, runner } = setup();
    const task = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/tmp/p" });
    const done = runner.start(task.id);
    expect(() => runner.followUp(task.id, "faster")).toThrow(/still working/);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    runner.stop(task.id);
    await done;
    expect(() => runner.followUp(task.id, "go on")).not.toThrow();
  });

  it("edits the copies a quick edit was given and leaves a review", async () => {
    const { runner } = setup();
    const task = runner.create({
      projectId: null,
      brief: "Fix the typos",
      workdir: "/tmp/q",
      attachments: ["/tmp/q/letter.docx"],
    });
    const final = await runner.start(task.id);
    expect(final.status).toBe("done");
    expect(final.files).toEqual([{ path: "/tmp/q/letter.docx", kind: "update", role: "made" }]);
    expect(final.review?.decided).toHaveLength(1);
  });

  it("refuses an answer when no question is open", () => {
    const { runner } = setup();
    const task = runner.create({ projectId: null, brief: "Hello", workdir: "/tmp/p" });
    expect(() => runner.answer(task.id, "yes")).toThrow(/isn't waiting/);
  });
});

describe("titleFrom", () => {
  it("uses the first line and cuts long ones at a word", () => {
    expect(titleFrom("Fix the typos\nand more")).toBe("Fix the typos");
    // The cut lands on "from", which may be a partial word, so it goes too.
    expect(titleFrom("Write a proposal for Alpi Logistica from yesterday's call notes using our template", 40)).toBe(
      "Write a proposal for Alpi Logistica…",
    );
  });
});

describe("TaskRunner notifications", () => {
  it("finishes the task even when the change callback throws", async () => {
    const store = new Store(":memory:");
    const engine = new FakeEngine({ ...PROPOSAL_SCRIPT, question: undefined }, 0);
    const runner = new TaskRunner(store, engine, () => {
      throw new Error("Object has been destroyed");
    });
    const task = runner.create({
      projectId: null,
      brief: "Write a proposal",
      workdir: "/tmp/p",
      attachments: ["/notes.docx"],
    });
    const final = await runner.start(task.id);
    expect(final.status).toBe("done");
    expect(store.getTask(task.id)?.attachments).toEqual(["/notes.docx"]);
  });
});

describe("TaskRunner when saving fails", () => {
  const brokenSetup = () => {
    const store = new Store(":memory:");
    const runner = new TaskRunner(store, new FakeEngine(PROPOSAL_SCRIPT, 0), () => {});
    const task = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/tmp/p" });
    const save = store.saveTask.bind(store);
    return { store, runner, task, save };
  };

  it("doesn't leave the task marked as running when the first save fails", async () => {
    const { store, runner, task, save } = brokenSetup();
    store.saveTask = (t) => {
      if (t.status === "running") throw new Error("disk full");
      save(t);
    };
    const final = await runner.start(task.id);
    expect(final.status).toBe("failed");
    expect(final.error).toBe("disk full");
    expect(runner.isRunning(task.id)).toBe(false);
  });

  it("logs, instead of rejecting, when even the failure can't be saved", async () => {
    const { store, runner, task } = brokenSetup();
    store.saveTask = () => {
      throw new Error("disk gone");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    runner.launch(task.id);
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(String(log.mock.calls[0]?.[1])).toMatch(/disk gone/);
    expect(runner.isRunning(task.id)).toBe(false);
    log.mockRestore();
  });
});

/**
 * An engine like Codex: the agent asks, ends its turn, and the user's reply starts the next run. Each run plays the
 * next step of the script; `hold` keeps a run open until released, as when the agent is still ending its turn.
 */
function turnTaking(steps: ((ctx: RunContext) => EngineEvent[])[]) {
  const prompts: (string | null)[] = [];
  let release: (() => void) | null = null;
  const engine: Engine = {
    defaults: async () => ({ provider: "codex", model: "m", effort: "low" }),
    async *run(ctx) {
      prompts.push(ctx.followUp);
      const step = steps.shift();
      for (const e of step?.(ctx) ?? []) yield e;
      if (holding) await new Promise<void>((r) => (release = r));
      // Codex ends every run with done, even one whose agent ended its turn to wait.
      yield { type: "done" };
    },
    answer: () => false,
    decide: () => false,
  };
  let holding = false;
  const store = new Store(":memory:");
  const statuses: string[] = [];
  const runner = new TaskRunner(store, engine, (t) => statuses.push(t.status), undefined, {
    keep: async (_t, path) => ({ path, copy: `/k${path}`, at: "", reason: "overwrite" }),
    trash: async () => {},
    restore: async () => {},
  });
  const task = runner.create({ projectId: null, brief: "Prepare the call", workdir: "/w" });
  return {
    store,
    runner,
    task,
    prompts,
    statuses,
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      release?.();
    },
  };
}

const asks = (): EngineEvent[] => [
  { type: "question", question: { id: "q1", text: "Which goal?", options: ["A", "B"] } },
];

describe("TaskRunner when the agent ends its turn to wait", () => {
  it("keeps the task waiting, and the answer starts the next run as a message", async () => {
    const { store, runner, task, prompts } = turnTaking([asks, () => [{ type: "message", text: "Done." }]]);
    const first = await runner.start(task.id);
    expect(first.status).toBe("needs-you");
    expect(first.question?.text).toBe("Which goal?");

    runner.answer(task.id, "B");
    await waitFor(() => store.getTask(task.id)?.status === "done");
    expect(prompts).toEqual([null, 'My answer to your question "Which goal?": B']);
    expect(store.getTask(task.id)?.messages.map((m) => m.text)).toEqual(["Prepare the call", "B", "Done."]);
  });

  it("sends a late decision to the next run, after keeping the copy", async () => {
    const approval = { id: "a1", action: "overwrite" as const, paths: ["/w/plan.xlsx"] };
    const { store, runner, task, prompts } = turnTaking([() => [{ type: "approval", approval }], () => []]);
    expect((await runner.start(task.id)).status).toBe("needs-you");
    await runner.decide(task.id, true);
    await waitFor(() => store.getTask(task.id)?.status === "done");
    expect(prompts[1]).toMatch(/allowed replacing \/w\/plan\.xlsx.*kept a copy/);
    expect(store.getTask(task.id)?.kept?.[0]?.path).toBe("/w/plan.xlsx");
  });

  it("holds an answer that comes while the turn is still ending, then sends it", async () => {
    const { store, runner, task, prompts, statuses, hold, release } = turnTaking([asks, () => []]);
    hold();
    const first = runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    runner.answer(task.id, "A");
    expect(prompts).toHaveLength(1);
    const answered = statuses.length;
    release();
    await first;
    await waitFor(() => store.getTask(task.id)?.status === "done");
    expect(prompts).toEqual([null, 'My answer to your question "Which goal?": A']);
    // The first run's end doesn't show the task as done while the answer waits for the next run.
    const between = statuses.slice(answered, statuses.lastIndexOf("done"));
    expect(between).not.toContain("done");
  });

  it("resumes a task Tost Work closed on, in its conversation or from the brief", async () => {
    const { store, runner, task, prompts } = turnTaking([() => [], () => [], () => [], () => []]);
    expect(() => runner.resume(task.id)).toThrow(/Only a task stopped by closing/);

    // Closed before the agent's first answer: no conversation yet, so the brief runs again.
    store.saveTask({ ...task, status: "running" });
    store.stopInterrupted("2026-10-27T00:00:00Z");
    expect(store.getTask(task.id)).toMatchObject({ status: "stopped", interrupted: true });
    runner.resume(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "done");
    expect(prompts).toEqual([null]);
    expect(store.getTask(task.id)?.interrupted).toBeUndefined();

    // A resume that fails before the run starts, as offline, stays resumable and says why.
    const offline: Engine = {
      defaults: async () => ({ provider: "codex", model: "m", effort: "low" }),
      // biome-ignore lint/correctness/useYield: it fails before its first event, as the engine does offline.
      async *run() {
        throw new Error("Tost Work can't reach ChatGPT.");
      },
      answer: () => false,
      decide: () => false,
    };
    store.saveTask({ ...(store.getTask(task.id) as Task), status: "running" });
    store.stopInterrupted("2026-10-27T00:00:00Z");
    await new TaskRunner(store, offline, () => {}).start(task.id);
    expect(store.getTask(task.id)).toMatchObject({
      status: "stopped",
      interrupted: true,
      error: "Tost Work can't reach ChatGPT.",
    });
    // Back online, Resume works.
    runner.resume(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "done");
    expect(store.getTask(task.id)?.interrupted).toBeUndefined();
    expect(store.getTask(task.id)?.error).toBeNull();

    // Not while a kept copy is being put back: the run could write the same file.
    const gate: { finish: (() => void) | null } = { finish: null };
    const idle: Engine = {
      defaults: async () => ({ provider: "codex", model: "m", effort: "low" }),
      async *run() {},
      answer: () => false,
      decide: () => false,
    };
    const slow = new TaskRunner(store, idle, () => {}, undefined, {
      keep: async () => null as never,
      trash: async () => {},
      restore: () => new Promise<void>((r) => (gate.finish = r)),
    });
    store.saveTask({
      ...(store.getTask(task.id) as Task),
      status: "stopped",
      interrupted: true,
      kept: [{ path: "/w/a.docx", copy: "/k/a.docx", at: "", reason: "overwrite" }],
    });
    const restoring = slow.restore(task.id, "/w/a.docx");
    expect(() => slow.resume(task.id)).toThrow(/Wait for the restore/);
    await waitFor(() => gate.finish !== null);
    gate.finish?.();
    await restoring;

    // Closed mid-conversation: the agent hears why it stopped and carries on.
    store.saveTask({ ...(store.getTask(task.id) as Task), sessionId: "s1", status: "running" });
    store.stopInterrupted("2026-10-27T00:00:01Z");
    runner.resume(task.id);
    await waitFor(() => prompts.length === 3 && store.getTask(task.id)?.status === "done");
    expect(prompts).toEqual([null, null, RESUME_PROMPT]);
  });

  it("stops a task that waits with no run left", async () => {
    const { store, runner, task, prompts } = turnTaking([asks]);
    await runner.start(task.id);
    runner.stop(task.id);
    expect(store.getTask(task.id)).toMatchObject({ status: "stopped", question: null });
    expect(prompts).toHaveLength(1);
  });
});

describe("renaming and deleting tasks", () => {
  it("renames without moving the task in Recent, and refuses an empty name", async () => {
    const { store, runner, task } = turnTaking([]);
    const before = store.getTask(task.id)?.updatedAt;
    expect(runner.rename(task.id, "  Call notes  ").title).toBe("Call notes");
    expect(store.getTask(task.id)?.updatedAt).toBe(before);
    expect(() => runner.rename(task.id, "   ")).toThrow(/name/);
  });

  it("refuses to delete a running task, and deletes it once it's done", async () => {
    const { store, runner, task, hold, release } = turnTaking([() => []]);
    hold();
    const run = runner.start(task.id);
    await waitFor(() => runner.isRunning(task.id));
    expect(() => runner.remove(task.id)).toThrow(/Stop the task/);
    release();
    await run;
    runner.remove(task.id);
    expect(store.getTask(task.id)).toBeUndefined();
  });
});

describe("a rename while the run ends", () => {
  it("keeps the new name when the engine ends without a last event", async () => {
    let release: () => void = () => {};
    const engine: Engine = {
      defaults: async () => ({ provider: "codex", model: "m", effort: "low" }),
      // Ends without yielding anything, as an engine may.
      async *run() {
        await new Promise<void>((r) => (release = r));
      },
      answer: () => false,
      decide: () => false,
    };
    const store = new Store(":memory:");
    const runner = new TaskRunner(store, engine, () => {});
    const task = runner.create({ projectId: null, brief: "Prepare the call", workdir: "/w" });
    const run = runner.start(task.id);
    await waitFor(() => runner.isRunning(task.id));
    runner.rename(task.id, "Call notes");
    release();
    const final = await run;
    expect(final).toMatchObject({ status: "done", title: "Call notes" });
    expect(store.getTask(task.id)?.title).toBe("Call notes");
  });
});
