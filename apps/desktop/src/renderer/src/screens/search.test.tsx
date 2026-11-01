import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";

const type = async (text: string) => {
  const field = await screen.findByRole("combobox", { name: "Search tasks and projects" });
  await act(async () => {
    fireEvent.change(field, { target: { value: text } });
  });
  return field;
};

const key = async (target: Element, init: KeyboardEventInit) => {
  await act(async () => {
    fireEvent.keyDown(target, init);
  });
};

const options = () => screen.queryAllByRole("option").map((o) => o.textContent);

describe("search", () => {
  it("opens from the sidebar with the recent tasks, finds one by its words, and opens it from the keyboard", async () => {
    const api = createMemoryApi();
    await api.tasks.start({ projectId: null, brief: "Preventivo per Rossi srl", attachments: [] });
    await api.tasks.start({ projectId: null, brief: "Perché la fattura Ferrari è ferma", attachments: [] });
    await api.tasks.start({ projectId: null, brief: "Riunione con Bianchi", attachments: [] });
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Search/ }));
    });
    expect(options()).toHaveLength(3);
    const field = await type("ferrari PERCHE");
    expect(options()).toEqual([expect.stringContaining("Perché la fattura Ferrari")]);
    await type("r");
    expect(options().length).toBeGreaterThan(1);
    await type("rossi");
    await key(field, { key: "ArrowDown" });
    await key(field, { key: "Enter" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.querySelector(".you")?.textContent).toBe("Preventivo per Rossi srl");
  });

  it("opens from the rail's icon, with the sidebar collapsed", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true, sidebarHidden: true });
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Expand sidebar" });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    });
    expect(screen.getByRole("combobox", { name: "Search tasks and projects" })).toBeTruthy();
  });

  it("opens and closes with Ctrl+K, finds projects, and says when nothing matches", async () => {
    const api = createMemoryApi();
    await api.projects.create({ name: "Agriturismo La Collina", folder: "/home/giulia/Collina" });
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await key(window.document.body, { key: "k", ctrlKey: true });
    await type("collina");
    expect(options()).toEqual([expect.stringContaining("Agriturismo La Collina")]);
    await type("zzz");
    expect(await screen.findByText("Nothing matches “zzz”.")).toBeTruthy();
    await key(window.document.body, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("opens empty again however it was closed, and lists only results for what's typed now", async () => {
    const api = createMemoryApi();
    await api.tasks.start({ projectId: null, brief: "Preventivo per Rossi srl", attachments: [] });
    await api.tasks.start({ projectId: null, brief: "Riunione con Bianchi", attachments: [] });
    // The second search never answers, as a slow one hasn't yet.
    const search = api.tasks.search;
    let calls = 0;
    api.tasks.search = (query) => (++calls === 1 ? search(query) : new Promise(() => {}));
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await key(document.body, { key: "k", ctrlKey: true });
    await type("rossi");
    expect(options()).toEqual([expect.stringContaining("Rossi")]);
    await type("bianchi");
    expect(options()).toEqual([]);
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
    await key(document.body, { key: "k", ctrlKey: true });
    await key(document.body, { key: "k", ctrlKey: true });
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
    expect(options()).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("says when the search failed, rather than that nothing matches", async () => {
    const api = createMemoryApi();
    api.tasks.search = () => Promise.reject(new Error("disk"));
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await key(document.body, { key: "k", ctrlKey: true });
    await type("rossi");
    expect(screen.getByRole("alert").textContent).toBe("The search didn't work. Try again.");
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });
});
