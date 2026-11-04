import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";

const click = async (name: string | RegExp) => {
  const target = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(target);
  });
};

const aboutPage = async (api = createMemoryApi()) => {
  render(<Root api={api} />);
  await click("Settings");
  // The last item in Settings' own list, as in the mockup.
  const nav = screen.getByRole("navigation", { name: "Settings" });
  expect(within(nav).getAllByRole("button").at(-1)?.textContent).toBe("About");
  await act(async () => {
    fireEvent.click(within(nav).getByRole("button", { name: "About" }));
  });
};

describe("About", () => {
  it("is reached from Settings, under the crumb Settings / About", async () => {
    await aboutPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tost Work.AI that works with you.");
    const crumb = screen.getByRole("navigation", { name: "About" });
    expect(crumb.textContent).toBe("Settings/About");
    expect(within(crumb).getByText("About").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText(`${__APP_VERSION__} · build ${__APP_BUILD__}`)).toBeTruthy();
    // Back to Settings through the crumb.
    await act(async () => {
      fireEvent.click(within(crumb).getByRole("button", { name: "Settings" }));
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Level and sections");
  });

  it("opens from the app menu", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await screen.findByRole("button", { name: "Start task" });
    await act(async () => {});
    await act(async () => {
      api.pressMenu("about");
    });
    expect(screen.getByRole("link", { name: /tost\.one/ })).toBeTruthy();
  });

  it("links out to the site, the code and a prefilled GitHub issue, which open in the browser", async () => {
    await aboutPage();
    const link = (name: RegExp) => screen.getByRole("link", { name }) as HTMLAnchorElement;
    expect(link(/tost\.one/).href).toBe("https://tost.one/");
    expect(link(/Source code on GitHub · MIT licence/).href).toBe("https://github.com/SuperTost100/tost-work");
    const feedback = new URL(link(/Send feedback/).href);
    expect(`${feedback.origin}${feedback.pathname}`).toBe("https://github.com/SuperTost100/tost-work/issues/new");
    expect(feedback.searchParams.get("title")).toBe("");
    expect(feedback.searchParams.get("body")).toBe(
      `Tost Work ${__APP_VERSION__} (build ${__APP_BUILD__})\nOS: Linux\nLanguage: English\n\n`,
    );
    for (const name of [/tost\.one/, /Source code/, /Send feedback/]) {
      expect(link(name).target).toBe("_blank");
      expect(link(name).rel).toContain("noreferrer");
    }
  });

  it("shows what's new for each version up to this one, in the interface's language", async () => {
    await aboutPage();
    await click(`What's new in ${__APP_VERSION__}`);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("What's new");
    // This version first, and an earlier one under it. Hiding a newer entry is checked in changelog.test.ts, so this
    // test doesn't change with every release.
    const versions = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(versions[0]).toBe(__APP_VERSION__);
    expect(versions).toContain("0.0.19");
    expect(screen.getByText("Debug mode:")).toBeTruthy();
    // Back to About through the crumb.
    await act(async () => {
      fireEvent.click(within(screen.getByRole("navigation", { name: "About" })).getByRole("button", { name: "About" }));
    });
    expect(screen.getByRole("link", { name: /tost\.one/ })).toBeTruthy();
  });

  it("speaks Italian when the app does", async () => {
    const api = createMemoryApi();
    await api.settings.update({ language: "it" });
    render(<Root api={api} />);
    await click("Impostazioni");
    await click("Informazioni");
    expect(screen.getByText(/Un'app gratuita e open source di Tommaso Barbera/)).toBeTruthy();
    const feedback = new URL((screen.getByRole("link", { name: /Invia un feedback/ }) as HTMLAnchorElement).href);
    expect(feedback.searchParams.get("body")).toContain("Language: Italian");
    await click(/Novità della versione/);
    expect(screen.getByText("Modalità debug:")).toBeTruthy();
  });

  it("lists the fonts, the icons and the npm packages with their licences", async () => {
    await aboutPage();
    await click("Credits and licences");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Credits and licences");
    const row = (name: string) => screen.getByText(name).closest(".srow") as HTMLElement;
    expect(within(row("Schibsted Grotesk")).getByText("SIL OFL 1.1")).toBeTruthy();
    expect(within(row("IBM Plex Mono")).getByText("SIL OFL 1.1")).toBeTruthy();
    expect(within(row("MingCute icons")).getByText("Apache-2.0")).toBeTruthy();
    // Generated from the app's package.json, not typed in.
    expect(within(row("zod")).getByText("MIT")).toBeTruthy();
    expect(within(row("jszip")).getByText(/MIT/)).toBeTruthy();
  });
});
