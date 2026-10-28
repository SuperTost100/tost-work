import { describe, expect, it } from "vitest";
import { createMemoryApi } from "./memoryApi";

describe("the memory API's jobs", () => {
  it("never gives a new job the id of one removed, and tags the task a run starts", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Clients", folder: "/home/giulia/Clients" });
    const draft = {
      projectId: project.id,
      title: "Check",
      brief: "Check.",
      schedule: { repeat: "daily" as const, time: "09:00" },
      missed: "run" as const,
      output: "",
    };
    const first = await api.jobs.create(draft);
    const second = await api.jobs.create(draft);
    await api.jobs.remove(first.id);
    const third = await api.jobs.create(draft);
    expect(new Set([second.id, third.id]).size).toBe(2);
    expect((await api.jobs.list()).map((j) => j.id)).toEqual([second.id, third.id]);

    const seen: string[] = [];
    api.tasks.onChange((task) => task.jobId && seen.push(task.jobId));
    await api.jobs.runNow(second.id);
    expect(seen).toContain(second.id);
  });

  it("doesn't bring back a job removed while its run started", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Clients", folder: "/home/giulia/Clients" });
    const job = await api.jobs.create({
      projectId: project.id,
      title: "Check",
      brief: "Check.",
      schedule: { repeat: "daily", time: "09:00" },
      missed: "run",
      output: "",
    });
    const run = api.jobs.runNow(job.id);
    await api.jobs.remove(job.id);
    await run;
    expect(await api.jobs.list()).toEqual([]);
  });
});
