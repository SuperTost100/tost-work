import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import type { Task } from "../../../shared/model";
import { mergeTasks, useData } from "./useData";

const task = (id: string, updatedAt: string, title = id): Task => ({
  id,
  projectId: null,
  title,
  brief: id,
  attachments: [],
  workdir: "/tmp",
  model: "m",
  effort: "medium",
  status: "running",
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

describe("useData", () => {
  it("keeps a task that changed before the first list arrived", async () => {
    const api = createMemoryApi();
    const { result } = renderHook(() => useData(api));
    await act(async () => {
      await api.tasks.start({ projectId: null, brief: "Write a proposal" });
    });
    expect(result.current.tasks.map((t) => t.status)).toEqual(["needs-you"]);
  });

  it("merges by id and keeps the newer copy", () => {
    const merged = mergeTasks(
      [task("a", "2026-10-26T09:00:02Z", "new")],
      [task("a", "2026-10-26T09:00:01Z", "old"), task("b", "2026-10-26T09:00:03Z")],
    );
    expect(merged.map((t) => `${t.id}:${t.title}`)).toEqual(["b:b", "a:new"]);
  });
});
