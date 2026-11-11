/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { IPC } from "../shared/api";
import { SandboxNotReady, UserError, userMessage } from "./userError";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  app: { getLocale: () => "en-US" },
  clipboard: {},
  dialog: {},
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => void handlers.set(channel, fn),
    on: () => {},
  },
  Menu: {},
  shell: {},
}));

describe("UserError", () => {
  it("keeps the English sentence as its message and says it in the language asked for", () => {
    const err = new UserError("error.stillWorking");
    expect(err.message).toBe("This task is still working");
    expect(userMessage(err, "en")).toBe("This task is still working");
    expect(userMessage(err, "it")).toBe("Questa attività è ancora al lavoro");
  });

  it("fills in the names an error carries", () => {
    const err = new UserError("error.notAFile", { name: "notes" });
    expect(err.message).toBe("notes isn't a file");
    expect(userMessage(err, "it")).toBe("notes non è un file");
  });

  it("lists what a sandbox lacks in the language asked for", () => {
    const err = new SandboxNotReady("codex", {
      ready: false,
      missing: ["bwrap", "userns"],
      distro: null,
      appArmorRestrictsUserns: null,
    });
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toBe(
      "ChatGPT can't work safely on this computer yet, because its sandbox can't start: bubblewrap isn't installed, the system doesn't let bubblewrap create user namespaces. Fix that in a terminal, then send the task again.",
    );
    expect(userMessage(err, "it")).toMatch(
      /^ChatGPT non può ancora .*: bubblewrap non è installato, il sistema non permette a bubblewrap di creare user namespace\./,
    );
  });

  it("leaves any other error as it is", () => {
    expect(userMessage(new Error("boom"), "it")).toBe("boom");
    expect(userMessage("plain", "it")).toBe("plain");
  });
});

describe("errors from the IPC handlers", () => {
  async function failure(language: "en" | "it"): Promise<string> {
    const { registerIpc } = await import("./ipc");
    const store = { getSettings: () => ({ language }), getTask: () => undefined };
    const debug = { app: () => {} };
    // Only what the follow-up handler touches before it refuses the empty message.
    registerIpc(
      store as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      () => null,
      () => {},
      {} as never,
      {} as never,
      debug as never,
      async () => "no",
      {} as never,
      {} as never,
      {} as never,
    );
    const followUp = handlers.get(IPC.tasksFollowUp);
    if (!followUp) throw new Error("the follow-up handler isn't registered");
    try {
      await followUp({}, "t1", "   ");
    } catch (err) {
      return (err as Error).message;
    }
    throw new Error("the handler didn't fail");
  }

  it("reach the window in the app's language", async () => {
    expect(await failure("it")).toBe("Scrivi prima cosa cambiare");
    expect(await failure("en")).toBe("Write what to change first");
  });
});
