import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";
import { DEFAULT_SETTINGS } from "../../../shared/model";

const settings = { ...DEFAULT_SETTINGS, name: "Giulia", level: "intermediate" as const, setupDone: true };

// Find first, then act: waiting inside act holds back the updates the wait is for.
const click = async (name: string | RegExp, role: "button" | "switch" | "radio" | "checkbox" = "button") => {
  const target = await screen.findByRole(role, { name });
  await act(async () => {
    fireEvent.click(target);
  });
};

afterEach(() => vi.restoreAllMocks());

describe("jobs", () => {
  it("asks for a project before the first job", async () => {
    render(<App userName="Giulia" api={createMemoryApi()} settings={settings} />);
    await click("Jobs");
    expect(await screen.findByText("No jobs yet.")).toBeTruthy();
    expect(screen.getAllByText(/Make a project first/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "New job" }).hasAttribute("disabled")).toBe(true);
  });

  it("makes a weekly job through the four steps, then skips it once and turns it off", async () => {
    const api = createMemoryApi();
    await api.projects.create({ name: "Newsletter", folder: "/home/giulia/Newsletter" });
    render(<App userName="Giulia" api={api} settings={settings} />);
    await click("Jobs");
    await click("New job");
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "This week" } });
    fireEvent.change(within(dialog).getByLabelText("What to do each time"), {
      target: { value: "Write the This week section from links.md." },
    });
    await click("Next");
    // Every week on Monday is the start; Thursday is added.
    await click("Thu", "checkbox");
    fireEvent.change(within(dialog).getByLabelText("At"), { target: { value: "08:00" } });
    expect(within(dialog).getByText("Every Monday and Thursday at 08:00, in Newsletter: This week.")).toBeTruthy();
    await click("Next");
    await click("In this folder of the project", "radio");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "In this folder of the project" }), {
      target: { value: "Drafts" },
    });
    await click("Next");
    await click("Save job");

    const [job] = await api.jobs.list();
    expect(job).toMatchObject({
      title: "This week",
      schedule: { repeat: "weekly", time: "08:00", days: [1, 4] },
      output: "Drafts",
      on: true,
    });
    expect(await screen.findByText("Every Monday and Thursday at 08:00")).toBeTruthy();
    expect(screen.getByText("Never ran")).toBeTruthy();

    await click("Skip once");
    expect((await api.jobs.list())[0]?.skip).not.toBeNull();
    expect(await screen.findByRole("button", { name: "Don't skip" })).toBeTruthy();

    await click("On: This week", "switch");
    expect((await api.jobs.list())[0]?.on).toBe(false);
    expect(screen.getByRole("region", { name: "Off" })).toBeTruthy();
  });

  it("refuses a job without a name, runs one to try it, and deletes it", async () => {
    const api = createMemoryApi();
    await api.projects.create({ name: "Clients", folder: "/home/giulia/Clients" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App userName="Giulia" api={api} settings={settings} />);
    await click("Jobs");
    await click("New job");
    await click("Next");
    await click("Next");
    await click("Next");
    await click("Save job");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(await api.jobs.list()).toEqual([]);

    await click(/^What/);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Follow-up check" } });
    fireEvent.change(within(dialog).getByLabelText("What to do each time"), {
      target: { value: "List late answers." },
    });
    await click(/^Try it/);
    await click("Save and run once");
    expect(await screen.findByText(/It's running/)).toBeTruthy();
    await click("Open it");
    // The run is a task like any other, titled after the job.
    expect(await screen.findByRole("button", { name: "Stop" })).toBeTruthy();

    await click("Jobs");
    await click("Edit job: Follow-up check");
    await click("Delete job");
    expect(await api.jobs.list()).toEqual([]);
  });

  it("starts the builder in the project whose Add job was clicked", async () => {
    const api = createMemoryApi();
    await api.projects.create({ name: "Clients", folder: "/home/giulia/Clients" });
    const second = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    render(<App userName="Giulia" api={api} settings={settings} />);
    await click("Projects");
    await click(/^Courses/);
    await click("Add");
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Project") as HTMLSelectElement).value).toBe(second.id);
  });

  it("goes back to Home when Jobs is turned off while it's open", async () => {
    const api = createMemoryApi(settings);
    render(<Root api={api} />);
    await click("Jobs");
    expect(await screen.findByText("No jobs yet.")).toBeTruthy();
    await act(async () => api.changeSettings({ sections: { jobs: false } }));
    expect(screen.queryByText("No jobs yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Jobs" })).toBeNull();
  });
});
