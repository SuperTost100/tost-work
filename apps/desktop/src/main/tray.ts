import type { MenuItemConstructorOptions, Rectangle } from "electron";
import type { Language, MessageKey } from "../shared/i18n";
import { whenText } from "../shared/jobText";
import { busyStatus, type Job, type Settings, type Task } from "../shared/model";
import { upcoming } from "../shared/schedule";
import { AT_LOGIN } from "./loginItem";

/** Closing the window leaves Tost Work running in the menu bar, or the tray, unless the user turned that off. */
export const staysInMenuBar = (settings: Pick<Settings, "stayInMenuBar">): boolean => settings.stayInMenuBar;

/** A start at login opens the window only when the user chose so; otherwise the menu-bar icon is all there is. */
export const opensWindow = (atLogin: boolean, settings: Pick<Settings, "loginOpens">): boolean =>
  !atLogin || settings.loginOpens === "window";

/** What a second launch of Tost Work sends the copy already running, before it quits. */
export type SecondLaunch = { atLogin: boolean };

/**
 * Whether a second launch brings the running copy's window forward. It does when the user opened Tost Work again, also
 * when it was waiting in the menu bar with no window, and not when the login started it: the copy that's running has
 * already done what a start at login does. The flag is read from the data the second launch sent and, in case that
 * didn't arrive, from its arguments.
 */
export function showsForSecondLaunch(data: unknown, argv: readonly string[]): boolean {
  const sent = typeof data === "object" && data !== null && (data as Partial<SecondLaunch>).atLogin === true;
  return !sent && !argv.includes(AT_LOGIN);
}

/** The gap between the icon and the panel. */
const GAP = 6;

/**
 * Where the panel opens: under the icon, centred on it, as Mac menu-bar panels do. A taskbar at the bottom of the
 * screen, as on Windows, puts it above the icon instead. It stays inside the screen's usable area either way.
 */
export function panelBounds(icon: Rectangle, size: { width: number; height: number }, area: Rectangle): Rectangle {
  const below = icon.y + icon.height / 2 < area.y + area.height / 2;
  const height = Math.min(size.height, area.height - 2 * GAP);
  const x = Math.round(icon.x + icon.width / 2 - size.width / 2);
  const y = below ? icon.y + icon.height + GAP : icon.y - height - GAP;
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  return {
    x: clamp(x, area.x + GAP, area.x + area.width - size.width - GAP),
    y: clamp(y, area.y + GAP, area.y + area.height - height - GAP),
    width: size.width,
    height,
  };
}

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
