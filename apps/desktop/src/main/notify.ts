import {
  NOTIFY_KINDS,
  type NotifyKind,
  type NotifyLevel,
  type Settings,
  type Task,
  type TaskStatus,
} from "../shared/model";

/** What a change of status is worth telling the user about, if anything. */
export function notifyKind(before: TaskStatus | undefined, task: Task): NotifyKind | null {
  if (before === task.status) return null;
  if (task.status === "needs-you") return "needsYou";
  if (task.status === "failed") return "failed";
  // Only a run that was going: a task opened again, or one stopped by the user, says nothing.
  if (task.status === "done" && (before === "running" || before === "needs-you")) return "done";
  return null;
}

/** How a notification of this kind shows, or "off". The general switch turns them all off. */
export const notifyLevel = (settings: Pick<Settings, "notifications" | "notify">, kind: NotifyKind): NotifyLevel =>
  settings.notifications ? settings.notify[kind] : "off";

type NotifySettings = Pick<Settings, "notifications" | "notify">;
const anyOn = (s: NotifySettings) => NOTIFY_KINDS.some((kind) => notifyLevel(s, kind) !== "off");

/**
 * Whether turning notifications on should show one straight away. The Mac asks for permission the first time an app
 * shows a notification, and no other way: so it asks when the user turns them on, not when the first real one comes
 * and is lost. That's when they go from all off to some on, or when setup ends with them on.
 */
export function confirmsNotifications(before: NotifySettings & Pick<Settings, "setupDone">, after: typeof before) {
  if (!anyOn(after)) return false;
  return !anyOn(before) || (!before.setupDone && after.setupDone);
}

export interface Shown {
  kind: NotifyKind;
  taskId: string;
  title: string;
  /** No sound, for "quiet". */
  silent: boolean;
}

/**
 * Watches tasks change and decides when to notify: a task that needs the user, failed or finished, as the settings
 * say. Nothing shows while the user is looking at Tost Work, since the task screen already says it.
 */
export class Notifier {
  private status = new Map<string, TaskStatus>();

  constructor(
    private settings: () => Pick<Settings, "notifications" | "notify">,
    private looking: () => boolean,
    private show: (n: Shown) => void,
  ) {}

  /** The statuses tasks already have, so starting up doesn't notify about old news. */
  know(tasks: Task[]): void {
    for (const task of tasks) this.status.set(task.id, task.status);
  }

  changed(task: Task): void {
    const kind = notifyKind(this.status.get(task.id), task);
    this.status.set(task.id, task.status);
    if (!kind || this.looking()) return;
    const level = notifyLevel(this.settings(), kind);
    if (level === "off") return;
    this.show({ kind, taskId: task.id, title: task.title, silent: level === "quiet" });
  }
}
