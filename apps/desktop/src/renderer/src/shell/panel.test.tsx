import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Panel } from "./Panel";

// jsdom has no ResizeObserver; the panel only needs it to size its window.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver;

describe("the menu-bar panel", () => {
  it("lists what needs the user, what's working and the next jobs, and its buttons open the app", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    // The memory API's tasks stop at a question, so this one needs the user.
    const waiting = await api.tasks.start({ projectId: project.id, brief: "Write the quote", attachments: [] });
    const working = await api.tasks.start({ projectId: project.id, brief: "Sum up the calls", attachments: [] });
    act(() => api.emit(working.id, { type: "withdrawn", id: "q1" }));
    await api.jobs.create({
      projectId: project.id,
      title: "Invoice check",
      brief: "Check the invoices.",
      schedule: { repeat: "daily", time: "09:00" },
      missed: "run",
      output: "",
    });
    render(<Panel api={api} />);

    expect(await screen.findByText("Needs you")).toBeTruthy();
    expect(screen.getByText("Write the quote")).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("Sum up the calls")).toBeTruthy();
    expect(await screen.findByText("Invoice check")).toBeTruthy();
    expect(screen.queryByText(/All quiet/)).toBeNull();

    fireEvent.click(screen.getByText("Write the quote"));
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Tost Work" }));
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(api.panelCalls.open).toEqual([
      { taskId: waiting.id },
      { action: "new-task" },
      { action: "settings" },
      undefined,
    ]);
    expect(api.panelCalls.quit).toBe(1);
  });

  it("shows a project's new name the next time it opens", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    await api.tasks.start({ projectId: project.id, brief: "Write the quote", attachments: [] });
    render(<Panel api={api} />);
    expect(await screen.findByText("Courses")).toBeTruthy();
    await api.projects.update(project.id, { name: "AI courses" });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText("AI courses")).toBeTruthy();
  });

  it("lists a waiting task even when it's older than the recent list", async () => {
    const api = createMemoryApi();
    await api.tasks.start({ projectId: null, brief: "An old quote", attachments: [] });
    // The recent list stops at 50 tasks; this one is past it.
    api.tasks.list = async () => [];
    render(<Panel api={api} />);
    expect(await screen.findByText("An old quote")).toBeTruthy();
  });

  it("says all is quiet when nothing works or waits", async () => {
    render(<Panel api={createMemoryApi()} />);
    expect(await screen.findByText("All quiet: nothing is working or waiting for you.")).toBeTruthy();
  });
});
