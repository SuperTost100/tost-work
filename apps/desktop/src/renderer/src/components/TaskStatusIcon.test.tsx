import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Task } from "../../../shared/model";
import { statusWord, TaskStatusIcon } from "./TaskTag";

const task = (status: Task["status"], reviewedAt?: string) => ({ status, reviewedAt }) as Task;

describe("a task's status icon in Recent", () => {
  it.each([
    ["needs-you", "need", "needs you"],
    ["running", "run", "working"],
    ["done", "review", "to check"],
    ["draft", "later", "draft"],
    ["stopped", "stopped", "stopped"],
    ["failed", "failed", "failed"],
  ] as const)("shows %s as %s, named in words", (status, kind, label) => {
    render(<TaskStatusIcon task={task(status)} />);
    const icon = screen.getByRole("img", { name: label });
    expect(icon.classList.contains(kind)).toBe(true);
    expect(icon.getAttribute("title")).toBe(label);
  });

  // The Home page's tilted paper card is styled by .draft, so the icon must not carry that class.
  it("doesn't use the class of Home's draft card", () => {
    render(<TaskStatusIcon task={task("draft")} />);
    expect(screen.getByRole("img", { name: "draft" }).classList.contains("draft")).toBe(false);
  });

  it("shows a check once a finished task has been checked", () => {
    render(<TaskStatusIcon task={task("done", "2026-11-02T10:00:00Z")} />);
    expect(screen.getByRole("img", { name: "done" }).classList.contains("seen")).toBe(true);
  });

  it("names the state for the row's tooltip, the only one visible while the … covers the icon", () => {
    const t = (key: string) => key;
    expect(statusWord(task("needs-you"), t)).toBe("tag.needsYou");
    expect(statusWord(task("done"), t)).toBe("tag.toReview");
    expect(statusWord(task("done", "2026-11-02T10:00:00Z"), t)).toBe("tag.done");
    expect(statusWord(task("stopped"), t)).toBe("tag.stopped");
    expect(statusWord(task("failed"), t)).toBe("tag.failed");
  });
});
