/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/model";
import { Store } from "../store/store";
import { FakeEngine, PROPOSAL_SCRIPT } from "./fake";
import { TaskRunner, titleFrom } from "./runner";

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
    const task = runner.create({ projectId: null, brief: "Write a proposal for Alpi Logistica" });
    const done = runner.start(task.id, "/tmp/project");

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
    const task = runner.create({ projectId: null, brief: "Write a proposal" });
    const done = runner.start(task.id, "/tmp/p");
    await waitFor(() => store.getTask(task.id)?.status === "needs-you");
    runner.stop(task.id);
    expect((await done).status).toBe("stopped");
    expect(runner.isRunning(task.id)).toBe(false);
  });

  it("refuses an answer when no question is open", () => {
    const { runner } = setup();
    const task = runner.create({ projectId: null, brief: "Hello" });
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
    const task = runner.create({ projectId: null, brief: "Write a proposal", attachments: ["/notes.docx"] });
    const final = await runner.start(task.id, "/tmp/p");
    expect(final.status).toBe("done");
    expect(store.getTask(task.id)?.attachments).toEqual(["/notes.docx"]);
  });
});
