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
  workdir: "/tmp",
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

  it("stops interrupted tasks however old they are", () => {
    const s = new Store(":memory:");
    s.saveTask(task("old-running", "running", "2026-01-01T00:00:00Z"));
    for (let i = 0; i < 1100; i++)
      s.saveTask(task(`d${i}`, "done", `2026-10-01T00:00:${String(i % 60).padStart(2, "0")}Z`));
    expect(s.stopInterrupted("2026-10-02T00:00:00Z")).toBe(1);
    expect(s.getTask("old-running")?.status).toBe("stopped");
  });

  it("lists a project's whole history, past the 50 recent tasks, and counts tasks per project", () => {
    const s = new Store(":memory:");
    s.saveTask({ ...task("first", "done", "2026-01-01T00:00:00Z"), projectId: "p1" });
    for (let i = 0; i < 60; i++) {
      const at = new Date(Date.UTC(2026, 5, 1, 0, i)).toISOString();
      s.saveTask({ ...task(`n${i}`, "done", at), projectId: i % 2 ? "p2" : null });
    }
    expect(s.listTasks().some((t) => t.id === "first")).toBe(false);
    expect(s.listProjectTasks("p1").map((t) => t.id)).toEqual(["first"]);
    expect(s.taskCounts()).toEqual({ p1: 1, p2: 30 });
  });

  it("returns default settings until some are saved, and keeps defaults for new fields", () => {
    const store = new Store(":memory:");
    expect(store.getSettings()).toEqual({ name: "", level: "beginner", language: null, setupDone: false });
    store.saveSettings({ name: "Giulia", level: "advanced", language: "it", setupDone: true });
    expect(store.getSettings().name).toBe("Giulia");
    expect(store.getSettings().level).toBe("advanced");
  });
});
