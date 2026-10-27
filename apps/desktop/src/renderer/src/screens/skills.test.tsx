import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";

// Find first, then act: waiting inside act holds back the updates the wait is for.
const click = async (name: string | RegExp) => {
  const target = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(target);
  });
};

afterEach(() => vi.restoreAllMocks());

describe("skills", () => {
  it("starts empty, makes a skill, edits and saves it", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await click("Skills");
    expect(await screen.findByText("No skills yet.")).toBeTruthy();

    await click("New skill");
    const name = await screen.findByLabelText("Skill name");
    expect((name as HTMLInputElement).value).toBe("New skill");
    // Nothing changed yet, so there's nothing to save.
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(name, { target: { value: "Proposal writer" } });
    fireEvent.change(screen.getByLabelText("When to use it"), { target: { value: "A client asks for a proposal." } });
    fireEvent.change(screen.getByLabelText("What to do"), { target: { value: "1. Read the call notes." } });
    await click("Save");

    expect(await api.skills.list()).toMatchObject([
      { id: "proposal-writer", title: "Proposal writer", description: "A client asks for a proposal." },
    ]);
    expect(screen.getByRole("button", { name: "Proposal writer" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("asks before leaving unsaved changes, and deletes a skill once confirmed", async () => {
    const api = createMemoryApi();
    await api.skills.create("Brand voice");
    await api.skills.create("Price table");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Root api={api} />);
    await click("Skills");
    await screen.findByLabelText("Skill name");

    fireEvent.change(screen.getByLabelText("When to use it"), { target: { value: "Changed" } });
    await click("Price table");
    // Refused: the edit stays on screen.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Skill name") as HTMLInputElement).value).toBe("Brand voice");

    confirm.mockReturnValue(true);
    await click("Price table");
    expect((screen.getByLabelText("Skill name") as HTMLInputElement).value).toBe("Price table");

    await click("Add a file");
    expect(await screen.findByText("template.docx")).toBeTruthy();

    // Delete is in the skill's … menu, as for a task.
    api.pickInMenu("delete");
    await click("More for Price table");
    expect((await api.skills.list()).map((s) => s.title)).toEqual(["Brand voice"]);
    expect((screen.getByLabelText("Skill name") as HTMLInputElement).value).toBe("Brand voice");
  });

  it("opens the same menu on right-click, and Rename puts the cursor in the name", async () => {
    const api = createMemoryApi();
    await api.skills.create("Brand voice");
    await api.skills.create("Price table");
    render(<Root api={api} />);
    await click("Skills");
    await screen.findByLabelText("Skill name");

    api.pickInMenu("rename");
    const row = screen.getByRole("button", { name: "Price table" });
    await act(async () => {
      fireEvent.contextMenu(row);
    });
    const name = screen.getByLabelText("Skill name") as HTMLInputElement;
    expect(name.value).toBe("Price table");
    expect(document.activeElement).toBe(name);

    // Deleting a skill that isn't open leaves the open one on screen.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.pickInMenu("delete");
    await act(async () => {
      fireEvent.contextMenu(screen.getByRole("button", { name: "Brand voice" }));
    });
    expect((await api.skills.list()).map((s) => s.title)).toEqual(["Price table"]);
    expect(name.value).toBe("Price table");
  });

  it("moves the editor off a skill that was opened while it was being deleted", async () => {
    const api = createMemoryApi();
    await api.skills.create("Brand voice");
    await api.skills.create("Price table");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const realRemove = api.skills.remove;
    let finish = () => {};
    api.skills.remove = (id) =>
      new Promise((resolve) => {
        finish = () => void realRemove(id).then(resolve);
      });
    render(<Root api={api} />);
    await click("Skills");
    await screen.findByLabelText("Skill name");

    api.pickInMenu("delete");
    await click("More for Price table");
    await click("Price table");
    expect((screen.getByLabelText("Skill name") as HTMLInputElement).value).toBe("Price table");
    await act(async () => finish());
    expect(screen.queryByRole("button", { name: "Price table" })).toBeNull();
    expect((screen.getByLabelText("Skill name") as HTMLInputElement).value).toBe("Brand voice");
  });

  it("keeps the editor on a skill that's still there when two deletes finish together", async () => {
    const api = createMemoryApi();
    await api.skills.create("Brand voice");
    await api.skills.create("Price table");
    await api.skills.create("Zoom notes");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const realRemove = api.skills.remove;
    const pending: (() => Promise<void>)[] = [];
    api.skills.remove = (id) =>
      new Promise((resolve) => {
        pending.push(() => realRemove(id).then(resolve));
      });
    render(<Root api={api} />);
    await click("Skills");
    await screen.findByLabelText("Skill name");
    // Brand voice is open; delete it and the next one, then let both finish at once.
    api.pickInMenu("delete");
    await click("More for Brand voice");
    await click("More for Price table");
    await act(async () => {
      await Promise.all(pending.map((finish) => finish()));
    });
    expect((screen.getByLabelText("Skill name") as HTMLInputElement).value).toBe("Zoom notes");
  });
});
