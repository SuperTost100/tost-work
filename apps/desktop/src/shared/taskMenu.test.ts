import { describe, expect, it } from "vitest";
import { type MessageKey, translate } from "./i18n";
import { taskMenuItems } from "./taskMenu";

const t = (key: MessageKey) => translate("en", key);
const labels = (items: ReturnType<typeof taskMenuItems>) =>
  items.map((item) => (item === "separator" ? "—" : `${item.label}${item.enabled === false ? " (off)" : ""}`));
const actions = (items: ReturnType<typeof taskMenuItems>) =>
  items.map((item) => (item === "separator" ? item : item.action));

describe("the task menu", () => {
  it("offers Start only for a task saved for later", () => {
    expect(labels(taskMenuItems({ status: "draft", projectId: "p" }, true, t))).toEqual([
      "Rename",
      "Show in folder",
      "—",
      "Start",
      "—",
      "Delete…",
    ]);
  });

  it("has no folder to show for a saved task without a project, until it starts", () => {
    expect(labels(taskMenuItems({ status: "draft", projectId: null }, true, t))).toContain("Show in folder (off)");
    expect(labels(taskMenuItems({ status: "done", projectId: null }, true, t))).toContain("Show in folder");
  });

  it("offers to mark finished work as checked, and to undo that once it is", () => {
    const check = taskMenuItems({ status: "done", projectId: "p" }, true, t);
    expect(actions(check)).toEqual(["rename", "reveal", "separator", "review", "separator", "delete"]);
    expect(labels(check)).toContain("Mark as checked");
    const undo = taskMenuItems({ status: "done", projectId: "p", reviewedAt: "2026-10-26T09:00:00Z" }, true, t);
    expect(actions(undo)).toEqual(["rename", "reveal", "separator", "unreview", "separator", "delete"]);
    expect(labels(undo)).toContain("Mark to check");
  });

  it("says da vedere on the tag, the filter and the column, and keeps controllata in the menu", () => {
    const it_ = (key: MessageKey) => translate("it", key);
    expect(labels(taskMenuItems({ status: "done", projectId: "p" }, true, it_))).toContain("Segna come controllata");
    expect(labels(taskMenuItems({ status: "done", projectId: "p", reviewedAt: "x" }, true, it_))).toContain(
      "Segna da controllare",
    );
    expect([it_("tag.toReview"), it_("board.filter.toReview"), it_("board.group.toReview")]).toEqual([
      "da vedere",
      "Da vedere",
      "Da vedere",
    ]);
  });

  it("has one line before Delete when nothing else applies, and Delete off while the task works", () => {
    expect(labels(taskMenuItems({ status: "running", projectId: "p" }, false, t))).toEqual([
      "Rename",
      "Show in folder",
      "—",
      "Delete… (off)",
    ]);
    for (const status of ["needs-you", "failed", "stopped"] as const)
      expect(actions(taskMenuItems({ status, projectId: "p" }, true, t))).toEqual([
        "rename",
        "reveal",
        "separator",
        "delete",
      ]);
  });
});
