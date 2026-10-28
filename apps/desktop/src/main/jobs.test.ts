/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { Job, JobDraft, TaskStatus } from "../shared/model";
import { upcoming } from "../shared/schedule";
import { decide, Jobs, jobDraft } from "./jobs";

// Local times. 28 Oct 2026 is a Wednesday.
const at = (d: number, h = 0, m = 0) => new Date(2026, 9, d, h, m);
const DRAFT: JobDraft = {
  projectId: "p",
  title: "Follow-up check",
  brief: "List the proposals with no answer after 7 days.",
  schedule: { repeat: "daily", time: "09:00" },
  missed: "run",
  output: "",
};
const job = (over: Partial<Job> = {}): Job => ({
  id: "j",
  ...DRAFT,
  on: true,
  skip: null,
  handled: at(27, 9).toISOString(),
  last: null,
  createdAt: at(20).toISOString(),
  updatedAt: at(20).toISOString(),
  ...over,
});

describe("decide", () => {
  it("runs at its time, and only once for that time", () => {
    expect(decide(job(), at(28, 8, 59), false)).toBeNull();
    expect(decide(job(), at(28, 9, 1), false)).toEqual({ run: at(28, 9) });
    expect(decide(job({ handled: at(28, 9).toISOString() }), at(28, 9, 2), false)).toBeNull();
  });

  it("runs once on waking after missed runs, or waits for the next time if the job says so", () => {
    expect(decide(job({ handled: at(24, 9).toISOString() }), at(28, 14), false)).toEqual({ run: at(28, 9) });
    expect(decide(job({ missed: "skip" }), at(28, 14), false)).toEqual({ skip: at(28, 9), why: "missed" });
    // Within a few minutes of its time it's on time, whatever the job says about missed runs.
    expect(decide(job({ missed: "skip" }), at(28, 9, 3), false)).toEqual({ run: at(28, 9) });
  });

  it("skips a run while the one before still needs the user, and the run Skip once dropped", () => {
    expect(decide(job(), at(28, 9, 1), true)).toEqual({ skip: at(28, 9), why: "waiting" });
    expect(decide(job(), at(28, 9, 1), false)).toEqual({ run: at(28, 9) });
    expect(decide(job({ skip: at(28, 9).toISOString() }), at(28, 9, 1), false)).toEqual({
      skip: at(28, 9),
      why: "once",
    });
    expect(decide(job({ on: false }), at(28, 9, 1), false)).toBeNull();
  });
});

describe("upcoming", () => {
  it("is the next time, or the one after when Skip once dropped it", () => {
    expect(upcoming(job(), at(28, 10))).toEqual(at(29, 9));
    expect(upcoming(job({ skip: at(29, 9).toISOString() }), at(28, 10))).toEqual(at(30, 9));
    expect(upcoming(job({ on: false }), at(28, 10))).toBeNull();
  });
});

describe("jobDraft", () => {
  it("takes a well-formed job and refuses times, days and folders that don't fit", () => {
    expect(jobDraft({ ...DRAFT, schedule: { repeat: "weekly", time: "08:00", days: [4, 1, 1] } }).schedule).toEqual({
      repeat: "weekly",
      time: "08:00",
      days: [1, 4],
    });
    expect(() => jobDraft({ ...DRAFT, schedule: { repeat: "weekly", time: "08:00", days: [] } })).toThrow(
      /at least one day/,
    );
    expect(() => jobDraft({ ...DRAFT, schedule: { repeat: "daily", time: "8:00" } })).toThrow(/HH:MM/);
    expect(() => jobDraft({ ...DRAFT, schedule: { repeat: "monthly", time: "08:00", day: 32 } })).toThrow(/1 to 31/);
    expect(() => jobDraft({ ...DRAFT, output: "../elsewhere" })).toThrow(/inside the project/);
    expect(() => jobDraft({ ...DRAFT, output: "/etc" })).toThrow(/inside the project/);
    expect(() => jobDraft({ ...DRAFT, output: "Reports/../.." })).toThrow(/inside the project/);
    expect(jobDraft({ ...DRAFT, output: "..notes" }).output).toBe("..notes");
    expect(() => jobDraft({ ...DRAFT, title: " " })).toThrow(/name/);
  });
});

/** Jobs over an in-memory store, with a clock the test moves. */
function setup() {
  const jobs = new Map<string, Job>();
  const status = new Map<string, TaskStatus>();
  const runOf = new Map<string, string>();
  const started: { jobId: string; at: Date }[] = [];
  let clock = at(28, 8);
  let fail = false;
  let starting = () => {};
  const changes: unknown[] = [];
  const service = new Jobs({
    store: {
      listJobs: () => [...jobs.values()],
      getJob: (id) => jobs.get(id),
      saveJob: (j) => void jobs.set(j.id, j),
      deleteJob: (id) => void jobs.delete(id),
      getProject: (id) => (id === "p" ? {} : undefined),
      removeProject: (id) => {
        const gone = [...jobs.values()].filter((j) => j.projectId === id).map((j) => j.id);
        for (const jobId of gone) jobs.delete(jobId);
        return gone;
      },
    },
    busy: (jobId) =>
      [...status].some(([id, st]) => runOf.get(id) === jobId && (st === "running" || st === "needs-you")),
    start: async (j, when) => {
      if (fail) throw new Error("No AI is signed in");
      starting();
      started.push({ jobId: j.id, at: when });
      const id = `t${started.length}`;
      status.set(id, "running");
      runOf.set(id, j.id);
      return id;
    },
    changed: (change) => void changes.push(change),
    now: () => clock,
  });
  return {
    service,
    changes,
    started,
    status,
    tick: (when: Date) => {
      clock = when;
      return service.tick();
    },
    failNext: () => {
      fail = true;
    },
    whenStarting: (fn: () => void) => {
      starting = fn;
    },
  };
}

describe("Jobs", () => {
  it("tells the window which jobs went with a removed project", () => {
    const { service, changes } = setup();
    const made = service.create(DRAFT);
    service.removeProject("p");
    expect(service.list()).toEqual([]);
    expect(changes.at(-1)).toEqual({ id: made.id, removed: true });
  });

  it("doesn't bring back a job removed, with its project, while an earlier job was starting", async () => {
    const { service, started, tick, whenStarting } = setup();
    service.create(DRAFT);
    service.create({ ...DRAFT, title: "Second" });
    whenStarting(() => service.removeProject("p"));
    await tick(at(28, 9));
    expect(started).toHaveLength(1);
    expect(service.list()).toEqual([]);
  });

  it("runs a new job at its next time, never twice for one time, even when looks overlap", async () => {
    const { service, started, tick } = setup();
    const made = service.create(DRAFT);
    await tick(at(28, 8, 30));
    expect(started).toEqual([]);
    await Promise.all([tick(at(28, 9)), tick(at(28, 9))]);
    expect(started).toEqual([{ jobId: made.id, at: at(28, 9) }]);
    expect(service.list()[0]?.last).toEqual({ at: at(28, 9).toISOString(), taskId: "t1" });
  });

  it("waits while the last run needs the user, then runs again once it's answered", async () => {
    const { service, started, status, tick } = setup();
    service.create(DRAFT);
    await tick(at(28, 9));
    status.set("t1", "needs-you");
    await tick(at(29, 9));
    expect(started).toHaveLength(1);
    expect(service.list()[0]?.last).toEqual({ at: at(29, 9).toISOString(), skipped: "waiting" });
    // Still waiting the day after: a skipped time doesn't forget which run it's waiting for.
    await tick(at(30, 9));
    expect(started).toHaveLength(1);
    status.set("t1", "done");
    await tick(at(31, 9));
    expect(started).toHaveLength(2);
  });

  it("keeps a Skip once when the job is saved with the same times, and drops it when they change", () => {
    const { service } = setup();
    const made = service.create(DRAFT);
    service.skipOnce(made.id);
    expect(service.update(made.id, { ...DRAFT, title: "Renamed" }).skip).toBe(at(28, 9).toISOString());
    expect(service.update(made.id, { ...DRAFT, schedule: { repeat: "daily", time: "10:00" } }).skip).toBeNull();
  });

  it("skips one run when asked, and puts it back when asked again", async () => {
    const { service, started, tick } = setup();
    const made = service.create(DRAFT);
    expect(service.skipOnce(made.id).skip).toBe(at(28, 9).toISOString());
    expect(service.skipOnce(made.id).skip).toBeNull();
    service.skipOnce(made.id);
    await tick(at(28, 9));
    expect(started).toEqual([]);
    expect(service.list()[0]?.skip).toBeNull();
    await tick(at(29, 9));
    expect(started).toHaveLength(1);
  });

  it("doesn't catch up on the runs it was off for, and notes a run that couldn't start", async () => {
    const { service, started, tick, failNext } = setup();
    const made = service.create(DRAFT);
    service.skipOnce(made.id);
    service.setOn(made.id, false);
    await tick(at(29, 9));
    expect(started).toEqual([]);
    await tick(at(29, 10));
    // Its skip was for a time that went by while it was off, so it's gone.
    expect(service.setOn(made.id, true).skip).toBeNull();
    await tick(at(29, 11));
    expect(started).toEqual([]);
    failNext();
    await tick(at(30, 9));
    expect(service.list()[0]?.last).toEqual({ at: at(30, 9).toISOString(), error: "No AI is signed in" });
  });

  it("waits for an earlier run that needs the user even after Run now started and finished another", async () => {
    const { service, started, status, tick } = setup();
    const made = service.create(DRAFT);
    await tick(at(28, 9));
    status.set("t1", "needs-you");
    await service.runNow(made.id);
    status.set("t2", "done");
    await tick(at(29, 9));
    expect(started).toHaveLength(2);
    expect(service.list()[0]?.last).toEqual({ at: at(29, 9).toISOString(), skipped: "waiting" });
  });

  it("runs now on request without moving its schedule, and refuses a job in a project that's gone", async () => {
    const { service, started, status, tick } = setup();
    const made = service.create(DRAFT);
    expect(await service.runNow(made.id)).toBe("t1");
    status.set("t1", "done");
    await tick(at(28, 9));
    expect(started.map((s) => s.at)).toEqual([at(28, 8), at(28, 9)]);
    expect(() => service.create({ ...DRAFT, projectId: "gone" })).toThrow(/project/);
  });
});
