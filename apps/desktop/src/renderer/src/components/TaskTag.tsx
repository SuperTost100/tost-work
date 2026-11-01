import { useT } from "@/lib/useT";
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
