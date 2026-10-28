import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { createMemoryApi } from "@/lib/memoryApi";
import { DEFAULT_SETTINGS, type JobDraft } from "../../../shared/model";

const settings = { ...DEFAULT_SETTINGS, name: "Giulia", level: "intermediate" as const, setupDone: true };

const JOB: JobDraft = {
  projectId: "p1",
  title: "Follow-up check",
  brief: "List the proposals with no answer.",
  schedule: { repeat: "daily", time: "09:00" },
  missed: "run",
  output: "",
};

// Find first, then act: waiting inside act holds back the updates the wait is for.
const click = async (name: string | RegExp) => {
  const target = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(target);
  });
};

/** A project page or the Projects screen, with a project named Alpi in it. */
const setup = async (open: "projects" | "project" = "projects") => {
  const api = createMemoryApi();
  const project = await api.projects.create({ name: "Alpi", folder: "/home/giulia/Alpi" });
  render(<App userName="Giulia" api={api} settings={settings} />);
  await click("Projects");
  if (open === "project") await click(/^Alpi/);
  return { api, project };
};

/** Puts text in the formatted editor as a paste does, formatting included. */
const typeInstructions = async (html: string) => {
  const box = await screen.findByRole("textbox", { name: "Instructions" });
  await waitFor(() => expect(box.getAttribute("contenteditable")).not.toBeNull());
  const text = html.replace(/<[^>]+>/g, "");
  await act(async () => {
    fireEvent.paste(box, {
      clipboardData: {
        types: ["text/html", "text/plain"],
        getData: (type: string) => (type === "text/html" ? html : text),
      },
    });
  });
};

afterEach(() => vi.restoreAllMocks());

describe("the project menu: rename", () => {
  it("renames a project in place on its card, from the … button", async () => {
    const { api } = await setup();
    api.pickInProjectMenu("rename");
    await click("More for Alpi");
    const field = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(field, { target: { value: "Alpi Logistica" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(await screen.findByRole("heading", { name: "Alpi Logistica" })).toBeTruthy();
    expect((await api.projects.list())[0]?.name).toBe("Alpi Logistica");
  });

  it("keeps the old name on Escape, from a right-click on the card", async () => {
    const { api } = await setup();
    api.pickInProjectMenu("rename");
    await act(async () => {
      fireEvent.contextMenu(screen.getByRole("heading", { name: "Alpi" }));
    });
    const field = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(field, { target: { value: "Something else" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();
    expect((await api.projects.list())[0]?.name).toBe("Alpi");
  });

  it("renames from the project page's header", async () => {
    const { api } = await setup("project");
    api.pickInProjectMenu("rename");
    await click("More for Alpi");
    const field = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(field, { target: { value: "Alpi Logistica" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Alpi Logistica" })).toBeTruthy();
    expect((await api.projects.list())[0]?.name).toBe("Alpi Logistica");
  });
});

describe("the project menu: instructions", () => {
  it("edits the instructions from the menu and saves them as Markdown", async () => {
    const { api } = await setup();
    api.pickInProjectMenu("instructions");
    await click("More for Alpi");
    expect(await screen.findByRole("dialog", { name: "Instructions for Alpi" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    await typeInstructions("<ul><li><p>Write in <strong>Italian</strong>.</p></li></ul>");
    await click("Save");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await api.projects.list())[0]?.instructions).toBe("- Write in **Italian**.");
  });

  it("opens from the Instructions row, shows what was saved, and Cancel keeps it", async () => {
    const { api } = await setup("project");
    expect(screen.getByText("None yet")).toBeTruthy();
    await click(/Instructions/);
    await typeInstructions("<p>Always cite the <strong>source</strong>.</p><ul><li><p>In Italian</p></li></ul>");
    await click("Save");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The page shows the saved text without its Markdown marks, and the dialog starts from it.
    expect(screen.getByText("Always cite the source. In Italian")).toBeTruthy();
    await click(/Instructions/);
    const box = await screen.findByRole("textbox", { name: "Instructions" });
    await waitFor(() => expect(box.textContent).toContain("Always cite the source."));
    await typeInstructions("<p>Something else</p>");
    await click("Cancel");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await api.projects.list())[0]?.instructions).toBe("Always cite the **source**.\n\n- In Italian");
  });

  it("shows a failed save in the dialog and keeps it open", async () => {
    const { api } = await setup("project");
    vi.spyOn(api.projects, "update").mockRejectedValue(new Error("Disk is full"));
    await click(/Instructions/);
    await typeInstructions("<p>Be brief.</p>");
    await click("Save");
    expect((await screen.findByRole("alert")).textContent).toContain("Disk is full");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("the project menu: show the folder", () => {
  it("opens the project's folder", async () => {
    const { api, project } = await setup();
    const shown: string[] = [];
    api.projects.reveal = async (id) => {
      shown.push(id);
    };
    api.pickInProjectMenu("reveal");
    await click("More for Alpi");
    expect(shown).toEqual([project.id]);
  });
});

describe("the project menu: remove", () => {
  const withWork = async () => {
    const { api, project } = await setup();
    await api.tasks.start({ projectId: project.id, brief: "First outline", attachments: [] });
    await api.tasks.start({ projectId: project.id, brief: "Second outline", attachments: [] });
    await api.jobs.create({ ...JOB, projectId: project.id });
    const other = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    await api.tasks.start({ projectId: other.id, brief: "Course outline", attachments: [] });
    return { api, project, other };
  };

  it("keeps everything when the user doesn't confirm", async () => {
    const { api, project } = await withWork();
    api.confirmRemoval(false);
    api.pickInProjectMenu("remove");
    await click("More for Alpi");
    expect((await api.projects.list()).map((p) => p.id)).toContain(project.id);
    expect(await api.tasks.listForProject(project.id)).toHaveLength(2);
    expect(await api.jobs.list()).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Alpi" })).toBeTruthy();
  });

  it("removes the project with its tasks and jobs, and leaves the others", async () => {
    const { api, project, other } = await withWork();
    api.pickInProjectMenu("remove");
    await act(async () => {
      fireEvent.contextMenu(screen.getByRole("heading", { name: "Alpi" }));
    });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Alpi" })).toBeNull());
    expect((await api.projects.list()).map((p) => p.name)).toEqual(["Courses"]);
    expect(await api.tasks.listForProject(project.id)).toEqual([]);
    expect(await api.jobs.list()).toEqual([]);
    expect(await api.tasks.listForProject(other.id)).toHaveLength(1);
    // Recent no longer lists the removed project's tasks.
    expect(screen.queryByText("First outline")).toBeNull();
    expect(screen.getAllByText("Course outline").length).toBeGreaterThan(0);
  });

  it("goes Home when the open project is removed", async () => {
    const { api } = await setup("project");
    api.pickInProjectMenu("remove");
    await click("More for Alpi");
    expect(await screen.findByRole("button", { name: "Start task" })).toBeTruthy();
    expect(await api.projects.list()).toEqual([]);
  });
});
