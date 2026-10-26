import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";

// Find first, then act: waiting inside act holds back the updates the wait is for.
const click = async (name: string | RegExp, role: "button" | "radio" | "switch" = "button") => {
  const target = await screen.findByRole(role, { name });
  await act(async () => {
    fireEvent.click(target);
  });
};

// A section's button in the sidebar, or null when the sidebar doesn't show it.
const nav = (name: string) =>
  within(screen.getByRole("navigation", { name: "Sections" })).queryByRole("button", { name });

describe("settings", () => {
  it("shows the sections of the chosen level, and keeps a section the user turned off", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await click("Settings");
    expect(nav("Jobs")).toBeNull();

    await click(/Intermediate/, "radio");
    expect(nav("Jobs")).toBeTruthy();
    expect(nav("Board")).toBeTruthy();

    await click("Skills", "switch");
    expect(nav("Skills")).toBeNull();
    expect(screen.getByRole("switch", { name: "Skills" }).getAttribute("aria-checked")).toBe("false");

    // Turning the board off right after keeps Skills off: each switch is saved on its own.
    await click("Board", "switch");
    expect(await api.settings.get()).toMatchObject({
      level: "intermediate",
      sections: { skills: false, board: false },
    });
  });

  it("saves the text size and the theme", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await click("Settings");
    await click("Language and appearance");
    await click("Large", "radio");
    await click("Dark", "radio");
    expect(await api.settings.get()).toMatchObject({ textSize: "large", theme: "dark" });
    expect((screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("signs in to ChatGPT and out again", async () => {
    render(<Root api={createMemoryApi()} />);
    await click("Settings");
    await click("AI accounts");
    await click("Sign in to ChatGPT");
    expect(await screen.findByText("Connected as giulia@example.com")).toBeTruthy();
    await click("Sign out of ChatGPT");
    expect(await screen.findByRole("button", { name: "Sign in to ChatGPT" })).toBeTruthy();
  });

  it("makes the account signed in last the default, and offers the choice once both are in", async () => {
    const api = createMemoryApi();
    render(<Root api={api} />);
    await click("Settings");
    await click("AI accounts");
    expect(screen.queryByRole("radiogroup", { name: "Default AI" })).toBeNull();

    await click("Sign in to Claude");
    expect((await api.settings.get()).defaultAi).toBe("claude");
    await click("Sign in to ChatGPT");
    expect((await api.settings.get()).defaultAi).toBe("chatgpt");

    await click("Claude", "radio");
    expect((await api.settings.get()).defaultAi).toBe("claude");
    // Signing out of the default leaves the choice to the account still signed in.
    await click("Sign out of Claude");
    expect((await api.settings.get()).defaultAi).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Default AI" })).toBeNull();
  });

  it("starts tasks in a project when quick edit is off", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true, sections: { quickEdit: false } });
    await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
    render(<Root api={api} />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Write a proposal" } });
    await click("Start task");
    const [task] = await api.tasks.list();
    expect(task?.projectId).toBe("p1");
  });

  it("asks for a project when quick edit is off and there is none", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true, sections: { quickEdit: false } });
    render(<Root api={api} />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Write a proposal" } });
    await click("Start task");
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(await api.tasks.list()).toEqual([]);
  });
});
