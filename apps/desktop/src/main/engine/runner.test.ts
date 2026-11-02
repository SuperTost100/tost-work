/** @vitest-environment node */
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EngineEvent, Task } from "../../shared/model";
import { Store } from "../store/store";
import { UserError } from "../userError";
import type { Engine, RunContext } from "./engine";
import { FakeEngine, PROPOSAL_SCRIPT } from "./fake";
import { RESUME_PROMPT, TaskRunner, titleFrom, withFiles } from "./runner";

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

    runner.answer(task.id, ["Include it in our price"]);
    const final = await done;

    expect(final.status).toBe("done");
    expect(final.question).toBeNull();
    expect(final.steps.every((s) => s.status === "done")).toBe(true);
    expect(final.files.map((f) => f.path)).toEqual(["/tmp/project/Proposta.docx", "/tmp/project/prezzi.xlsx"]);
    expect(final.review?.checkYourself).toHaveLength(1);
    expect(final.messages.map((m) => m.from)).toEqual(["user", "user", "agent", "agent"]);
  });

  it("writes the task's start, answer and end to the app's debug log", async () => {
    const store = new Store(":memory:");
    const lines: string[] = [];
    const runner = new TaskRunner(
      store,
      new FakeEngine(PROPOSAL_SCRIPT, 0),
      () => {},
      undefined,
      undefined,
      undefined,
      (level, message) => lines.push(`${level} ${message}`),
    );
    const task = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/tmp/p" });
    const done = runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    runner.answer(task.id, ["The client pays it"]);
    await done;
    expect(lines).toEqual([
      `info Task ${task.id} started its first run`,
      `info Task ${task.id} answered its question`,
      `info Task ${task.id} run ended: done`,
    ]);
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
    runner.answer(task.id, ["The client pays it"]);
    await first;

    expect(store.getTask(task.id)?.activity?.[1]).toMatchObject({ kind: "read", target: "call-notes.txt" });
    const asked = runner.followUp(task.id, "Make the prices round numbers");
    expect(asked.review).toBeNull();
    // The earlier run's activity stays, shown where it happened.
    expect(asked.activity?.[1]).toMatchObject({ kind: "read", target: "call-notes.txt" });
    const final = await runner.start(task.id, "Make the prices round numbers");

    expect(final.status).toBe("done");
    expect(final.messages.at(-1)?.text).toBe("Done, I made the change.");
    expect(final.files.at(-1)).toEqual({ path: "/tmp/p/prezzi.xlsx", kind: "update", role: "made" });
  });

  it("keeps files attached to answers and follow-ups with their message and the task's files", async () => {
    const { store, runner } = setup();
    const task = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/tmp/p" });
    expect(task.messages[0]?.attachments).toBeUndefined();
    const first = runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    const answered = runner.answer(task.id, ["The client pays it"], ["/prices.xlsx"]);
    expect(answered.messages.at(-1)?.attachments).toEqual(["/prices.xlsx"]);
    expect(answered.attachments).toEqual(["/prices.xlsx"]);
    await first;
    // A file sent twice is the task's once.
    const asked = runner.followUp(task.id, "Use the new logo", ["/logo.png", "/prices.xlsx"]);
    expect(asked.messages.at(-1)).toMatchObject({ followUp: true, attachments: ["/logo.png", "/prices.xlsx"] });
    expect(asked.attachments).toEqual(["/prices.xlsx", "/logo.png"]);
    // Without files, the message carries none.
    await runner.start(task.id, "Use the new logo");
    expect(runner.followUp(task.id, "Thanks").messages.at(-1)?.attachments).toBeUndefined();
  });

  it("keeps the brief's files on the first message", () => {
    const { runner } = setup();
    const task = runner.create({ projectId: "p", brief: "Sum it up", workdir: "/tmp/p", attachments: ["/notes.docx"] });
    expect(task.messages[0]?.attachments).toEqual(["/notes.docx"]);
  });

  it("tells the agent which files came with a message", () => {
    expect(withFiles("Use the new logo", [])).toBe("Use the new logo");
    expect(withFiles("Use the new logo", ["/Users/g/logo.png"])).toBe(
      "Use the new logo\n\nFiles I attached to this message:\n- /Users/g/logo.png",
    );
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
    expect(() => runner.answer(task.id, ["yes"])).toThrow(/isn't waiting/);
  });
});

describe("TaskRunner when a run fails with a message for the user", () => {
  it("saves the failure in the app's language", async () => {
    const store = new Store(":memory:");
    const engine: Engine = {
      defaults: async () => ({ provider: "codex", model: "m", effort: "low" }),
      choices: async () => ({ ai: "chatgpt", provider: "codex", lists: [] }),
      // It fails before its first event, as the engine does when the key is gone.
      run: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new UserError("error.taskKeyGone")) }),
      }),
      answer: () => false,
      decide: () => false,
    };
    const runner = new TaskRunner(
      store,
      engine,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      () => "it",
    );
    const task = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/tmp/p" });
    await runner.start(task.id);
    expect(store.getTask(task.id)).toMatchObject({
      status: "failed",
      error: "Questa attività usava la chiave del corso, che non c'è più. Incollala di nuovo in Impostazioni.",
    });
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

describe("TaskRunner with an answer as it's written", () => {
  it("passes the words on without saving them, keeps them as the draft, and drops it with the message", async () => {
    const store = new Store(":memory:");
    const saves: Task[] = [];
    const words: string[] = [];
    let draftBeforeMessage = "";
    let runner: TaskRunner;
    const engine = {
      defaults: async () => ({ provider: "codex", model: "m", effort: "e" }),
      async *run(ctx: RunContext): AsyncIterable<EngineEvent> {
        yield { type: "text", text: "Both calls " };
        yield { type: "text", text: "went well." };
        draftBeforeMessage = runner.draft(ctx.task.id);
        yield { type: "message", text: "Both calls went well." };
      },
      answer: () => false,
      decide: () => false,
    } as unknown as Engine;
    runner = new TaskRunner(
      store,
      engine,
      (t) => saves.push(t),
      undefined,
      undefined,
      (_id, text) => words.push(text),
    );
    const task = runner.create({ projectId: null, brief: "Sum up", workdir: "/tmp/p", attachments: [] });
    const final = await runner.start(task.id);
    expect(words).toEqual(["Both calls ", "went well."]);
    expect(draftBeforeMessage).toBe("Both calls went well.");
    expect(runner.draft(task.id)).toBe("");
    expect(final.messages.at(-1)?.text).toBe("Both calls went well.");
    // Saved when made, at the start, for the message and at the end: never for a word.
    expect(saves.map((t) => t.status)).toEqual(["draft", "running", "running", "done"]);
  });
});

describe("TaskRunner with a note between steps", () => {
  it("keeps the note in the activity and starts the next words as a new draft, in the window too", async () => {
    const store = new Store(":memory:");
    const heard: [string, boolean | undefined][] = [];
    let draftAfterNote = "";
    let runner: TaskRunner;
    const engine = {
      defaults: async () => ({ provider: "claude", model: "m", effort: "e" }),
      async *run(ctx: RunContext): AsyncIterable<EngineEvent> {
        yield { type: "text", text: "Reading the notes." };
        yield { type: "activity", kind: "note", target: "Reading the notes." };
        yield { type: "text", text: "Done." };
        draftAfterNote = runner.draft(ctx.task.id);
        yield { type: "message", text: "Done." };
      },
      answer: () => false,
      decide: () => false,
    } as unknown as Engine;
    runner = new TaskRunner(
      store,
      engine,
      () => {},
      undefined,
      undefined,
      (_id, text, restart) => heard.push([text, restart]),
    );
    const task = runner.create({ projectId: null, brief: "Sum up", workdir: "/tmp/p", attachments: [] });
    const final = await runner.start(task.id);
    expect(heard).toEqual([
      ["Reading the notes.", undefined],
      ["", true],
      ["Done.", undefined],
    ]);
    expect(draftAfterNote).toBe("Done.");
    expect(final.activity?.map((a) => [a.kind, a.target])).toEqual([["note", "Reading the notes."]]);
  });
});

describe("TaskRunner when passing on words fails", () => {
  it("still finishes the task with the whole answer", async () => {
    const store = new Store(":memory:");
    const runner = new TaskRunner(
      store,
      new FakeEngine({ ...PROPOSAL_SCRIPT, question: undefined }, 0),
      () => {},
      undefined,
      undefined,
      () => {
        throw new Error("Object has been destroyed");
      },
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const task = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/tmp/p", attachments: [] });
    const final = await runner.start(task.id);
    expect(final.status).toBe("done");
    expect(final.messages.at(-1)?.text).toBe(PROPOSAL_SCRIPT.summary);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
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
function turnTaking(
  steps: ((ctx: RunContext) => EngineEvent[])[],
  trash: (path: string) => Promise<void> = async () => {},
) {
  const prompts: (string | null)[] = [];
  let release: (() => void) | null = null;
  const engine: Engine = {
    defaults: async () => ({ provider: "codex", model: "m", effort: "low" }),
    choices: async () => ({ ai: "chatgpt", provider: "codex", lists: [] }),
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
    trash: async (_t, path) => trash(path),
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

    runner.answer(task.id, ["B"]);
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

  it("allows deleting a file that's already gone, and trashes the others", async () => {
    const approval = { id: "a1", action: "delete" as const, paths: ["/w/gone.txt", "/w/old.txt", "/w/made.txt"] };
    const trashed: string[] = [];
    const made = {
      type: "file" as const,
      change: { path: "/w/made.txt", kind: "add" as const, role: "made" as const },
    };
    const { store, runner, task } = turnTaking(
      [() => [made, { type: "approval", approval }], () => []],
      async (path) => {
        if (path.endsWith("gone.txt") || path.endsWith("made.txt"))
          throw Object.assign(new Error(`ENOENT: no such file or directory, realpath '${path}'`), { code: "ENOENT" });
        trashed.push(path);
      },
    );
    await runner.start(task.id);
    await runner.decide(task.id, true);
    await waitFor(() => store.getTask(task.id)?.status === "done");
    expect(trashed).toEqual(["/w/old.txt"]);
    // A file the task made and that's gone now shows as deleted; one it never had isn't added.
    expect(store.getTask(task.id)?.files.map((f) => [f.path, f.kind])).toEqual([
      ["/w/old.txt", "delete"],
      ["/w/made.txt", "delete"],
    ]);
  });

  it("doesn't take a link to a missing file for a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tw-runner-link-"));
    const link = join(dir, "link.txt");
    await symlink(join(dir, "nowhere.txt"), link);
    const approval = { id: "a1", action: "delete" as const, paths: [link] };
    const { runner, task } = turnTaking([() => [{ type: "approval", approval }], () => []], async (path) => {
      throw Object.assign(new Error(`ENOENT: no such file or directory, realpath '${path}'`), { code: "ENOENT" });
    });
    await runner.start(task.id);
    await expect(runner.decide(task.id, true)).rejects.toThrow(/ENOENT/);
  });

  it("holds an answer that comes while the turn is still ending, then sends it", async () => {
    const { store, runner, task, prompts, statuses, hold, release } = turnTaking([asks, () => []]);
    hold();
    const first = runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    runner.answer(task.id, ["A"]);
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

  it("sends a round's answers under their questions", async () => {
    const round = (): EngineEvent[] => [
      {
        type: "question",
        question: {
          id: "r1",
          text: "Which goal?",
          options: ["A", "B"],
          more: [{ text: "When?", options: ["Now", "Later"] }],
        },
      },
    ];
    const { store, runner, task, prompts } = turnTaking([round, () => [{ type: "message", text: "Done." }]]);
    runner.launch(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    runner.answer(task.id, ["B", "Later"]);
    await waitFor(() => store.getTask(task.id)?.status === "done");
    expect(prompts[1]).toBe(
      "My answers to your questions, each under its question:\n\nWhich goal?\n→ B\n\nWhen?\n→ Later",
    );
    // The task keeps each answer with its question, for the line that opens on the task screen.
    expect(store.getTask(task.id)?.messages.at(-2)?.answers).toEqual([
      { question: "Which goal?", answer: "B" },
      { question: "When?", answer: "Later" },
    ]);
  });

  it("refuses a round with an answer missing", async () => {
    const round = (): EngineEvent[] => [
      {
        type: "question",
        question: { id: "r1", text: "Which goal?", options: ["A", "B"], more: [{ text: "When?", options: ["Now"] }] },
      },
    ];
    const { store, runner, task } = turnTaking([round]);
    runner.launch(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    expect(() => runner.answer(task.id, ["B"])).toThrow(/one answer per question/);
    expect(store.getTask(task.id)?.question?.id).toBe("r1");
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
      choices: async () => ({ ai: "chatgpt", provider: "codex", lists: [] }),
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
      choices: async () => ({ ai: "chatgpt", provider: "codex", lists: [] }),
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

describe("stopping a project's tasks", () => {
  it("stops the working and the waiting ones and waits for their runs, so none comes back after the delete", async () => {
    const { store, runner } = setup();
    store.saveProject({ id: "p", name: "P", description: "", folder: "/p", instructions: "", createdAt: "2026-10-01" });
    const mine = runner.create({ projectId: "p", brief: "Write a proposal", workdir: "/p" });
    const other = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/q" });
    const runs = [runner.start(mine.id), runner.start(other.id)];
    await waitFor(() => store.getTask(mine.id)?.status === "needs-you");

    await runner.stopProject("p");
    expect(runner.isRunning(mine.id)).toBe(false);
    expect(store.getTask(mine.id)?.status).toBe("stopped");
    // Another project's task is not touched.
    expect(runner.isRunning(other.id)).toBe(true);

    store.removeProject("p");
    runner.stop(other.id);
    await Promise.all(runs);
    expect(store.getTask(mine.id)).toBeUndefined();
    expect(store.getTask(other.id)).toBeDefined();
  });
  it("won't remove a project while one of its done tasks puts a file back, and takes tasks again after", async () => {
    const store = new Store(":memory:");
    store.saveProject({ id: "p", name: "P", description: "", folder: "/p", instructions: "", createdAt: "2026-10-01" });
    const gate: { finish: (() => void) | null } = { finish: null };
    const idle: Engine = {
      defaults: async () => ({ provider: "codex", model: "m", effort: "low" }),
      choices: async () => ({ ai: "chatgpt", provider: "codex", lists: [] }),
      async *run() {},
      answer: () => false,
      decide: () => false,
    };
    const runner = new TaskRunner(store, idle, () => {}, undefined, {
      keep: async () => null as never,
      trash: async () => {},
      restore: () => new Promise<void>((r) => (gate.finish = r)),
    });
    const task = runner.create({ projectId: "p", brief: "Write a proposal", workdir: "/p" });
    store.saveTask({
      ...(store.getTask(task.id) as Task),
      status: "done",
      kept: [{ path: "/p/a.docx", copy: "/k/a.docx", at: "", reason: "overwrite" }],
    });
    const restoring = runner.restore(task.id, "/p/a.docx");
    await waitFor(() => gate.finish !== null);
    await expect(runner.stopProject("p")).rejects.toThrow(/saving its files/);
    // Called off, so the project still takes tasks.
    expect(runner.create({ projectId: "p", brief: "Another", workdir: "/p" }).id).toBeTruthy();
    gate.finish?.();
    await restoring;
  });

  it("takes no new task for a project while it's being removed", async () => {
    const { store, runner } = setup();
    store.saveProject({ id: "p", name: "P", description: "", folder: "/p", instructions: "", createdAt: "2026-10-01" });
    const done = runner.create({ projectId: "p", brief: "Write a proposal", workdir: "/p" });
    store.saveTask({
      ...(store.getTask(done.id) as Task),
      status: "done",
      kept: [{ path: "/p/a.docx", copy: "/k/a.docx", at: "", reason: "overwrite" }],
    });
    await runner.stopProject("p");
    expect(() => runner.create({ projectId: "p", brief: "Write a proposal", workdir: "/p" })).toThrow(/doesn't exist/);
    // Another project still takes them.
    expect(runner.create({ projectId: null, brief: "Write a proposal", workdir: "/q" }).id).toBeTruthy();

    // Nor a file put back, which would save its task again.
    await expect(runner.restore(done.id, "/p/a.docx")).rejects.toThrow(/being removed/);
    runner.projectStays("p");
    expect(runner.create({ projectId: "p", brief: "Write a proposal", workdir: "/p" }).id).toBeTruthy();
  });
});

describe("a rename while the run ends", () => {
  it("keeps the new name when the engine ends without a last event", async () => {
    let release: () => void = () => {};
    const engine: Engine = {
      defaults: async () => ({ provider: "codex", model: "m", effort: "low" }),
      choices: async () => ({ ai: "chatgpt", provider: "codex", lists: [] }),
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

describe("tasks saved for later", () => {
  type Defaults = Awaited<ReturnType<Engine["defaults"]>>;
  const counting = () => {
    const runs: string[] = [];
    const picks: unknown[] = [];
    let defaults: Defaults = { provider: "claude", auth: "key", model: "sonnet", effort: "high" };
    const engine: Engine = {
      defaults: async (pick) => {
        picks.push(pick);
        return defaults;
      },
      choices: async () => ({ ai: "chatgpt", provider: "codex", lists: [] }),
      async *run({ task }: RunContext) {
        runs.push(task.id);
        yield { type: "done" } satisfies EngineEvent;
      },
      answer: () => false,
      decide: () => false,
    };
    const store = new Store(":memory:");
    let tick = 0;
    const runner = new TaskRunner(
      store,
      engine,
      () => {},
      () => new Date(Date.UTC(2026, 9, 26, 9, 0, tick++)).toISOString(),
    );
    return { store, runner, runs, picks, setDefaults: (d: Defaults) => (defaults = d) };
  };

  it("waits as To do without running, then starts on the engine's defaults of that moment", async () => {
    const { store, runner, runs, setDefaults } = counting();
    const saved = runner.create({
      projectId: null,
      brief: "Sort the invoices",
      workdir: "/tmp/q",
      attachments: ["/a.pdf"],
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(store.getTask(saved.id)?.status).toBe("draft");
    expect(runs).toEqual([]);

    setDefaults({ provider: "claude", auth: "key", model: "opus", effort: "low" });
    const prepare = vi.fn(async () => ["/tmp/q/a.pdf"]);
    const started = await runner.startSaved(saved.id, prepare);
    expect(prepare).toHaveBeenCalledOnce();
    expect(started).toMatchObject({ status: "running", provider: "claude", auth: "key", model: "opus", effort: "low" });
    // The files are the ones prepared for the run, such as a quick edit's copies.
    expect(started.attachments).toEqual(["/tmp/q/a.pdf"]);
    // The brief counts as sent when it starts.
    expect((started.messages[0]?.at ?? "") > saved.createdAt).toBe(true);
    await waitFor(() => store.getTask(saved.id)?.status === "done");
    expect(runs).toEqual([saved.id]);
  });

  it("starts on the pick it is given, and on the engine's own choice when it gets none", async () => {
    const { runner, picks } = counting();
    const keep = async (t: Task) => t.attachments;
    const a = runner.create({ projectId: "p", brief: "Write it", workdir: "/p" });
    await runner.startSaved(a.id, keep, { preset: "thorough" });
    const b = runner.create({ projectId: "p", brief: "Write it too", workdir: "/p" });
    await runner.startSaved(b.id, keep);
    expect(picks).toEqual([{ preset: "thorough" }, undefined]);
  });

  it("starts once, however fast the clicks, and not again after it started", async () => {
    const { runner, runs } = counting();
    const saved = runner.create({ projectId: "p", brief: "Write it", workdir: "/p" });
    const keep = async (t: Task) => t.attachments;
    const [first, second] = await Promise.allSettled([
      runner.startSaved(saved.id, keep),
      runner.startSaved(saved.id, keep),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status === "rejected" && String(second.reason)).toMatch(/already starting/);
    await waitFor(() => runs.length === 1);
    await expect(runner.startSaved(saved.id, keep)).rejects.toThrow(/already started/);
    expect(runs).toHaveLength(1);
  });

  it("copies nothing when the engine can't start, and takes no follow-up before it starts", async () => {
    const store = new Store(":memory:");
    const engine: Engine = {
      defaults: () => Promise.reject(new Error("No AI is signed in")),
      choices: async () => ({ ai: "chatgpt", provider: "codex", lists: [] }),
      async *run() {},
      answer: () => false,
      decide: () => false,
    };
    const runner = new TaskRunner(store, engine, () => {});
    const saved = runner.create({ projectId: null, brief: "Fix the letter", workdir: "/tmp/q2" });
    const prepare = vi.fn(async () => []);
    await expect(runner.startSaved(saved.id, prepare)).rejects.toThrow(/signed in/);
    expect(prepare).not.toHaveBeenCalled();
    expect(store.getTask(saved.id)?.status).toBe("draft");
    expect(() => runner.followUp(saved.id, "Also the footer")).toThrow(/Start this task first/);
  });
});

describe("marking finished work as reviewed", () => {
  it("marks a done task once, keeps its place in Recent, and a follow-up makes it to review again", async () => {
    const { store, runner } = setup();
    const task = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/tmp/p" });
    expect(() => runner.markReviewed(task.id)).toThrow(/finished/);
    const run = runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    runner.answer(task.id, ["The client pays it"]);
    const done = await run;

    const reviewed = runner.markReviewed(task.id);
    expect(reviewed.reviewedAt).toBeTruthy();
    expect(reviewed.updatedAt).toBe(done.updatedAt);
    expect(store.getTask(task.id)?.reviewedAt).toBe(reviewed.reviewedAt);
    // A second mark changes nothing.
    expect(runner.markReviewed(task.id).reviewedAt).toBe(reviewed.reviewedAt);

    expect(runner.followUp(task.id, "Round the prices").reviewedAt).toBeUndefined();
  });

  it("puts checked work back among the ones to check, and only for a finished task", async () => {
    const { store, runner } = setup();
    const task = runner.create({ projectId: null, brief: "Write a proposal", workdir: "/tmp/p" });
    expect(() => runner.markUnreviewed(task.id)).toThrow(/finished/);
    const run = runner.start(task.id);
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    runner.answer(task.id, ["The client pays it"]);
    const done = await run;
    runner.markReviewed(task.id);

    const back = runner.markUnreviewed(task.id);
    expect(back.reviewedAt).toBeUndefined();
    expect(back.updatedAt).toBe(done.updatedAt);
    expect(store.getTask(task.id)?.reviewedAt).toBeUndefined();
    // Again, it changes nothing.
    expect(runner.markUnreviewed(task.id)).toEqual(back);
  });
});

describe("editing a task saved for later", () => {
  it("changes the brief, project, folder and files, and the title follows the brief", () => {
    const { store, runner } = setup();
    const saved = runner.create({
      projectId: null,
      brief: "Fix the letter",
      workdir: "/tmp/q",
      attachments: ["/a.pdf"],
    });
    const edited = runner.updateDraft(saved.id, {
      brief: "  Fix the letter to the bank\nand sign it  ",
      projectId: "p2",
      workdir: "/home/giulia/Website",
      attachments: ["/b.docx"],
    });
    expect(edited).toMatchObject({
      status: "draft",
      title: "Fix the letter to the bank",
      brief: "Fix the letter to the bank\nand sign it",
      projectId: "p2",
      workdir: "/home/giulia/Website",
      attachments: ["/b.docx"],
    });
    // The first message is the brief the agent gets when it starts.
    expect(edited.messages).toHaveLength(1);
    expect(edited.messages[0]).toMatchObject({ text: edited.brief, attachments: ["/b.docx"] });
    expect(store.getTask(saved.id)).toEqual(edited);

    // With no files left, the message has none either.
    const bare = runner.updateDraft(saved.id, { ...edited, attachments: [] });
    expect(bare.messages[0]?.attachments).toBeUndefined();
  });

  it("keeps a name the user gave it", () => {
    const { runner } = setup();
    const saved = runner.create({ projectId: null, brief: "Fix the letter", workdir: "/tmp/q" });
    runner.rename(saved.id, "Bank letter");
    const edited = runner.updateDraft(saved.id, {
      brief: "Fix it",
      projectId: null,
      workdir: "/tmp/q",
      attachments: [],
    });
    expect(edited.title).toBe("Bank letter");
  });

  it("refuses an empty brief and a task that has started", async () => {
    const { store, runner } = setup();
    const saved = runner.create({ projectId: null, brief: "Fix the letter", workdir: "/tmp/q" });
    const edit = { brief: "   ", projectId: null, workdir: "/tmp/q", attachments: [] };
    expect(() => runner.updateDraft(saved.id, edit)).toThrow(/needs a brief/);
    expect(store.getTask(saved.id)?.brief).toBe("Fix the letter");
    await runner.startSaved(saved.id, async (t) => t.attachments);
    expect(() => runner.updateDraft(saved.id, { ...edit, brief: "Something else" })).toThrow(/already started/);
  });
});
