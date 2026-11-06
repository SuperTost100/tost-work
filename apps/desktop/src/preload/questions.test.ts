import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC, type TostWorkApi, type WindowQuestion } from "../shared/api";

// The main process's side: what takeQuestions returns, held until the test lets it through.
let releaseTake: (questions: WindowQuestion[]) => void = () => {};
const exposed: { api?: TostWorkApi } = {};

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (_: string, api: TostWorkApi) => (exposed.api = api) },
  ipcRenderer: {
    on: () => {},
    removeListener: () => {},
    send: () => {},
    invoke: (channel: string) =>
      channel === IPC.takeQuestions ? new Promise((resolve) => (releaseTake = resolve)) : Promise.resolve(null),
  },
  webUtils: {},
}));

const QUIT: WindowQuestion = { id: 1, message: "A task is still working.", yes: "Quit" };

describe("questions from the main process, in the preload", () => {
  beforeEach(async () => {
    vi.resetModules();
    await import("./index");
  });

  it("keeps questions that arrive after their listener has gone for the next listener", async () => {
    const api = exposed.api as TostWorkApi;
    const first = vi.fn();
    const stop = api.onQuestion(first);
    const takeFirst = releaseTake;
    // React in development mounts twice: the first listener goes before its questions arrive.
    stop();
    takeFirst([QUIT]);
    await Promise.resolve();
    expect(first).not.toHaveBeenCalled();

    const second = vi.fn();
    api.onQuestion(second);
    expect(second).toHaveBeenCalledWith(QUIT);
  });

  it("hands them to a listener that's still there", async () => {
    const api = exposed.api as TostWorkApi;
    const listener = vi.fn();
    api.onQuestion(listener);
    releaseTake([QUIT]);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith(QUIT);
  });
});
