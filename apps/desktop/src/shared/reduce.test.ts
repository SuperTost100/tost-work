import { describe, expect, it } from "vitest";
import { MAX_ACTIVITY, type Task } from "./model";
import { applyEvent } from "./reduce";

const waiting = {
  status: "needs-you",
  question: { id: "q2", text: "Which template?", options: ["A", "B"] },
  approval: null,
} as unknown as Task;

describe("applyEvent effort", () => {
  it("makes the task say the reasoning level its run used", () => {
    const started = { effort: "max", model: "m1" } as unknown as Task;
    expect(applyEvent(started, { type: "effort", effort: "xhigh" }, "t")).toMatchObject({
      effort: "xhigh",
      model: "m1",
    });
  });
});

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

describe("applyEvent file", () => {
  it("lists each file once, and a file the task made and then changed still counts as made", () => {
    const base = { status: "running", files: [] } as unknown as Task;
    const file = (path: string, kind: "add" | "update") =>
      ({ type: "file", change: { path, kind, role: "made" } }) as const;
    let task = applyEvent(base, file("/w/a.docx", "add"), "t");
    task = applyEvent(task, file("/w/b.docx", "update"), "t");
    task = applyEvent(task, file("/w/a.docx", "update"), "t");
    expect(task.files).toEqual([
      { path: "/w/b.docx", kind: "update", role: "made" },
      { path: "/w/a.docx", kind: "add", role: "made" },
    ]);
  });

  it("keeps a file with a kept copy listed as changed, whatever the agent reports, until it's deleted", () => {
    const kept = [{ path: "/w/note.txt", copy: "/k/1", at: "t", reason: "overwrite" as const }];
    const base = { status: "running", files: [], kept } as unknown as Task;
    const file = (kind: "add" | "update" | "delete") =>
      ({ type: "file", change: { path: "/w/note.txt", kind, role: "made" } }) as const;
    const changed = [{ path: "/w/note.txt", kind: "update", role: "made" }];
    let task = applyEvent(base, file("add"), "t");
    expect(task.files).toEqual(changed);
    task = applyEvent(task, file("update"), "t");
    expect(task.files).toEqual(changed);
    task = applyEvent(task, file("delete"), "t");
    expect(task.files).toEqual([{ path: "/w/note.txt", kind: "delete", role: "made" }]);
  });
});

describe("applyEvent for a user's file the task changed without a card", () => {
  const made = { path: "/w/Preventivo.txt", kind: "add", role: "made" } as const;

  it("makes a kept copy the file's earlier version and lists it as changed or deleted", () => {
    const copy = { path: made.path, copy: "/k/1", at: "t", reason: "overwrite" as const };
    const base = { status: "running", files: [made], own: [] } as unknown as Task;
    const changed = applyEvent(base, { type: "kept", copy, kind: "update" }, "t");
    expect(changed.kept).toEqual([copy]);
    expect(changed.files).toEqual([{ path: made.path, kind: "update", role: "made" }]);
    const gone = applyEvent(base, { type: "kept", copy, kind: "delete" }, "t");
    expect(gone.files).toEqual([{ path: made.path, kind: "delete", role: "made" }]);
  });

  it("lists a file changed with no copy as changed, not as made, and marks it as having no earlier version", () => {
    // The task made the file in an earlier run; the user saved it since, so it's no longer the task's own.
    const base = { status: "running", files: [made], own: [] } as unknown as Task;
    const unkept = (kind: "update" | "delete") => ({ type: "file", change: { ...made, kind }, unkept: true }) as const;
    const next = applyEvent(base, unkept("update"), "t");
    expect(next.files).toEqual([{ path: made.path, kind: "update", role: "made" }]);
    expect(next.unkept).toEqual([made.path]);
    expect(applyEvent(next, unkept("delete"), "t").unkept).toEqual([made.path]);
    // Without the mark, the same report keeps a file the task made listed as made.
    expect(applyEvent(base, { type: "file", change: { ...made, kind: "update" } }, "t").files).toEqual([made]);
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

  it("keeps the id of every tool call a line stands for, so the debug view can show each one", () => {
    let next = applyEvent(task, { type: "activity", kind: "edit", target: "a.docx", id: "c1" }, "t1");
    next = applyEvent(next, { type: "activity", kind: "edit", target: "a.docx", id: "c2" }, "t2");
    next = applyEvent(next, { type: "activity", kind: "edit", target: "a.docx" }, "t3");
    next = applyEvent(next, { type: "activity", kind: "read", target: "b.txt", id: "c3" }, "t4");
    expect(next.activity).toEqual([
      { kind: "edit", target: "a.docx", at: "t1", msg: 1, ids: ["c1", "c2"] },
      { kind: "read", target: "b.txt", at: "t4", msg: 1, ids: ["c3"] },
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
