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
  it("leaves the first step's focus alone, then puts it on each new step's title, forward and back", async () => {
    render(<Root api={createMemoryApi({})} />);
    const name = await screen.findByLabelText("Your name");
    expect(document.activeElement?.tagName).not.toBe("H1");
    fireEvent.change(name, { target: { value: "Giulia" } });
    await click("Next");
    expect(document.activeElement?.tagName).toBe("H1");
    expect(screen.getByText("Step 2 of 6")).toBeTruthy();
    await click("Back");
    expect(document.activeElement?.tagName).toBe("H1");
    expect(screen.getByText("Step 1 of 6")).toBeTruthy();
  });

  it("goes through name, about you, level, ChatGPT sign-in and a first project, then opens the app", async () => {
    const api = createMemoryApi({});
    render(<Root api={api} />);

    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "  Giulia " } });
    await click("Next");
    expect(screen.getByText("Step 2 of 6")).toBeTruthy();

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

    // Notifications start on; Advanced has jobs, so starting at login is asked too.
    const notifications = screen.getByRole("switch", { name: /Tell me when a task needs me/ });
    expect(notifications.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Open Tost Work when you log in" }));
    });
    await click("Next");

    // Claude can sign in too, and the course key can be pasted.
    expect(screen.getByRole("button", { name: "Sign in to Claude" })).toBeTruthy();
    expect(screen.getByLabelText("API key")).toBeTruthy();
    await click("Sign in to ChatGPT");
    expect(await screen.findByText("Connected as giulia@example.com")).toBeTruthy();
    await click("Next");

    await click("Choose folder");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Proposals");
    await click("Start working");

    expect(await screen.findByText(/Giulia\./)).toBeTruthy();
    expect(await api.settings.get()).toMatchObject({
      name: "Giulia",
      defaultAi: "chatgpt",
      work: "I sell olive oil",
      notes: "Clients are in Japan",
      level: "advanced",
      notifications: true,
      openAtLogin: true,
      setupDone: true,
    });
    expect((await api.projects.list()).map((p) => p.name)).toEqual(["Proposals"]);
  });

  it("asks about starting at login only at levels that have jobs", async () => {
    render(<Root api={createMemoryApi({ name: "Giulia" })} />);
    await click("Next");
    await click("Skip for now");
    await click("Next");
    expect(await screen.findByRole("switch", { name: /Tell me when a task needs me/ })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Open Tost Work when you log in" })).toBeNull();
  });

  it("says how much room is left once the notes near their limit", async () => {
    render(<Root api={createMemoryApi({ name: "Giulia" })} />);
    await click("Next");
    const notes = screen.getByLabelText("What else the AI should know");
    fireEvent.change(notes, { target: { value: "x".repeat(3000) } });
    expect(screen.queryByText(/of 4,000 characters/)).toBeNull();
    fireEvent.change(notes, { target: { value: "x".repeat(3700) } });
    expect(screen.getByText(/3,700 of 4,000 characters/)).toBeTruthy();
  });

  it("writes the count the Italian way when the app is in Italian", async () => {
    render(<Root api={createMemoryApi({ name: "Giulia", language: "it" })} />);
    await click("Avanti");
    fireEvent.change(screen.getByLabelText("Cos'altro deve sapere l'AI"), { target: { value: "x".repeat(3700) } });
    // Italian groups thousands only from five digits, so 3700 has no separator where English writes 3,700.
    expect(screen.getByText(/^3700 caratteri su 4000\./)).toBeTruthy();
  });

  it("takes the course key, refusing what isn't one, and makes it the default", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    render(<Root api={api} />);
    await click("Next");
    await click("Skip for now");
    await click("Next");
    await click("Next");
    fireEvent.change(await screen.findByLabelText("API key"), { target: { value: "hello" } });
    await click("Use key");
    expect(screen.getByRole("alert").textContent).toMatch(/isn't an OpenAI or Anthropic API key/);

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: " sk-ant-api03-abcdefghijklmnopWXYZ " } });
    await click("Use key");
    expect(await screen.findByText("Anthropic key ending in WXYZ")).toBeTruthy();
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(await api.settings.get()).toMatchObject({ defaultAi: "key" });
    // A key counts as a connected AI.
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
  });

  it("installs a missing CLI with one button, and says what went wrong when it can't", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    const installed = { codex: false, claude: true };
    api.account.status = async (provider) => ({ installed: installed[provider], loggedIn: false });
    const tries: string[] = [];
    api.account.install = async (provider) => {
      tries.push(provider);
      if (tries.length === 1)
        return { ok: false, reason: "offline", detail: "curl: (6) Could not resolve host: chatgpt.com" };
      installed[provider] = true;
      return { ok: true };
    };
    render(<Root api={api} />);
    await click("Next");
    await click("Skip for now");
    await click("Next");
    await click("Next");
    expect(
      await screen.findByText(
        "Codex isn't installed yet. Tost Work downloads it from OpenAI, with OpenAI's own installer.",
      ),
    ).toBeTruthy();
    // Claude is there in this test, so the Anthropic wording is checked in its own test below.
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();

    await click("Install Codex");
    expect(await screen.findByText(/There's no internet connection/)).toBeTruthy();
    // The terminal command is there as a way out once the button has failed.
    expect(screen.getByText(/chatgpt\.com\/codex\/install\.sh/)).toBeTruthy();

    await click("Install Codex");
    expect(await screen.findByRole("button", { name: "Sign in to ChatGPT" })).toBeTruthy();
    expect(tries).toEqual(["codex", "codex"]);
  });

  it("names the maker of the program it downloads, in both languages", async () => {
    const missing = { codex: false, claude: false };
    const cases = [
      {
        language: "en" as const,
        next: "Next",
        skip: "Skip for now",
        codex: "Codex isn't installed yet. Tost Work downloads it from OpenAI, with OpenAI's own installer.",
        claude:
          "Claude Code isn't installed yet. Tost Work downloads it from Anthropic, with Anthropic's own installer.",
      },
      {
        language: "it" as const,
        next: "Avanti",
        skip: "Salta per ora",
        codex:
          "Codex non è ancora installato. Tost Work lo scarica da OpenAI, con il programma di installazione di OpenAI.",
        claude:
          "Claude Code non è ancora installato. Tost Work lo scarica da Anthropic, con il programma di installazione di Anthropic.",
      },
    ];
    for (const c of cases) {
      const api = createMemoryApi({ name: "Giulia", language: c.language });
      api.account.status = async (provider) => ({ installed: missing[provider], loggedIn: false });
      const { unmount } = render(<Root api={api} />);
      await click(c.next);
      await click(c.skip);
      await click(c.next);
      await click(c.next);
      expect(await screen.findByText(c.codex)).toBeTruthy();
      expect(screen.getByText(c.claude)).toBeTruthy();
      unmount();
    }
  });

  it("says what a task sends and opens the privacy notice from a link, in both languages", async () => {
    const cases = [
      {
        language: "en" as const,
        next: "Next",
        skip: "Skip for now",
        sends: /A task sends your request and the files it reads to the AI you connect, OpenAI or Anthropic\./,
        link: "Privacy notice",
        close: "Close",
      },
      {
        language: "it" as const,
        next: "Avanti",
        skip: "Salta per ora",
        sends: /Un'attività invia la tua richiesta e i file che legge all'AI che colleghi, OpenAI o Anthropic\./,
        link: "Informativa privacy",
        close: "Chiudi",
      },
    ];
    for (const c of cases) {
      const api = createMemoryApi({ name: "Giulia", language: c.language });
      const { unmount } = render(<Root api={api} />);
      await click(c.next);
      await click(c.skip);
      await click(c.next);
      await click(c.next);
      expect(await screen.findByText(c.sends)).toBeTruthy();
      // The link is a button, so the keyboard reaches it; it opens the notice that ships with the app.
      await click(c.link);
      const dialog = await screen.findByRole("dialog");
      expect(dialog.querySelector("h1")?.textContent).toBe(c.link);
      expect(dialog.textContent).toMatch(/OpenAI/);
      await click(c.close);
      expect(screen.queryByRole("dialog")).toBeNull();
      unmount();
    }
  });

  it("shows an install in progress on its button, which can't be pressed again, and drops it when it ends", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    let installed = false;
    api.account.status = async (provider) => ({ installed: provider === "codex" ? installed : true, loggedIn: false });
    let finish: (result: { ok: true }) => void = () => {};
    let tries = 0;
    api.account.install = () => {
      tries++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    render(<Root api={api} />);
    await click("Next");
    await click("Skip for now");
    await click("Next");
    await click("Next");
    await click("Install Codex");

    const busy = await screen.findByRole("button", { name: "Installing…" });
    expect(busy.hasAttribute("disabled")).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Installing Codex. It takes a minute or two.")).toBeTruthy();
    fireEvent.click(busy);
    expect(tries).toBe(1);

    installed = true;
    await act(async () => finish({ ok: true }));
    expect(await screen.findByRole("button", { name: "Sign in to ChatGPT" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Installing…" })).toBeNull();
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
    const cancelled: string[] = [];
    api.account.cancel = async (provider) => {
      cancelled.push(provider);
    };
    // A sign-in that stays open until it's cancelled.
    api.account.signIn = () => new Promise(() => {});
    render(<Root api={api} />);
    await click("Next");
    await click("Skip for now");
    await click("Next");
    await click("Next");
    await click("Sign in to ChatGPT");
    expect(await screen.findByText("Finish signing in on the page that opened.")).toBeTruthy();
    await click("Back");
    expect(cancelled.sort()).toEqual(["claude", "codex"]);
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
