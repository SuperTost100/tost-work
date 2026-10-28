import { describe, expect, it } from "vitest";
import { MAX_ACTIVITY, type Task } from "./model";
import { applyEvent } from "./reduce";

const waiting = {
  status: "needs-you",
  question: { id: "q2", text: "Which template?", options: ["A", "B"] },
  approval: null,
} as unknown as Task;

describe("applyEvent withdrawn", () => {
  it("takes the named question off the task and puts it back to running", () => {
    const next = applyEvent(waiting, { type: "withdrawn", id: "q2" }, "t");
    expect(next.question).toBeNull();
    expect(next.status).toBe("running");
  });

  it("leaves a newer question alone", () => {
    expect(applyEvent(waiting, { type: "withdrawn", id: "q1" }, "t")).toBe(waiting);
  });
});

describe("applyEvent activity", () => {
  const task = { activity: [], messages: [{ from: "user", text: "brief", at: "t0" }] } as unknown as Task;

  it("adds a line per action, and keeps the same action twice in a row as one", () => {
    let next = applyEvent(task, { type: "activity", kind: "edit", target: "a.docx" }, "t1");
    next = applyEvent(next, { type: "activity", kind: "edit", target: "a.docx" }, "t2");
    next = applyEvent(next, { type: "activity", kind: "read", target: "b.txt" }, "t3");
    expect(next.activity).toEqual([
      { kind: "edit", target: "a.docx", at: "t1", msg: 1 },
      { kind: "read", target: "b.txt", at: "t3", msg: 1 },
    ]);
  });

  it("notes how many messages came before each line, and repeats a line once a message came in between", () => {
    let next = applyEvent(task, { type: "activity", kind: "read", target: "a.txt" }, "t1");
    next = applyEvent(next, { type: "message", text: "I read it." }, "t2");
    next = applyEvent(next, { type: "activity", kind: "read", target: "a.txt" }, "t3");
    expect(next.activity?.map((a) => a.msg)).toEqual([1, 2]);
  });

  it("keeps only the latest lines", () => {
    let next = task;
    for (let i = 0; i < MAX_ACTIVITY + 5; i++)
      next = applyEvent(next, { type: "activity", kind: "read", target: `${i}` }, "t");
    expect(next.activity).toHaveLength(MAX_ACTIVITY);
    expect(next.activity?.[0]?.target).toBe("5");
  });
});

describe("applyEvent skills", () => {
  it("keeps each skill the agent read on the task, once", () => {
    let next = { activity: [], messages: [] } as unknown as Task;
    next = applyEvent(next, { type: "activity", kind: "skill", target: "brand-voice" }, "t1");
    next = applyEvent(next, { type: "activity", kind: "read", target: "a.txt" }, "t2");
    next = applyEvent(next, { type: "activity", kind: "skill", target: "brand-voice" }, "t3");
    next = applyEvent(next, { type: "activity", kind: "skill", target: "word" }, "t4");
    expect(next.skillsUsed).toEqual(["brand-voice", "word"]);
  });
});
