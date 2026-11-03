import type { ReactNode } from "react";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import type { MessageKey } from "../../../shared/i18n";
import { type Task, toReview } from "../../../shared/model";

/** Three dots that pulse while a task runs. They stand still when the system asks for reduced motion. */
export function WorkingDots() {
  return (
    <span className="pulse" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** The mono status tag. It turns ink-black when the task waits for the user. */
export function TaskTag({ task }: { task: Task }) {
  const t = useT();
  switch (task.status) {
    case "needs-you":
      return <span className="tag mine">{t("tag.needsYou")}</span>;
    case "running": {
      const total = task.steps.length;
      const n = Math.max(1, task.steps.findIndex((s) => s.status === "in_progress") + 1);
      return (
        <span className="tag">
          <WorkingDots />
          {total ? t("tag.writing", { n: String(n), total: String(total) }) : t("tag.working")}
        </span>
      );
    }
    // Once the user has looked at the work and marked it reviewed, nothing is left to say about it.
    case "done":
      return toReview(task) ? <span className="tag mine">{t("tag.toReview")}</span> : null;
    case "draft":
      return <span className="tag">{t("tag.draft")}</span>;
    case "stopped":
      return <span className="tag">{t("tag.stopped")}</span>;
    case "failed":
      return <span className="tag">{t("tag.failed")}</span>;
  }
}

/** The word for a task's state, for Recent's icon and the row's tooltip. */
export function statusWord(task: Task, t: (key: MessageKey) => string): string | null {
  if (task.status === "needs-you") return t("tag.needsYou");
  if (task.status === "running") return t("tag.working");
  if (toReview(task)) return t("tag.toReview");
  if (task.status === "done") return t("tag.done");
  if (task.status === "draft") return t("tag.draft");
  if (task.status === "stopped") return t("tag.stopped");
  if (task.status === "failed") return t("tag.failed");
  return null;
}

/**
 * The task's state as a small icon, for rows too narrow for a tag: the sidebar's Recent list. The word is its
 * accessible name; on hover the … takes its place, so the row's own tooltip says the word (see Sidebar). Work waiting
 * for the user stands out in amber: a hand when it asks something, a dot when there's a result to check. A stopped task
 * (by the user, or by Tost Work closing) shows a grey square, a failed one a red warning.
 */
export function TaskStatusIcon({ task }: { task: Task }) {
  const t = useT();
  const label = statusWord(task, t);
  if (!label) return null;
  const [kind, mark]: [string, ReactNode] =
    task.status === "needs-you"
      ? ["need", <Icon key="i" name="hand" />]
      : task.status === "running"
        ? [
            "run",
            <svg key="i" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6" opacity="0.25" />
              <path d="M8 2a6 6 0 0 1 6 6" />
            </svg>,
          ]
        : task.status === "draft"
          ? [
              "later",
              <svg key="i" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6" strokeDasharray="3.2 2.2" />
              </svg>,
            ]
          : task.status === "stopped"
            ? ["stopped", <Icon key="i" name="stop" />]
            : task.status === "failed"
              ? ["failed", <Icon key="i" name="alert" />]
              : toReview(task)
                ? ["review", <i key="i" className="dot" />]
                : ["seen", <Icon key="i" name="check-circle" />];
  return (
    <span className={`st ${kind}`} role="img" aria-label={label} title={label}>
      {mark}
    </span>
  );
}
