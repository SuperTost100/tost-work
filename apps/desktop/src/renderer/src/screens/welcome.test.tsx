import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "@/App";
import { createMemoryApi } from "@/lib/memoryApi";
import { DEFAULT_SETTINGS, type Settings } from "../../../shared/model";

/** The app as someone sees it the first time they reach Home after an update, with their settings kept as they change. */
function open(welcomed: Settings["welcomed"] = null) {
  const api = createMemoryApi({ name: "Giulia", setupDone: true, welcomed });
  const settings = { ...DEFAULT_SETTINGS, name: "Giulia", setupDone: true, welcomed };
  const saved: Settings[] = [];
  render(<App userName="Giulia" api={api} settings={settings} onSettings={(s) => saved.push(s)} />);
  return { api, saved };
}

const press = async (target: HTMLElement) => {
  await act(async () => {
    fireEvent.click(target);
  });
};

// Builds before 1.0.0 carry a stage; 1.0.0 has no welcome card, and these tests go with it then.
describe("the pre-release welcome card", () => {
  it("greets the user on Home once per update, and remembers when it's closed", async () => {
    const { api, saved } = open();
    const card = await screen.findByRole("dialog");
    expect(within(card).getByRole("img", { name: "Tost" })).toBeTruthy();
    expect(card.textContent).toContain("Report a problem");
    await press(within(card).getByRole("button", { name: "Get started" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await api.settings.get()).welcomed).toBe(__APP_VERSION__);
    expect(saved.at(-1)?.welcomed).toBe(__APP_VERSION__);
  });

  it("stays closed for someone who has already seen it in this version", async () => {
    open(__APP_VERSION__);
    await screen.findByRole("button", { name: "Start task" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("comes back after an update", async () => {
    open("0.0.1-dev");
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("hands over to the report card, which links to the filled-in bug form", async () => {
    const { api } = open();
    const card = await screen.findByRole("dialog");
    await press(within(card).getByRole("button", { name: "Report a problem" }));
    const report = await screen.findByRole("dialog", { name: "Report a problem" });
    const link = within(report).getByRole("link", { name: /Open GitHub/ });
    const url = new URL(link.getAttribute("href") ?? "");
    expect(url.searchParams.get("template")).toBe("bug.yml");
    expect(url.searchParams.get("version")).toContain(__APP_VERSION__);
    expect((await api.settings.get()).welcomed).toBe(__APP_VERSION__);
  });
});

describe("Report a problem", () => {
  it("opens from Settings, above What's new", async () => {
    open(__APP_VERSION__);
    await press(await screen.findByRole("button", { name: "Settings" }));
    const nav = await screen.findByRole("navigation", { name: "Settings" });
    const items = within(nav)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(items.indexOf("Report a problem")).toBe(items.indexOf("What's new") - 1);
    await press(within(nav).getByRole("button", { name: "Report a problem" }));
    expect(await screen.findByRole("dialog", { name: "Report a problem" })).toBeTruthy();
  });
});
