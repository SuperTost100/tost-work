/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/model";
import { Store } from "./store";

const task = (id: string, status: Task["status"], updatedAt: string): Task => ({
  id,
  projectId: null,
  title: id,
  brief: id,
  attachments: [],
  model: "m",
  effort: "medium",
  status,
  steps: [],
  files: [],
  messages: [],
  question: null,
  approval: null,
  review: null,
  error: null,
  createdAt: updatedAt,
  updatedAt,
});

describe("Store", () => {
  it("saves projects and lists them in creation order", () => {
    const s = new Store(":memory:");
    s.saveProject({ id: "b", name: "B", description: "", folder: "/b", instructions: "", createdAt: "2026-10-02" });
    s.saveProject({ id: "a", name: "A", description: "", folder: "/a", instructions: "", createdAt: "2026-10-01" });
    s.saveProject({
      id: "a",
      name: "A renamed",
      description: "",
      folder: "/a",
      instructions: "",
      createdAt: "2026-10-01",
    });
    expect(s.listProjects().map((p) => p.name)).toEqual(["A renamed", "B"]);
  });

  it("lists tasks most recent first and updates in place", () => {
    const s = new Store(":memory:");
    s.saveTask(task("old", "done", "2026-10-01T00:00:00Z"));
    s.saveTask(task("new", "draft", "2026-10-02T00:00:00Z"));
    s.saveTask({ ...task("old", "done", "2026-10-03T00:00:00Z"), title: "touched" });
    expect(s.listTasks().map((t) => t.title)).toEqual(["touched", "new"]);
  });

  it("marks tasks left running by a quit as stopped", () => {
    const s = new Store(":memory:");
    s.saveTask(task("r", "running", "2026-10-01T00:00:00Z"));
    s.saveTask({ ...task("q", "needs-you", "2026-10-01T00:00:00Z"), question: { id: "x", text: "?", options: [] } });
    s.saveTask(task("d", "done", "2026-10-01T00:00:00Z"));
    expect(s.stopInterrupted("2026-10-02T00:00:00Z")).toBe(2);
    expect(s.getTask("q")?.status).toBe("stopped");
    expect(s.getTask("q")?.question).toBeNull();
    expect(s.getTask("d")?.status).toBe("done");
  });
});
