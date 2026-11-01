import type { TaskMenuAction } from "./api";
import type { MessageKey } from "./i18n";
import { type Task, toReview } from "./model";

/** An item of a native menu, or a line between groups. */
export type MenuItem<A> = { label: string; action: A; enabled?: boolean } | "separator";

/**
 * The task menu, the same wherever it opens: the sidebar's Recent, the Board's rows and cards, and the Board's side
 * panel. What can be done to the task right now goes in the middle, so the menu has only items that do something.
 */
export function taskMenuItems(
  task: Pick<Task, "status" | "reviewedAt" | "projectId">,
  canDelete: boolean,
  t: (key: MessageKey) => string,
): MenuItem<TaskMenuAction>[] {
  const now: MenuItem<TaskMenuAction>[] = [];
  if (task.status === "draft") now.push({ label: t("board.start"), action: "start" });
  if (toReview(task)) now.push({ label: t("review.mark"), action: "review" });
  else if (task.status === "done") now.push({ label: t("review.unmark"), action: "unreview" });
  return [
    { label: t("menu.rename"), action: "rename" },
    // A saved task without a project gets its own folder only when it starts, so until then there's none to show.
    { label: t("menu.reveal"), action: "reveal", enabled: !(task.status === "draft" && task.projectId === null) },
    "separator",
    ...(now.length ? [...now, "separator" as const] : []),
    { label: t("menu.delete"), action: "delete", enabled: canDelete },
  ];
}
