import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";

const press = async (api: ReturnType<typeof createMemoryApi>, action: Parameters<typeof api.pressMenu>[0]) => {
  // Let React finish its effects first: the window subscribes to the menu in one, and on a slow machine a press could
  // otherwise arrive before anyone listens.
  await act(async () => {});
  await act(async () => {
    api.pressMenu(action);
  });
};

describe("the menu bar", () => {
  it("opens Settings, New project and a new task", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await press(api, "settings");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Level and sections");
    await press(api, "new-task");
    expect(await screen.findByRole("button", { name: "Start task" })).toBeTruthy();
    await press(api, "new-project");
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("sends the brief, then stops, renames and shows the open task", async () => {
    const api = createMemoryApi();
    const revealed: string[] = [];
    api.tasks.reveal = async (id) => {
      revealed.push(id);
    };
    render(<Root api={api} />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Write a proposal" } });
    await press(api, "send");
    const [task] = await api.tasks.list();
    expect(task?.title).toBe("Write a proposal");

    await press(api, "rename");
    expect(screen.getByRole("textbox", { name: "Rename" })).toBeTruthy();
    expect(api.menuStateNow()).toEqual({ task: true, running: true });
    await press(api, "reveal");
    expect(revealed).toEqual([task?.id]);
    await press(api, "stop");
    expect((await api.tasks.get(task?.id ?? ""))?.status).toBe("stopped");
  });

  it("selects the newest file the task made when showing it in the folder", async () => {
    const api = createMemoryApi();
    const shown: string[] = [];
    api.files.reveal = async (_id, path) => {
      shown.push(path);
    };
    render(<Root api={api} />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Write a proposal" } });
    await press(api, "send");
    const [task] = await api.tasks.list();
    await act(async () => {
      api.emit(task?.id ?? "", { type: "file", change: { path: "/w/notes.docx", kind: "add", role: "made" } });
      api.emit(task?.id ?? "", { type: "file", change: { path: "/w/brief.pdf", kind: "update", role: "used" } });
    });
    await press(api, "reveal");
    expect(shown).toEqual(["/w/notes.docx"]);
  });

  it("renames a recent task in its own header while the sidebar is hidden", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true, sidebarHidden: true });
    render(<Root api={api} />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Write a proposal" } });
    await press(api, "send");
    await press(api, "rename");
    expect(screen.getByRole("textbox", { name: "Rename" })).toBeTruthy();
  });

  it("renames a task Recent doesn't show, in its own header", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
    for (let i = 1; i <= 9; i++) await api.tasks.start({ projectId: project.id, brief: `Draft ${i}`, attachments: [] });
    render(<Root api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Proposals/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Draft 1(?!\d)/ }));
    await press(api, "rename");
    const field = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(field, { target: { value: "First draft" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    const tasks = await api.tasks.list();
    expect(tasks.find((t) => t.brief === "Draft 1")?.title).toBe("First draft");
  });

  it("puts a picked file in the task box for a quick edit", async () => {
    const api = createMemoryApi();
    api.files.pick = async () => ["/home/giulia/Contract.docx"];
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await press(api, "quick-edit");
    expect(await screen.findByText("Contract.docx")).toBeTruthy();
  });

  it("follows settings changed from the menu, such as the theme", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await act(async () => api.changeSettings({ theme: "dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
