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
    // The board's list has every task, newest first.
    const all = s.listAllTasks();
    expect(all).toHaveLength(61);
    expect(all[0]?.id).toBe("n59");
    expect(all.at(-1)?.id).toBe("first");
    expect(s.projectOverviews()).toEqual({
      p1: { tasks: 1, working: 0, needsYou: 0, lastResult: null },
      p2: { tasks: 30, working: 0, needsYou: 0, lastResult: null },
    });
  });

  it("searches every task's title and brief, past the 50 recent ones, newest first", () => {
    const s = new Store(":memory:");
    s.saveTask({ ...task("old", "done", "2026-01-01T00:00:00Z"), title: "Preventivo Rossi", brief: "Perché costa" });
    s.saveTask({ ...task("brief", "done", "2026-01-02T00:00:00Z"), title: "Offerta", brief: "per Rossi srl" });
    for (let i = 0; i < 60; i++) s.saveTask(task(`n${i}`, "done", new Date(Date.UTC(2026, 5, 1, 0, i)).toISOString()));
    expect(s.searchTasks("rossi").map((t) => t.id)).toEqual(["brief", "old"]);
    expect(s.searchTasks("PERCHE rossi").map((t) => t.id)).toEqual(["old"]);
    expect(s.searchTasks("  ")).toEqual([]);
    expect(s.searchTasks("n", 5)).toHaveLength(5);
  });

  it("gives each project what's working, what needs the user, and the newest file made", () => {
    const s = new Store(":memory:");
    const made = (path: string, kind: "add" | "delete" = "add") => ({ path, kind, role: "made" as const });
    s.saveTask({ ...task("a", "done", "2026-10-01T00:00:00Z"), projectId: "p1", files: [made("/p1/Old.docx")] });
    s.saveTask({
      ...task("b", "done", "2026-10-02T00:00:00Z"),
      projectId: "p1",
      files: [made("/p1/Bozza.docx"), made("/p1/Preventivo Ferrari & Figli.docx")],
    });
    // A newer task that only read files, or deleted the one it made, has no result.
    s.saveTask({
      ...task("c", "running", "2026-10-03T00:00:00Z"),
      projectId: "p1",
      files: [{ path: "/p1/note.txt", kind: "add", role: "used" }],
    });
    s.saveTask({
      ...task("d", "needs-you", "2026-10-04T00:00:00Z"),
      projectId: "p1",
      files: [made("/p1/x.md", "delete")],
    });
    s.saveTask({ ...task("e", "running", "2026-10-05T00:00:00Z"), projectId: "p2" });
    expect(s.projectOverviews()).toEqual({
      p1: {
        tasks: 4,
        working: 1,
        needsYou: 1,
        lastResult: { name: "Preventivo Ferrari & Figli.docx", at: "2026-10-02T00:00:00Z" },
      },
      p2: { tasks: 1, working: 1, needsYou: 0, lastResult: null },
    });
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
      modelPick: { preset: "balanced" },
      notifications: true,
      notify: { needsYou: "normal", failed: "normal", done: "off" },
      openAtLogin: false,
      loginOpens: "menuBar",
      stayInMenuBar: true,
      sidebarHidden: false,
      boardView: "list",
      boardGroup: "status",
      debug: false,
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

  it("removes a project with its tasks and jobs, and leaves the other projects alone", () => {
    const store = new Store(":memory:");
    const project = (id: string) => ({
      id,
      name: id,
      description: "",
      folder: `/${id}`,
      instructions: "",
      createdAt: "2026-10-01",
    });
    const job = (id: string, projectId: string) =>
      ({
        id,
        projectId,
        title: id,
        createdAt: "2026-10-28T10:00:00Z",
        schedule: { repeat: "daily", time: "09:00" },
      }) as Job;
    store.saveProject(project("a"));
    store.saveProject(project("b"));
    store.saveTask({ ...task("a1", "done", "2026-10-01T00:00:00Z"), projectId: "a" });
    store.saveTask({ ...task("a2", "running", "2026-10-02T00:00:00Z"), projectId: "a" });
    store.saveTask({ ...task("b1", "done", "2026-10-03T00:00:00Z"), projectId: "b" });
    store.saveTask(task("quick", "done", "2026-10-04T00:00:00Z"));
    store.saveJob(job("ja", "a"));
    store.saveJob(job("jb", "b"));

    expect(store.projectUsage("a")).toEqual({ tasks: 2, jobs: 1 });
    expect(store.removeProject("a")).toEqual(["ja"]);

    expect(store.getProject("a")).toBeUndefined();
    expect(store.listProjectTasks("a")).toEqual([]);
    expect(store.getJob("ja")).toBeUndefined();
    expect(store.listProjects().map((p) => p.id)).toEqual(["b"]);
    expect(
      store
        .listTasks()
        .map((t) => t.id)
        .sort(),
    ).toEqual(["b1", "quick"]);
    expect(store.listJobs().map((j) => j.id)).toEqual(["jb"]);
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

  it("lists every task still working or waiting, however many newer ones finished", () => {
    const store = new Store(":memory:");
    store.saveTask(task("old", "needs-you", "2026-01-01T09:00:00Z"));
    for (let i = 0; i < 60; i++)
      store.saveTask(task(`d${i}`, "done", `2026-10-28T09:${String(i).padStart(2, "0")}:00Z`));
    store.saveTask(task("now", "running", "2026-10-28T11:00:00Z"));
    expect(store.listActiveTasks().map((t) => t.id)).toEqual(["now", "old"]);
  });
});
