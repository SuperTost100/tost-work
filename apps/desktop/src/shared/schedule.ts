/** When a job runs: its times in the computer's local time, worked out the same in the app and its tests. */

export type JobRepeat = "daily" | "weekdays" | "weekly" | "monthly";
export const JOB_REPEATS: JobRepeat[] = ["daily", "weekdays", "weekly", "monthly"];

export interface JobSchedule {
  repeat: JobRepeat;
  /** "HH:MM", 24-hour. */
  time: string;
  /** For "weekly": the days, 0 for Sunday to 6 for Saturday. */
  days?: number[];
  /** For "monthly": the day of the month. A day the month doesn't have, such as the 31st, is its last day. */
  day?: number;
}

/** How far ahead or back a run is looked for: past a year, the schedule can't match any day. */
const DAYS_LOOKED_AT = 400;

export const validTime = (time: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

/** Whether the job runs on this day. */
function runsOn(schedule: JobSchedule, day: Date): boolean {
  const weekday = day.getDay();
  switch (schedule.repeat) {
    case "daily":
      return true;
    case "weekdays":
      return weekday >= 1 && weekday <= 5;
    case "weekly":
      return (schedule.days ?? []).includes(weekday);
    case "monthly": {
      const last = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
      return day.getDate() === Math.min(schedule.day ?? 1, last);
    }
  }
}

/** The run on this day at the schedule's time. */
function slotOn(schedule: JobSchedule, day: Date): Date {
  const [h = 0, m = 0] = schedule.time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

/** The first run after `after`, or null if the schedule never runs (a week with no days picked). */
export function nextRun(schedule: JobSchedule, after: Date): Date | null {
  for (let i = 0; i < DAYS_LOOKED_AT; i++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i);
    if (!runsOn(schedule, day)) continue;
    const slot = slotOn(schedule, day);
    if (slot > after) return slot;
  }
  return null;
}

/** The latest run at or before `at`, or null if there wasn't one in the last year. */
export function lastRun(schedule: JobSchedule, at: Date): Date | null {
  for (let i = 0; i < DAYS_LOOKED_AT; i++) {
    const day = new Date(at.getFullYear(), at.getMonth(), at.getDate() - i);
    if (!runsOn(schedule, day)) continue;
    const slot = slotOn(schedule, day);
    if (slot <= at) return slot;
  }
  return null;
}

/** The next time a job runs, leaving out the one Skip once dropped, or null while it's off. */
export function upcoming(job: { on: boolean; schedule: JobSchedule; skip: string | null }, now: Date): Date | null {
  if (!job.on) return null;
  const next = nextRun(job.schedule, now);
  if (next && job.skip && new Date(job.skip).getTime() === next.getTime()) return nextRun(job.schedule, next);
  return next;
}
