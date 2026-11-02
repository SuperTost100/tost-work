import type { Language } from "./i18n";
import type { JobSchedule } from "./schedule";

/** Monday first, as people in Italy and most of Europe write a week. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];

const locale = (lang: Language) => (lang === "it" ? "it-IT" : "en-GB");

/** A weekday's name: "lunedì", "Monday", or short: "lun", "Mon". */
export function weekday(lang: Language, day: number, style: "long" | "short" = "long"): string {
  // 4 Jan 2026 is a Sunday, so day d of the week is the 4th + d.
  return new Intl.DateTimeFormat(locale(lang), { weekday: style }).format(new Date(2026, 0, 4 + day));
}

/** When a job runs, in a sentence: "Ogni lunedì e giovedì alle 08:00", "Weekdays at 09:00". */
export function scheduleText(lang: Language, s: JobSchedule): string {
  const it = lang === "it";
  const at = it ? `alle ${s.time}` : `at ${s.time}`;
  switch (s.repeat) {
    case "daily":
      return it ? `Ogni giorno ${at}` : `Every day ${at}`;
    case "weekdays":
      return it ? `Nei giorni feriali ${at}` : `Weekdays ${at}`;
    case "weekly": {
      const days = WEEK.filter((d) => s.days?.includes(d)).map((d) => weekday(lang, d));
      const list = new Intl.ListFormat(locale(lang), { type: "conjunction" }).format(days);
      return it ? `Ogni ${list} ${at}` : `Every ${list} ${at}`;
    }
    case "monthly": {
      const day = s.day ?? 1;
      // A day some months don't have runs on their last day instead.
      const short = day > 28;
      if (it) return `Il giorno ${day} di ogni mese${short ? " (o l'ultimo)" : ""} ${at}`;
      return `On the ${ordinal(day)} of every month${short ? " (or its last day)" : ""} ${at}`;
    }
  }
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a: Date, b: Date) => Math.round((midnight(b).getTime() - midnight(a).getTime()) / 86_400_000);
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** A run time as near as it reads best: "oggi 09:00", "domani 09:00", "gio 09:00", "lun 2 nov 08:00". */
export function whenText(lang: Language, when: Date, now: Date): string {
  const it = lang === "it";
  const days = daysBetween(now, when);
  if (days === 0) return `${it ? "oggi" : "today"} ${hhmm(when)}`;
  if (days === 1) return `${it ? "domani" : "tomorrow"} ${hhmm(when)}`;
  if (days === -1) return `${it ? "ieri" : "yesterday"} ${hhmm(when)}`;
  if (days > 1 && days < 7) return `${weekday(lang, when.getDay(), "short")} ${hhmm(when)}`;
  const date = new Intl.DateTimeFormat(locale(lang), { weekday: "short", day: "numeric", month: "short" }).format(when);
  return `${date} ${hhmm(when)}`;
}

/** When something last changed, as a list shows it: the time if it was today, else the day: "09:40", "22 ott". */
export function updatedText(lang: Language, when: Date, now: Date): string {
  if (daysBetween(when, now) === 0) return hhmm(when);
  // Another year's date says which year, so last October doesn't read as this one.
  const year = when.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const };
  return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "short", ...year }).format(when);
}

/** When a message was sent: the time if today, "ieri 18:05" if yesterday, else the date too: "2 nov 14:32". */
export function sentText(lang: Language, when: Date, now: Date): string {
  const days = daysBetween(when, now);
  if (days === 0) return hhmm(when);
  if (days === 1) return `${lang === "it" ? "ieri" : "yesterday"} ${hhmm(when)}`;
  return `${updatedText(lang, when, now)} ${hhmm(when)}`;
}

/** The group a job's card goes in, by its next run. */
export type JobGroup = "today" | "tomorrow" | "week" | "nextWeek" | "later" | "off";
export const JOB_GROUPS: JobGroup[] = ["today", "tomorrow", "week", "nextWeek", "later", "off"];

export function jobGroup(next: Date | null, now: Date): JobGroup {
  if (!next) return "off";
  const days = daysBetween(now, next);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  // The week ends on Sunday: Monday is 1 day into it, Sunday 7.
  const intoWeek = now.getDay() === 0 ? 7 : now.getDay();
  const leftThisWeek = 7 - intoWeek;
  if (days <= leftThisWeek) return "week";
  if (days <= leftThisWeek + 7) return "nextWeek";
  return "later";
}
