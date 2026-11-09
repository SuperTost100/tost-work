import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";
import type { SandboxReadiness } from "../../../shared/sandbox";

// Find first, then act: waiting inside act holds back the updates the wait is for.
const click = async (name: string | RegExp) => {
  const button = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
};

/** Opens setup at its Connect an AI step. */
const connectStep = async (api: ReturnType<typeof createMemoryApi>) => {
  render(<Root api={api} />);
  await click("Next");
  await click("Skip for now");
  await click("Next");
  await click("Next");
  await screen.findByText("Connect an AI.");
};

const NOTE = /On Windows, Claude isn't limited to the task's folder yet/;
const TITLE = "Claude on Windows isn't limited to the task's folder";

describe("Claude on Windows runs without a sandbox", () => {
  const windows = (claude = { installed: false, loggedIn: false }) => {
    const api = createMemoryApi({ name: "Giulia" });
    api.claudeUnconfined = true;
    api.account.status = async (provider) => (provider === "claude" ? claude : { installed: true, loggedIn: false });
    const calls: string[] = [];
    api.account.install = async (provider) => {
      calls.push(`install ${provider}`);
      claude.installed = true;
      return { ok: true };
    };
    api.account.signIn = async (provider) => {
      calls.push(`signIn ${provider}`);
    };
    return { api, calls };
  };

  it("puts a note in Claude's row, and in no other, only when Claude is unconfined", async () => {
    const { api } = windows();
    await connectStep(api);
    const rows = document.querySelectorAll(".opt");
    expect([...rows].map((row) => row.textContent?.includes("isn't limited to the task's folder"))).toEqual([
      false,
      true,
      false,
    ]);
    expect(screen.getAllByRole("note")).toHaveLength(1);
  });

  it("shows no note and asks nothing on Mac and Linux", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    api.account.status = async (provider) => ({ installed: provider === "codex", loggedIn: false });
    await connectStep(api);
    expect(screen.queryByRole("note")).toBeNull();
    await click("Install Claude Code");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before Install, says it in two paragraphs, and does nothing on Cancel", async () => {
    const { api, calls } = windows();
    await connectStep(api);
    await click("Install Claude Code");
    const card = await screen.findByRole("alertdialog");
    expect(within(card).getByText(TITLE)).toBeTruthy();
    expect(
      within(card)
        .getAllByText(/./)
        .filter((el) => el.tagName === "P"),
    ).toHaveLength(2);
    expect(within(card).getByRole("button", { name: "Continue" })).toBeTruthy();
    await click("Cancel");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("goes on with Install on Continue, then signs in without asking again", async () => {
    const { api, calls } = windows();
    await connectStep(api);
    await click("Install Claude Code");
    await screen.findByRole("alertdialog");
    await click("Continue");
    expect(await screen.findByRole("button", { name: "Sign in to Claude" })).toBeTruthy();
    expect(calls).toEqual(["install claude"]);
    await click("Sign in to Claude");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls).toEqual(["install claude", "signIn claude"]);
  });

  it("asks before Sign in when Claude is already installed, and again after a Cancel", async () => {
    const { api, calls } = windows({ installed: true, loggedIn: false });
    await connectStep(api);
    await click("Sign in to Claude");
    await screen.findByRole("alertdialog");
    await click("Cancel");
    expect(calls).toEqual([]);
    await click("Sign in to Claude");
    await screen.findByRole("alertdialog");
    await click("Continue");
    expect(calls).toEqual(["signIn claude"]);
  });

  it("never asks before ChatGPT signs in", async () => {
    const { api, calls } = windows();
    await connectStep(api);
    await click("Sign in to ChatGPT");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls).toEqual(["signIn codex"]);
  });

  it("says it in Italian", async () => {
    const { api } = windows();
    await api.settings.update({ language: "it" });
    render(<Root api={api} />);
    await click("Avanti");
    await click("Salta per ora");
    await click("Avanti");
    await click("Avanti");
    await click("Installa Claude Code");
    expect(await screen.findByText("Claude su Windows non è limitato alla cartella dell'attività")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continua" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Annulla" })).toBeTruthy();
  });

  it("shows the note in Settings too, under Claude's row", async () => {
    const { api } = windows({ installed: true, loggedIn: true });
    api.settings.update({ setupDone: true });
    const done = createMemoryApi({ name: "Giulia", setupDone: true });
    done.claudeUnconfined = true;
    render(<Root api={done} />);
    await click("Settings");
    await click(/AI accounts/);
    expect(await screen.findByText(NOTE)).toBeTruthy();
    expect(screen.getAllByRole("note")).toHaveLength(1);
  });

  describe("with the course key", () => {
    const keyStep = async (api: ReturnType<typeof createMemoryApi>) => {
      await connectStep(api);
      return screen.getByLabelText("API key");
    };

    it("asks before an Anthropic key is saved, and says it under the row once it is", async () => {
      const { api } = windows({ installed: true, loggedIn: false });
      const save = vi.spyOn(api.key, "save");
      const box = await keyStep(api);
      fireEvent.change(box, { target: { value: "sk-ant-api03-abcdefghijklmnopWXYZ" } });
      await click("Use key");
      await screen.findByRole("alertdialog");
      await click("Cancel");
      expect(save).not.toHaveBeenCalled();
      expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("sk-ant-api03-abcdefghijklmnopWXYZ");

      await click("Use key");
      await screen.findByRole("alertdialog");
      await click("Continue");
      expect(await screen.findByText("Anthropic key ending in WXYZ")).toBeTruthy();
      expect(save).toHaveBeenCalledTimes(1);
      // The note under Claude's own row and the one under the key's.
      expect(screen.getAllByRole("note")).toHaveLength(2);
    });

    it("saves an OpenAI key without asking, and adds no note", async () => {
      const { api } = windows({ installed: true, loggedIn: false });
      const box = await keyStep(api);
      fireEvent.change(box, { target: { value: "sk-proj-abcdefghijklmnopWXYZ" } });
      await click("Use key");
      expect(await screen.findByText("OpenAI key ending in WXYZ")).toBeTruthy();
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.getAllByRole("note")).toHaveLength(1);
    });
  });
});

const missing = (over: Partial<SandboxReadiness> = {}): SandboxReadiness => ({
  ready: false,
  missing: ["bwrap", "socat"],
  distro: { id: "ubuntu", like: ["debian"], name: "Ubuntu", version: "24.04" },
  appArmorRestrictsUserns: false,
  ...over,
});
const ready: SandboxReadiness = { ready: true, missing: [], distro: null, appArmorRestrictsUserns: null };

describe("the Linux sandbox notice in setup", () => {
  it("shows nothing when the sandbox is ready from the start", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    const check = vi.spyOn(api.sandbox, "check");
    await connectStep(api);
    expect(check).toHaveBeenCalledWith();
    expect(screen.queryByText("The AIs' sandbox isn't ready")).toBeNull();
    expect(screen.queryByText("The sandbox is ready")).toBeNull();
  });

  it("says what's missing, gives the commands for the distribution, and rechecks", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    const results = [missing({ missing: ["bwrap", "socat", "userns"], appArmorRestrictsUserns: true }), ready];
    api.sandbox.check = vi.fn(async () => results.shift() ?? ready);
    await connectStep(api);
    expect(await screen.findByText("The AIs' sandbox isn't ready")).toBeTruthy();
    expect(screen.getByText("bubblewrap: missing")).toBeTruthy();
    expect(screen.getByText("socat: missing")).toBeTruthy();
    expect(screen.getByText("AppArmor: blocks bwrap")).toBeTruthy();
    expect(screen.getByText("1. Install the packages (Claude Code also needs socat)")).toBeTruthy();
    expect(screen.getByText("sudo apt install bubblewrap socat")).toBeTruthy();
    expect(screen.getByText("2. AppArmor on Ubuntu 24.04: let bubblewrap create user namespaces")).toBeTruthy();
    expect(screen.getByText(/sudo systemctl reload apparmor/)).toBeTruthy();
    // The AIs can still be connected.
    expect(screen.getByText("You can connect an AI now: tasks will start once the sandbox is ready.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in to ChatGPT" })).toBeTruthy();

    await click("Check again");
    expect(await screen.findByText("The sandbox is ready")).toBeTruthy();
    expect(screen.queryByText("sudo apt install bubblewrap socat")).toBeNull();
  });

  it("says so when a check finds it still not ready", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    api.sandbox.check = vi.fn(async () => missing({ missing: ["socat"], distro: null }));
    await connectStep(api);
    await screen.findByText("The AIs' sandbox isn't ready");
    expect(screen.queryByText("Still not ready.")).toBeNull();
    await click("Check again");
    expect(await screen.findByText("Still not ready.")).toBeTruthy();
    // No package manager known: the packages are named, with no command.
    expect(screen.getByText("Install socat with your system's package manager")).toBeTruthy();
    expect(document.querySelector(".sbx-cmd")).toBeNull();
  });

  it("copies a command", async () => {
    const api = createMemoryApi({ name: "Giulia" });
    api.sandbox.check = vi.fn(async () =>
      missing({ missing: ["socat"], distro: { id: "fedora", like: [], name: "Fedora Linux", version: "43" } }),
    );
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void written.push(text) },
      configurable: true,
    });
    await connectStep(api);
    await click("Copy: sudo dnf install socat");
    expect(written).toEqual(["sudo dnf install socat"]);
    expect(await screen.findByRole("button", { name: /Copy: sudo dnf install socat/ })).toBeTruthy();
    expect(screen.getByText("Copied")).toBeTruthy();
  });
});

/** Renders the app, waits for it to load and opens the task, as the notification does. */
const openTask = async (api: ReturnType<typeof createMemoryApi>, id: string) => {
  render(<Root api={api} />);
  await screen.findByRole("button", { name: "Start task" });
  await act(async () => {
    api.openFromOutside(id);
  });
};

describe("the sandbox notice in a failed task", () => {
  const failedTask = async (
    readiness: SandboxReadiness,
    projectId: string | null = null,
  ): Promise<[ReturnType<typeof createMemoryApi>, string]> => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    const task = await api.tasks.start({ projectId, brief: "Prepare the 2027 price list", attachments: [] });
    api.emit(task.id, {
      type: "failed",
      error: "Claude can't work safely on this computer yet",
      sandboxNotReady: readiness,
    });
    return [api, task.id];
  };

  it("replaces the plain sentence with what to install, for the task's AI", async () => {
    const [api, id] = await failedTask(missing({ missing: ["socat"] }));
    await api.tasks.get(id);
    await openTask(api, id);
    expect(await screen.findByText("The task didn't start: the sandbox isn't ready")).toBeTruthy();
    expect(screen.getByText(/On this computer, socat isn't installed\./)).toBeTruthy();
    expect(screen.getByText("sudo apt install socat")).toBeTruthy();
    // A single step has no number.
    expect(screen.queryByText(/^1\. /)).toBeNull();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
    expect(screen.queryByText("Show the original error")).toBeNull();
  });

  it("checks for the task's AI and runs the task again only when it's ready", async () => {
    const [api, id] = await failedTask(missing({ missing: ["bwrap", "socat"] }));
    const results = [missing({ missing: ["socat"] }), ready];
    const check = vi.fn(async (_provider?: string) => results.shift() ?? ready);
    api.sandbox.check = check;
    const resume = vi.spyOn(api.tasks, "resume");
    await openTask(api, id);
    await click("Check and try again");
    // Still missing socat: the notice shows what's left and the task is not run.
    expect(await screen.findByText("Still not ready.")).toBeTruthy();
    expect(screen.getByText("sudo apt install socat")).toBeTruthy();
    expect(resume).not.toHaveBeenCalled();
    expect(check).toHaveBeenLastCalledWith("codex");

    await click("Check and try again");
    expect(resume).toHaveBeenCalledWith(id);
    expect((await api.tasks.get(id))?.status).toBe("running");
    expect(screen.queryByText("The task didn't start: the sandbox isn't ready")).toBeNull();
  });

  it("shows the same notice in a task of a project", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    const project = await api.projects.create({ name: "Alpi Logistica", folder: "/Users/giulia/Alpi" });
    const task = await api.tasks.start({
      projectId: project.id,
      brief: "Prepare the 2027 price list",
      attachments: [],
    });
    api.emit(task.id, {
      type: "failed",
      error: "x",
      sandboxNotReady: missing({ missing: ["userns"], detail: "bwrap: No permissions to create new namespace" }),
    });
    await openTask(api, task.id);
    expect(await screen.findByText("The task didn't start: the sandbox isn't ready")).toBeTruthy();
    expect(
      screen.getByText(/doesn't let bubblewrap create user namespaces, and AppArmor isn't the cause/),
    ).toBeTruthy();
    expect(screen.getByText("bwrap: No permissions to create new namespace")).toBeTruthy();
  });

  it("keeps the plain sentence for a task that failed for another reason", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    const task = await api.tasks.start({ projectId: null, brief: "Prepare the 2027 price list", attachments: [] });
    api.emit(task.id, { type: "failed", error: "Tost Work can't reach ChatGPT." });
    await openTask(api, task.id);
    expect(await screen.findByText("Something went wrong: Tost Work can't reach ChatGPT.")).toBeTruthy();
    expect(screen.queryByText("Check and try again")).toBeNull();
  });
});
