import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";
import type { TostWorkApi } from "../../../shared/api";

// What the page held when a wait ran out, so the next failure of #210 says why: it was seen only once in about 140
// runs under load, and never with this report in place.
const pageState = () => {
  const inPage = document.querySelectorAll('[role="option"]');
  const hider = inPage[0]?.closest('[aria-hidden="true"], [hidden], [inert]');
  return [
    `search dialog in the page: ${document.querySelector(".search-dlg") ? "yes" : "no"}`,
    `results in the page: ${inPage.length}, visible to the test: ${screen.queryAllByRole("option").length}`,
    hider ? `hidden by ${hider.tagName.toLowerCase()}.${hider.className}` : "",
  ]
    .filter(Boolean)
    .join("; ");
};
const withState = (err: Error) => {
  err.message += ` (${pageState()})`;
  return err;
};

// The dialog's field, or with `inDialog` false the sidebar's. It waits for that field itself: the sidebar's is always
// there, so waiting for any field could find only it while the dialog is still opening.
const type = async (text: string, inDialog = true) => {
  // On GitHub's runner the dialog once took just over the default second to open (2026-11-02, failed at 1,043 ms; it
  // passed in every local run, under load too). Three seconds is the wait, not a looser check: the field must still
  // appear.
  const field = await waitFor(
    () => {
      const found = screen
        .getAllByRole("combobox", { name: "Search tasks and projects" })
        .find((f) => f.closest(inDialog ? ".search-dlg" : "aside.side"));
      if (!found) throw new Error(`No search field in the ${inDialog ? "dialog" : "sidebar"} yet`);
      return found;
    },
    { timeout: 3000, onTimeout: withState },
  );
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

// Opens the app and waits until its task and project lists have arrived: the search lists what they hold, and on a busy
// runner ⌘K once landed before them (#210). The lists answer late here every time, so the tests can't pass by luck.
const openApp = async (api: TostWorkApi) => {
  const loads: Promise<unknown>[] = [];
  const late =
    <T,>(list: () => Promise<T>) =>
    () => {
      const answer = new Promise((r) => setTimeout(r, 50)).then(list);
      loads.push(answer);
      return answer;
    };
  api.tasks.list = late(api.tasks.list);
  api.projects.list = late(api.projects.list);
  render(<Root api={api} />);
  await screen.findByRole("button", { name: "Start task" });
  await act(async () => {
    await Promise.all(loads);
  });
  expect(loads.length).toBeGreaterThan(0);
};

const options = () => screen.queryAllByRole("option").map((o) => o.textContent);
// The results right after ⌘K, waited for like the field (#210): read at once, they were missing in two of about 140
// runs under load. The check is the same once they show.
const expectOptions = (check: (shown: (string | null)[]) => void) =>
  waitFor(() => check(options()), { timeout: 3000, onTimeout: withState });

describe("search", () => {
  it("opens with ⌘K on the recent tasks, finds one by its words, and opens it from the keyboard", async () => {
    const api = createMemoryApi();
    await api.tasks.start({ projectId: null, brief: "Preventivo per Rossi srl", attachments: [] });
    await api.tasks.start({ projectId: null, brief: "Perché la fattura Ferrari è ferma", attachments: [] });
    await api.tasks.start({ projectId: null, brief: "Riunione con Bianchi", attachments: [] });
    await openApp(api);
    await key(document.body, { key: "k", ctrlKey: true });
    await expectOptions((shown) => expect(shown).toHaveLength(3));
    const field = await type("ferrari PERCHE", true);
    expect(options()).toEqual([expect.stringContaining("Perché la fattura Ferrari")]);
    await type("r");
    expect(options().length).toBeGreaterThan(1);
    await type("rossi");
    await key(field, { key: "ArrowDown" });
    await key(field, { key: "Enter" });
    expect(document.querySelector(".search-dlg")).toBeNull();
    expect(document.querySelector(".you")?.textContent).toBe("Preventivo per Rossi srl");
  });

  it("searches right in the open sidebar, whose results take the place of its sections until Enter or Escape", async () => {
    const api = createMemoryApi();
    await api.tasks.start({ projectId: null, brief: "Preventivo per Rossi srl", attachments: [] });
    await api.tasks.start({ projectId: null, brief: "Riunione con Bianchi", attachments: [] });
    await openApp(api);
    const side = document.querySelector("aside.side") as HTMLElement;
    const field = await type("rossi", false);
    expect(document.querySelector(".search-dlg")).toBeNull();
    expect(side.querySelector("nav")).toBeNull();
    expect(options()).toEqual([expect.stringContaining("Preventivo per Rossi")]);
    await key(field, { key: "Escape" });
    expect((field as HTMLInputElement).value).toBe("");
    expect(side.querySelector("nav")).toBeTruthy();

    await type("bianchi", false);
    await key(field, { key: "Enter" });
    expect((field as HTMLInputElement).value).toBe("");
    expect(side.querySelector("nav")).toBeTruthy();
    expect(document.querySelector(".you")?.textContent).toBe("Riunione con Bianchi");
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
    await openApp(api);
    await key(window.document.body, { key: "k", ctrlKey: true });
    await type("collina");
    expect(options()).toEqual([expect.stringContaining("Agriturismo La Collina")]);
    await type("zzz");
    expect(await screen.findByText("Nothing matches “zzz”.")).toBeTruthy();
    await key(window.document.body, { key: "k", ctrlKey: true });
    expect(document.querySelector(".search-dlg")).toBeNull();
  });

  it("opens empty again however it was closed, and lists only results for what's typed now", async () => {
    const api = createMemoryApi();
    await api.tasks.start({ projectId: null, brief: "Preventivo per Rossi srl", attachments: [] });
    await api.tasks.start({ projectId: null, brief: "Riunione con Bianchi", attachments: [] });
    // The second search never answers, as a slow one hasn't yet.
    const search = api.tasks.search;
    let calls = 0;
    api.tasks.search = (query) => (++calls === 1 ? search(query) : new Promise(() => {}));
    await openApp(api);
    await key(document.body, { key: "k", ctrlKey: true });
    await type("rossi");
    expect(options()).toEqual([expect.stringContaining("Rossi")]);
    await type("bianchi");
    expect(options()).toEqual([]);
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
    await key(document.body, { key: "k", ctrlKey: true });
    await key(document.body, { key: "k", ctrlKey: true });
    expect((document.querySelector(".search-dlg input") as HTMLInputElement).value).toBe("");
    await expectOptions((shown) => expect(shown).toHaveLength(2));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    expect(document.querySelector(".search-dlg")).toBeNull();
  });

  it("says when the search failed, rather than that nothing matches", async () => {
    const api = createMemoryApi();
    api.tasks.search = () => Promise.reject(new Error("disk"));
    await openApp(api);
    await key(document.body, { key: "k", ctrlKey: true });
    await type("rossi");
    expect(screen.getByRole("alert").textContent).toBe("The search didn't work. Try again.");
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });
});
