import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";

// Find first, then act: waiting inside act holds back the updates the wait is for.
const click = async (name: string | RegExp) => {
  const button = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
};

describe("first-run setup", () => {
  it("goes through name, about you, level, ChatGPT sign-in and a first project, then opens the app", async () => {
    const api = createMemoryApi({});
    render(<Root api={api} />);

    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "  Giulia " } });
    await click("Next");
    expect(screen.getByText("Step 2 of 5")).toBeTruthy();

    // About you is optional: empty, the button skips.
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What you do"), { target: { value: " I sell olive oil " } });
    fireEvent.change(screen.getByLabelText("What else the AI should know"), {
      target: { value: "Clients are in Japan" },
    });
    await click("Next");

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Advanced/));
    });
    expect((screen.getByLabelText(/Advanced/) as HTMLInputElement).checked).toBe(true);
    await click("Next");

    // Claude and the API key are there, greyed out.
    expect(screen.getAllByText("Arrives in a later version")).toHaveLength(2);
    await click("Sign in");
    expect(await screen.findByText("Connected as giulia@example.com")).toBeTruthy();
    await click("Next");

    await click("Choose folder");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Proposals");
    await click("Start working");

    expect(await screen.findByText(/Giulia\./)).toBeTruthy();
    expect(await api.settings.get()).toMatchObject({
      name: "Giulia",
      work: "I sell olive oil",
      notes: "Clients are in Japan",
      level: "advanced",
      setupDone: true,
    });
    expect((await api.projects.list()).map((p) => p.name)).toEqual(["Proposals"]);
  });

  it("shows how to install Codex when it's missing, and checks again", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    let installed = false;
    api.account.status = async () => ({ installed, loggedIn: false });
    render(<Root api={api} />);
    await click("Next");
    await click("Skip for now");
    await click("Next");
    expect(await screen.findByText("npm install -g @openai/codex")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();

    installed = true;
    await click("Check again");
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("switches the language as soon as it's picked", async () => {
    render(<Root api={createMemoryApi({})} />);
    const language = await screen.findByLabelText("Language");
    await act(async () => {
      fireEvent.change(language, { target: { value: "it" } });
    });
    expect(await screen.findByText("Ti diamo il benvenuto in Tost Work.")).toBeTruthy();
  });

  it("opens the app directly once setup is done", async () => {
    render(<Root api={createMemoryApi()} />);
    expect(await screen.findByRole("button", { name: "Start task" })).toBeTruthy();
  });

  it("ends an open sign-in when the user leaves the step", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    let cancelled = 0;
    api.account.cancel = async () => {
      cancelled++;
    };
    // A sign-in that stays open until it's cancelled.
    api.account.signIn = () => new Promise(() => {});
    render(<Root api={api} />);
    await click("Next");
    await click("Skip for now");
    await click("Next");
    await click("Sign in");
    expect(await screen.findByText("Finish signing in on the page that opened.")).toBeTruthy();
    await click("Back");
    expect(cancelled).toBe(1);
  });

  it("shows a language that couldn't be saved", async () => {
    const api = createMemoryApi({});
    api.settings.update = async () => {
      throw new Error("The settings file is read-only");
    };
    render(<Root api={api} />);
    const language = await screen.findByLabelText("Language");
    await act(async () => {
      fireEvent.change(language, { target: { value: "it" } });
    });
    expect(screen.getByRole("alert").textContent).toMatch(/read-only/);
  });

  it("makes the first project once when Start working is retried", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    const update = api.settings.update;
    let failOnce = true;
    api.settings.update = async (patch) => {
      if (patch.setupDone && failOnce) {
        failOnce = false;
        throw new Error("Couldn't save");
      }
      return update(patch);
    };
    render(<Root api={api} />);
    await click("Next");
    await click("Skip for now");
    await click("Next");
    await click("Skip for now");
    await click("Choose folder");
    await click("Start working");
    expect(await screen.findByText("Couldn't save")).toBeTruthy();
    await click("Start working");
    await screen.findByRole("button", { name: "Start task" });
    expect(await api.projects.list()).toHaveLength(1);
  });
});
