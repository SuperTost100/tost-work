import { useT } from "@/lib/useT";
import type { Task } from "../../../shared/model";

/** The mono status tag. It turns ink-black when the task waits for the user. */
export function TaskTag({ task }: { task: Task }) {
  const t = useT();
  switch (task.status) {
    case "needs-you":
      return <span className="tag mine">{t("tag.needsYou")}</span>;
    case "running": {
      const total = task.steps.length;
      const n = Math.max(1, task.steps.findIndex((s) => s.status === "in_progress") + 1);
      return <span className="tag">{total ? t("tag.writing", { n: String(n), total: String(total) }) : "…"}</span>;
    }
    case "done":
      return <span className="tag mine">{t("tag.toReview")}</span>;
    case "stopped":
      return <span className="tag">{t("tag.stopped")}</span>;
    case "failed":
      return <span className="tag">{t("tag.failed")}</span>;
    default:
      return null;
  }
}
