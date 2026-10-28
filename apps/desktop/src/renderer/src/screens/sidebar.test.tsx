import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";

const sections = () => screen.queryByRole("navigation", { name: "Sections" });

// Find first, then act: waiting inside act holds back the updates the wait is for.
const click = async (name: string) => {
  const target = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(target);
  });
};

const press = async (target: Element, init: KeyboardEventInit) => {
  await act(async () => {
    fireEvent.keyDown(target, { key: "b", ...init });
  });
};

describe("the sidebar", () => {
  it("hides with its button, comes back with the one in the top bar, and remembers the choice", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    expect(sections()).toBeTruthy();

    await click("Collapse sidebar");
    expect(sections()).toBeNull();
    expect((await api.settings.get()).sidebarHidden).toBe(true);

    await click("Expand sidebar");
    expect(sections()).toBeTruthy();
    expect((await api.settings.get()).sidebarHidden).toBe(false);
  });

  it("starts hidden when it was left hidden", async () => {
    render(<Root api={createMemoryApi({ name: "Giulia", setupDone: true, sidebarHidden: true })} />);
    expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeTruthy();
    expect(sections()).toBeNull();
  });

  it("toggles with Ctrl+B, and ignores Cmd+B where Cmd is not the shortcut key", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });

    await press(document.body, { ctrlKey: true });
    expect(sections()).toBeNull();
    // The memory API reports Linux, so Cmd+B does nothing here.
    await press(document.body, { metaKey: true });
    expect(sections()).toBeNull();
    await press(document.body, { ctrlKey: true });
    expect(sections()).toBeTruthy();
  });

  it("takes a second quick press as undoing the first, even before the first is saved", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
      fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    });
    expect(sections()).toBeTruthy();
    expect((await api.settings.get()).sidebarHidden).toBe(false);
  });

  it("forgets a press that couldn't be saved, so the next press asks again", async () => {
    const api = createMemoryApi();
    const update = api.settings.update;
    api.settings.update = async () => {
      throw new Error("Disk full");
    };
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await press(document.body, { ctrlKey: true });
    expect(sections()).toBeTruthy();
    api.settings.update = update;
    await press(document.body, { ctrlKey: true });
    expect(sections()).toBeNull();
  });

  it("leaves Ctrl+B to text fields, so the Skills editor still makes text bold", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await press(await screen.findByRole("textbox"), { ctrlKey: true });
    expect(sections()).toBeTruthy();

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const inner = document.createElement("p");
    editor.append(inner);
    document.body.append(editor);
    await press(inner, { ctrlKey: true });
    editor.remove();
    expect(sections()).toBeTruthy();
    expect((await api.settings.get()).sidebarHidden).toBe(false);
  });

  it("toggles from the View menu", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await act(async () => {});
    await act(async () => {
      api.pressMenu("toggle-sidebar");
    });
    expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });
});
