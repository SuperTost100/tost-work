import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";
import { Skills } from "./Skills";

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

    expect((await api.skills.list()).filter((s) => !s.builtIn)).toMatchObject([
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
    expect((await api.skills.list()).filter((s) => !s.builtIn).map((s) => s.title)).toEqual(["Brand voice"]);
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
    expect((await api.skills.list()).filter((s) => !s.builtIn).map((s) => s.title)).toEqual(["Price table"]);
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

  it("shows the built-in guides read-only, and Duplicate makes an editable copy", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await click("Skills");
    // With none of their own yet, the page invites the user to make one, and lists the guides.
    expect(await screen.findByText("No skills yet.")).toBeTruthy();
    await click("Word documents");
    expect((screen.getByLabelText("Skill name") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText("Comes with Tost Work · read-only")).toBeTruthy();
    await click("Duplicate to edit");
    const name = screen.getByLabelText("Skill name") as HTMLInputElement;
    expect(name.readOnly).toBe(false);
    expect((await api.skills.list()).filter((s) => !s.builtIn).map((s) => s.id)).toEqual(["word-documents-copy"]);
  });

  it("keeps a version with its note on each save, and puts an old one back", async () => {
    const api = createMemoryApi();
    await api.skills.create("Proposal writer");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Root api={api} />);
    await click("Skills");
    await screen.findByLabelText("Skill name");
    fireEvent.change(screen.getByLabelText("What to do"), { target: { value: "1. Round prices." } });
    fireEvent.change(screen.getByLabelText("What changed, if you like"), { target: { value: "price rounding" } });
    await click("Save");
    expect(await screen.findByText("v2 · price rounding")).toBeTruthy();
    expect(screen.getByText(/^Version 2/)).toBeTruthy();

    await click("Restore v1");
    expect((screen.getByLabelText("What to do") as HTMLTextAreaElement).value).toBe("");
    // v1 is current again, with v2 still there to put back.
    expect(await screen.findByText(/^Version 1/)).toBeTruthy();
    expect(document.querySelector(".vers .current")?.textContent).toMatch(/^v1/);
    expect(screen.getByRole("button", { name: "Restore v2" })).toBeTruthy();
    expect(screen.queryByText(/^v3/)).toBeNull();
  });

  it("imports a skill, and says how many tasks used it", async () => {
    const api = createMemoryApi();
    const tasks = [{ skillsUsed: ["meeting-notes"] }, { skillsUsed: ["meeting-notes", "@word", "word"] }] as never[];
    render(<Skills api={api} tasks={tasks} />);
    await click("Import a skill");
    expect(((await screen.findByLabelText("Skill name")) as HTMLInputElement).value).toBe("Meeting notes");
    expect(screen.getByText("Version 1 · used 2 times · Available in every project")).toBeTruthy();
  });

  it("makes one copy of a guide however often Duplicate is clicked while it works", async () => {
    const api = createMemoryApi();
    const realDuplicate = api.skills.duplicate;
    let finish = () => {};
    let calls = 0;
    api.skills.duplicate = (id) => {
      calls++;
      return new Promise((resolve) => {
        finish = () => void realDuplicate(id).then(resolve);
      });
    };
    render(<Root api={api} />);
    await click("Skills");
    await click("Word documents");
    const button = screen.getByRole("button", { name: "Duplicate to edit" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await act(async () => finish());
    expect(calls).toBe(1);
  });
});
