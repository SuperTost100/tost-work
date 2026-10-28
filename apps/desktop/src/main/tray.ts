import type { MenuItemConstructorOptions } from "electron";
import type { Language, MessageKey } from "../shared/i18n";
import { whenText } from "../shared/jobText";
import { busyStatus, type Job, type Settings, type Task } from "../shared/model";
import { upcoming } from "../shared/schedule";

/** Tost Work stays in the menu bar, or the tray, while a job is on and the user wants it to. Otherwise it quits as usual. */
export const staysInMenuBar = (settings: Pick<Settings, "stayInMenuBar">, jobs: Pick<Job, "on">[]): boolean =>
  settings.stayInMenuBar && jobs.some((j) => j.on);

export interface TrayActions {
  open(): void;
  /** Opens the first task that needs the user. */
  openTask(id: string): void;
  quit(): void;
}

/** The icon's menu: open the window, what needs the user, the next job, and quit. */
export function trayMenu(
  t: (key: MessageKey, vars?: Record<string, string>) => string,
  lang: Language,
  jobs: Job[],
  tasks: Pick<Task, "id" | "status">[],
  now: Date,
  actions: TrayActions,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [{ label: t("tray.open"), click: actions.open }, { type: "separator" }];
  const waiting = tasks.filter((x) => x.status === "needs-you");
  if (waiting[0]) {
    const first = waiting[0].id;
    items.push({
      label: waiting.length === 1 ? t("tray.needsYouOne") : t("tray.needsYou", { n: String(waiting.length) }),
      click: () => actions.openTask(first),
    });
  }
  const working = tasks.filter((x) => busyStatus(x.status) && x.status !== "needs-you").length;
  if (working) items.push({ label: t("tray.working", { n: String(working) }), enabled: false });
  const next = jobs
    .map((job) => ({ job, at: upcoming(job, now) }))
    .filter((x): x is { job: Job; at: Date } => x.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  items.push({
    label: next ? t("tray.next", { title: next.job.title, when: whenText(lang, next.at, now) }) : t("tray.noNext"),
    enabled: false,
  });
  items.push({ type: "separator" }, { label: t("tray.quit"), click: actions.quit });
  return items;
}
