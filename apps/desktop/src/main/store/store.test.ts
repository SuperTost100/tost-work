/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Job, type Task } from "../../shared/model";
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

  it("marks tasks left working by a quit as interrupted, and leaves one waiting for the user as it was", () => {
    const s = new Store(":memory:");
    s.saveTask(task("r", "running", "2026-10-01T00:00:00Z"));
    s.saveTask({ ...task("q", "needs-you", "2026-10-01T00:00:00Z"), question: { id: "x", text: "?", options: [] } });
    s.saveTask(task("d", "done", "2026-10-01T00:00:00Z"));
    expect(s.stopInterrupted("2026-10-02T00:00:00Z")).toBe(1);
    expect(s.getTask("r")).toMatchObject({ status: "stopped", interrupted: true });
    // Its agent ended its turn to ask, so the answer still starts the next one after a restart.
    expect(s.getTask("q")).toMatchObject({ status: "needs-you", question: { id: "x" } });
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
    expect(store.getSettings()).toEqual({
      name: "",
      work: "",
      notes: "",
      level: "beginner",
      language: null,
      sections: {},
      textSize: "normal",
      theme: "system",
      defaultAi: null,
      notifications: true,
      notify: { needsYou: "normal", failed: "normal", done: "off" },
      openAtLogin: false,
      setupDone: false,
    });
    store.saveSettings({ ...DEFAULT_SETTINGS, name: "Giulia", level: "advanced", language: "it", setupDone: true });
    expect(store.getSettings().name).toBe("Giulia");
    expect(store.getSettings().level).toBe("advanced");
  });

  it("keeps jobs, oldest first, and forgets a deleted one", () => {
    const store = new Store(":memory:");
    const job = (id: string, createdAt: string) =>
      ({ id, projectId: "p", title: id, createdAt, schedule: { repeat: "daily", time: "09:00" } }) as Job;
    store.saveJob(job("b", "2026-10-28T10:00:00Z"));
    store.saveJob(job("a", "2026-10-27T10:00:00Z"));
    store.saveJob({ ...job("b", "2026-10-28T10:00:00Z"), title: "Renamed" });
    expect(store.listJobs().map((j) => [j.id, j.title])).toEqual([
      ["a", "a"],
      ["b", "Renamed"],
    ]);
    store.deleteJob("a");
    expect(store.getJob("a")).toBeUndefined();
    expect(store.listJobs()).toHaveLength(1);
  });

  it("says whether any run of a job still needs the user or is working", () => {
    const store = new Store(":memory:");
    store.saveTask({ ...task("a", "needs-you", "2026-10-28T09:00:00Z"), jobId: "j" });
    store.saveTask({ ...task("b", "done", "2026-10-29T09:00:00Z"), jobId: "j" });
    store.saveTask({ ...task("c", "running", "2026-10-29T09:00:00Z"), jobId: "other" });
    expect(store.jobBusy("j")).toBe(true);
    store.saveTask({ ...task("a", "done", "2026-10-29T10:00:00Z"), jobId: "j" });
    expect(store.jobBusy("j")).toBe(false);
  });
});
