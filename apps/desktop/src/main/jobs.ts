import { randomUUID } from "node:crypto";
import { isAbsolute, normalize, sep } from "node:path";
import type { Job, JobDraft, JobLast } from "../shared/model";
import { JOB_REPEATS, type JobSchedule, lastRun, nextRun, validTime } from "../shared/schedule";
import { text } from "./validate";

/** A run found this long after its time still counts as on time: timers drift, and waking up takes a moment. */
export const ON_TIME_FOR = 5 * 60_000;

/** What to do about a job's latest run time. */
export type Decision = { run: Date } | { skip: Date; why: "once" | "missed" | "waiting" } | null;

/**
 * Whether a job runs now. Only its latest run time counts, so after a week off a daily job runs once, not seven
 * times. A time already dealt with is left alone.
 */
export function decide(job: Job, now: Date, busy: boolean): Decision {
  if (!job.on) return null;
  const due = lastRun(job.schedule, now);
  if (!due) return null;
  if (due <= new Date(job.handled ?? job.createdAt)) return null;
  if (job.skip && new Date(job.skip).getTime() === due.getTime()) return { skip: due, why: "once" };
  if (now.getTime() - due.getTime() > ON_TIME_FOR && job.missed === "skip") return { skip: due, why: "missed" };
  // A run before still needs an answer, or is still working: this one waits for the next time.
  if (busy) return { skip: due, why: "waiting" };
  return { run: due };
}

/** A job as the interface sends it, checked field by field, because IPC is a trust boundary. */
export function jobDraft(v: unknown): JobDraft {
  if (typeof v !== "object" || v === null) throw new Error("A job must be an object");
  const input = v as Record<string, unknown>;
  const title = text(input.title, "title", 120).trim();
  const brief = text(input.brief, "brief", 20_000).trim();
  if (!title || !brief) throw new Error("A job needs a name and what to do");
  if (input.missed !== "run" && input.missed !== "skip") throw new Error("missed must be run or skip");
  // A subfolder of the project, never a path out of it.
  const output = text(input.output ?? "", "output", 300).trim();
  const norm = normalize(output);
  const climbs = norm === ".." || norm.startsWith(`..${sep}`) || norm.startsWith("../");
  if (output && (isAbsolute(output) || /^[A-Za-z]:/.test(output) || climbs))
    throw new Error("The folder for results must be inside the project");
  return {
    projectId: text(input.projectId, "projectId", 100),
    title,
    brief,
    schedule: schedule(input.schedule),
    missed: input.missed,
    output,
  };
}

function schedule(v: unknown): JobSchedule {
  if (typeof v !== "object" || v === null) throw new Error("A job needs a schedule");
  const s = v as Record<string, unknown>;
  if (!JOB_REPEATS.includes(s.repeat as JobSchedule["repeat"])) throw new Error("Unknown repeat");
  if (typeof s.time !== "string" || !validTime(s.time)) throw new Error("The time must be HH:MM");
  const out: JobSchedule = { repeat: s.repeat as JobSchedule["repeat"], time: s.time };
  if (out.repeat === "weekly") {
    const days = s.days;
    if (!Array.isArray(days) || !days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
      throw new Error("A weekly job needs at least one day");
    out.days = [...new Set(days as number[])].sort();
  }
  if (out.repeat === "monthly") {
    if (!Number.isInteger(s.day) || (s.day as number) < 1 || (s.day as number) > 31)
      throw new Error("A monthly job needs a day from 1 to 31");
    out.day = s.day as number;
  }
  return out;
}

export interface JobsDeps {
  /** The store's jobs, and the status of a task by id. */
  store: {
    listJobs(): Job[];
    getJob(id: string): Job | undefined;
    saveJob(job: Job): void;
    deleteJob(id: string): void;
    getProject(id: string): unknown;
  };
  /** Whether a run of the job, any of them, still needs the user or is still working. */
  busy(jobId: string): boolean;
  /** Starts a run of the job as a new task, and gives its id. */
  start(job: Job, at: Date): Promise<string>;
  /** A job changed, so the window shows it. */
  changed(job: Job | { id: string; removed: true }): void;
  now?: () => Date;
}

/** Jobs: making and changing them, and running each at its times. */
export class Jobs {
  private now: () => Date;
  private ticking: Promise<void> | null = null;

  constructor(private deps: JobsDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  list(): Job[] {
    return this.deps.store.listJobs();
  }

  create(draft: JobDraft): Job {
    if (!this.deps.store.getProject(draft.projectId)) throw new Error("That project doesn't exist");
    const at = this.now().toISOString();
    // Its first run is the next time after now: a time earlier today has already gone.
    const job: Job = {
      id: randomUUID(),
      ...draft,
      on: true,
      skip: null,
      handled: at,
      last: null,
      createdAt: at,
      updatedAt: at,
    };
    return this.save(job);
  }

  update(id: string, draft: JobDraft): Job {
    const job = this.must(id);
    if (!this.deps.store.getProject(draft.projectId)) throw new Error("That project doesn't exist");
    const at = this.now().toISOString();
    // New times count from now, so moving today's time earlier doesn't start a run straight away. A Skip once stays
    // while the times stay the same, as when Try it saves before it runs.
    const sameTimes = JSON.stringify(job.schedule) === JSON.stringify(draft.schedule);
    return this.save({
      ...job,
      ...draft,
      skip: sameTimes ? job.skip : null,
      handled: sameTimes ? job.handled : at,
      updatedAt: at,
    });
  }

  /** On or off. Turned back on, it waits for its next time rather than catching up on the ones it was off for. */
  setOn(id: string, on: boolean): Job {
    const job = this.must(id);
    const at = this.now().toISOString();
    // A skip whose time went by while it was off is dropped, so it can't look like it's still in force.
    const skip = job.skip && job.skip > at ? job.skip : null;
    return this.save({ ...job, on, skip, ...(on ? { handled: at } : {}), updatedAt: at });
  }

  /** Leaves out the next run, or puts it back if it was left out already. */
  skipOnce(id: string): Job {
    const job = this.must(id);
    const at = this.now();
    const next = nextRun(job.schedule, at);
    const skipping = job.skip && next && new Date(job.skip).getTime() === next.getTime();
    return this.save({ ...job, skip: skipping || !next ? null : next.toISOString(), updatedAt: at.toISOString() });
  }

  remove(id: string): void {
    this.deps.store.deleteJob(id);
    this.deps.changed({ id, removed: true });
  }

  /** Runs the job now, outside its times, as Try it does. Its schedule carries on as before. */
  async runNow(id: string): Promise<string> {
    const job = this.must(id);
    const at = this.now();
    const taskId = await this.deps.start(job, at);
    const fresh = this.deps.store.getJob(id);
    if (fresh) this.save({ ...fresh, last: { at: at.toISOString(), taskId }, updatedAt: at.toISOString() });
    return taskId;
  }

  /** Looks at every job once. Calls that overlap share one look, so a run can't start twice. */
  tick(): Promise<void> {
    this.ticking ??= this.look().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async look(): Promise<void> {
    const now = this.now();
    for (const job of this.deps.store.listJobs()) {
      const decision = decide(job, now, this.deps.busy(job.id));
      if (!decision) continue;
      const due = "run" in decision ? decision.run : decision.skip;
      const base: Job = {
        ...job,
        handled: due.toISOString(),
        // Skip once is used up when its time comes, run or not.
        skip: job.skip && new Date(job.skip) <= due ? null : job.skip,
        updatedAt: now.toISOString(),
      };
      if ("skip" in decision) {
        // Skipped once by the user, the last run shown stays the one before.
        const last: JobLast | null =
          decision.why === "once" ? job.last : { at: due.toISOString(), skipped: decision.why };
        this.save({ ...base, last });
        continue;
      }
      // Marked as dealt with before it starts, so a slow start can't be started again by the next look.
      this.save(base);
      let last: JobLast;
      try {
        last = { at: due.toISOString(), taskId: await this.deps.start(job, due) };
      } catch (err) {
        last = { at: due.toISOString(), error: err instanceof Error ? err.message : String(err) };
      }
      // Deleted while its run started: the task stays, the job doesn't come back.
      const fresh = this.deps.store.getJob(job.id);
      if (fresh) this.save({ ...fresh, last });
    }
  }

  private must(id: string): Job {
    const job = this.deps.store.getJob(id);
    if (!job) throw new Error("That job isn't there any more");
    return job;
  }

  private save(job: Job): Job {
    this.deps.store.saveJob(job);
    this.deps.changed(job);
    return job;
  }
}
