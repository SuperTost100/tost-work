import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";
import { PEEK_FOLD_MS } from "@/shell/Sidebar";

// The sidebar in its place, not the rail nor the sidebar shown over the page from it.
const sections = () => document.querySelector(".app > aside.side");

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

describe("the collapsed sidebar's rail", () => {
  afterEach(() => vi.useRealTimers());
  const hidden = () => createMemoryApi({ name: "Giulia", setupDone: true, sidebarHidden: true });
  const peek = () => document.querySelector(".peek");
  // The rail's listeners are attached in an effect, which may run just after the rail shows: let it run first.
  const findRail = async () => {
    const rail = await screen.findByRole("navigation", { name: "Sections" });
    await act(async () => {});
    return rail;
  };

  it("keeps the sections as icons, which work on their own", async () => {
    render(<Root api={hidden()} />);
    const rail = await findRail();
    expect(rail.classList.contains("rail")).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    });
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Projects" }).getAttribute("aria-current")).toBe("page");
  });

  it("opens the whole sidebar over the page when the pointer rests on it, not when it passes by", async () => {
    render(<Root api={hidden()} />);
    const box = (await findRail()).parentElement as HTMLElement;
    vi.useFakeTimers();
    // Passing by: gone before the wait is over.
    fireEvent.pointerEnter(box);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerLeave(box);
    act(() => vi.advanceTimersByTime(500));
    expect(peek()).toBeNull();

    fireEvent.pointerEnter(box);
    act(() => vi.advanceTimersByTime(200));
    expect(peek()?.querySelector("aside.side")).toBeTruthy();
    expect(sections()).toBeNull();
    // It stays a moment after the pointer leaves, then folds back into the rail and goes.
    fireEvent.pointerLeave(box);
    act(() => vi.advanceTimersByTime(200));
    expect(peek()?.classList.contains("folding")).toBe(false);
    act(() => vi.advanceTimersByTime(100));
    expect(peek()?.classList.contains("folding")).toBe(true);
    // The pointer coming back while it folds opens it again, at once.
    fireEvent.pointerEnter(box);
    act(() => vi.advanceTimersByTime(0));
    expect(peek()?.classList.contains("folding")).toBe(false);
    fireEvent.pointerLeave(box);
    act(() => vi.advanceTimersByTime(300));
    act(() => vi.advanceTimersByTime(PEEK_FOLD_MS));
    expect(peek()).toBeNull();
  });

  it("expands the sidebar from the logo on the rail", async () => {
    const api = hidden();
    render(<Root api={api} />);
    const rail = await findRail();
    await act(async () => {
      fireEvent.click(rail.querySelector(".logo-btn") as Element);
    });
    expect(sections()).toBeTruthy();
    expect((await api.settings.get()).sidebarHidden).toBe(false);
  });

  it("keeps the sidebar open from the one shown over the page", async () => {
    const api = hidden();
    render(<Root api={api} />);
    const box = (await findRail()).parentElement as HTMLElement;
    vi.useFakeTimers();
    fireEvent.pointerEnter(box);
    act(() => vi.advanceTimersByTime(200));
    vi.useRealTimers();
    await click("Keep the sidebar open");
    expect(sections()).toBeTruthy();
    expect(peek()).toBeNull();
    expect((await api.settings.get()).sidebarHidden).toBe(false);
  });

  it("opens for the keyboard on the same item, and Escape gives the focus back to the rail", async () => {
    render(<Root api={hidden()} />);
    const rail = await findRail();
    const skills = rail.querySelector<HTMLElement>('[data-nav="skills"]') as HTMLElement;
    // Only the keyboard's focus shows a ring; jsdom can't tell, so the button says it does.
    const matches = skills.matches.bind(skills);
    Object.defineProperty(skills, "matches", {
      value: (selector: string) => selector === ":focus-visible" || matches(selector),
    });
    await act(async () => {
      skills.focus();
    });
    expect(peek()).toBeTruthy();
    expect(document.activeElement?.closest(".peek")).toBeTruthy();
    expect(document.activeElement?.getAttribute("data-nav")).toBe("skills");

    await act(async () => {
      fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    });
    expect(peek()).toBeNull();
    expect(document.activeElement).toBe(skills);
  });

  it("stays open when a click on its blank space takes the focus from a button, while the pointer is over it", async () => {
    render(<Root api={hidden()} />);
    const box = (await findRail()).parentElement as HTMLElement;
    vi.useFakeTimers();
    fireEvent.pointerEnter(box);
    act(() => vi.advanceTimersByTime(200));
    const inPeek = peek()?.querySelector<HTMLElement>('[data-nav="projects"]') as HTMLElement;
    act(() => inPeek.focus());
    act(() => {
      fireEvent.focusOut(inPeek, { relatedTarget: null });
      vi.advanceTimersByTime(50);
    });
    expect(peek()).toBeTruthy();
    // With the pointer gone, focus going nowhere closes it.
    fireEvent.pointerLeave(box);
    act(() => inPeek.focus());
    act(() => {
      fireEvent.focusOut(inPeek, { relatedTarget: null });
      vi.advanceTimersByTime(50);
    });
    act(() => vi.advanceTimersByTime(PEEK_FOLD_MS));
    expect(peek()).toBeNull();
  });

  it("opens a task to rename it in its header, when Rename is picked in the sidebar over the page", async () => {
    const api = hidden();
    await api.tasks.start({ projectId: null, brief: "Sum up the calls", attachments: [] });
    render(<Root api={api} />);
    const box = (await findRail()).parentElement as HTMLElement;
    vi.useFakeTimers();
    fireEvent.pointerEnter(box);
    act(() => vi.advanceTimersByTime(200));
    vi.useRealTimers();
    api.pickInMenu("rename");
    await click("More for Sum up the calls");
    const field = await screen.findByRole("textbox", { name: "Rename" });
    expect(field.closest(".peek")).toBeNull();
    expect((field as HTMLInputElement).value).toBe("Sum up the calls");
  });

  it("still opens for the keyboard after Escape on a rail button that already had the focus", async () => {
    render(<Root api={hidden()} />);
    const rail = await findRail();
    const box = rail.parentElement as HTMLElement;
    const ringed = (el: HTMLElement) => {
      const matches = el.matches.bind(el);
      Object.defineProperty(el, "matches", {
        value: (selector: string) => selector === ":focus-visible" || matches(selector),
      });
    };
    // Clicked, so focused without a ring, then opened by the resting pointer.
    const projects = rail.querySelector<HTMLElement>('[data-nav="projects"]') as HTMLElement;
    act(() => projects.focus());
    vi.useFakeTimers();
    fireEvent.pointerEnter(box);
    act(() => vi.advanceTimersByTime(200));
    vi.useRealTimers();
    expect(peek()).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(projects, { key: "Escape" });
    });
    expect(peek()).toBeNull();

    const skills = rail.querySelector<HTMLElement>('[data-nav="skills"]') as HTMLElement;
    ringed(skills);
    await act(async () => {
      skills.focus();
    });
    expect(peek()).toBeTruthy();
  });
});
