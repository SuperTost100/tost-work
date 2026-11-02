import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { REREAD_MS, useDebugLog } from "@/components/DebugDetails";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";
import type { LogLine } from "../../../shared/debug";

// Find first, then act: waiting inside act holds back the updates the wait is for.
const click = async (name: string | RegExp, role: "button" | "radio" | "switch" = "button") => {
  const target = await screen.findByRole(role, { name });
  await act(async () => {
    fireEvent.click(target);
  });
};

const at = "2026-11-02T10:00:00.000Z";
const line = (fields: Record<string, unknown>) => ({ at, ...fields }) as LogLine;

describe("debug mode in Settings", () => {
  it("shows its switch only at Expert, and stays on after a move to a lower level", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true, level: "advanced" });
    render(<Root api={api} />);
    await click("Settings");
    expect(screen.queryByRole("switch", { name: "Show technical details and debug" })).toBeNull();

    await click(/Expert/, "radio");
    await click("Show technical details and debug", "switch");
    expect((await api.settings.get()).debug).toBe(true);
    expect(
      screen.getByText(
        "While it's on, every task keeps a full log on this computer, which is never sent anywhere and holds the text of your files and requests.",
      ),
    ).toBeTruthy();
    await click("Open the app log");
    expect(api.debugCalls.appLog).toBe(1);
    await click("Export logs");
    expect(api.debugCalls.exported).toBe(1);

    await click(/Intermediate/, "radio");
    expect(screen.queryByRole("switch", { name: "Show technical details and debug" })).toBeNull();
    expect((await api.settings.get()).debug).toBe(true);
  });
});

describe("screen lines for the app log", () => {
  it("are sent for each screen while debug is on, with names and ids only", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true, level: "expert", debug: true });
    const task = await api.tasks.start({ projectId: null, brief: "Sum up the call notes", attachments: [] });
    render(<Root api={api} />);
    await click("Settings");
    expect(api.debugCalls.screens.at(-1)).toEqual({ name: "settings" });
    await act(async () => {
      api.openFromOutside(task.id);
    });
    expect(api.debugCalls.screens.at(-1)).toEqual({ name: "task", id: task.id });
    expect(JSON.stringify(api.debugCalls.screens)).not.toContain("Sum up");
  });

  it("are not sent while debug is off", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true, level: "expert", debug: false });
    render(<Root api={api} />);
    await click("Settings");
    expect(api.debugCalls.screens).toEqual([]);
  });
});

/** A running task with two lines of activity and their tool calls in its log. */
async function taskWithLog(debug: boolean) {
  const api = createMemoryApi({ name: "Giulia", setupDone: true, level: "expert", debug });
  const task = await api.tasks.start({ projectId: null, brief: "Sum up the call notes", attachments: [] });
  act(() => {
    api.emit(task.id, { type: "withdrawn", id: "q1" });
    api.emit(task.id, { type: "activity", kind: "read", target: "note.txt", id: "c1" });
    api.emit(task.id, { type: "activity", kind: "command", id: "c2" });
  });
  for (const l of [
    line({ type: "run", provider: "codex", model: "gpt-6.1-terra", effort: "medium", access: "supervised", cwd: "/w" }),
    line({ type: "session", sessionId: "sess-42" }),
    line({ type: "reasoning.delta", text: "The notes come first." }),
    line({ type: "tool.start", id: "c1", name: "Read", input: { file_path: "/w/note.txt" } }),
    line({ type: "tool.end", id: "c1", output: "Call with Alpi Logistica" }),
    line({ type: "tool.start", id: "c2", name: "command", input: { command: "ls -la" } }),
    line({ type: "tool.end", id: "c2", error: "Permission denied", cut: 25_000 }),
    line({ type: "usage", usage: { inputTokens: 1200, outputTokens: 300 } }),
    line({ type: "reasoning.delta", text: "Now I can write the summary." }),
  ])
    api.log(task.id, l);
  render(<Root api={api} />);
  const [open] = await screen.findAllByText("Sum up the call notes");
  await act(async () => {
    fireEvent.click(open as HTMLElement);
  });
  return { api, task };
}

describe("debug mode on a task", () => {
  it("opens a line onto its tool call, with the thinking before it, its input and its output", async () => {
    await taskWithLog(true);
    const read = await screen.findByRole("button", { name: /Reading note\.txt/ });
    expect(read.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("/w/note.txt")).toBeNull();
    await act(async () => {
      fireEvent.click(read);
    });
    expect(read.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("The notes come first.")).toBeTruthy();
    expect(screen.getByText("/w/note.txt")).toBeTruthy();
    expect(screen.getByText("Call with Alpi Logistica")).toBeTruthy();

    await click(/Running a command/);
    expect(screen.getByText("ls -la")).toBeTruthy();
    expect(screen.getByText("Permission denied")).toBeTruthy();
    expect(screen.getByText(/Showing 20.000 of 25.000 characters|Showing 20,000 of 25,000 characters/)).toBeTruthy();
    // The thinking after the last call is the last, grey line.
    expect(screen.getByText("Now I can write the summary.").closest("li")?.className).toBe("dbg-think");
  });

  it("shows the AI, model, effort, session and tokens above the task", async () => {
    await taskWithLog(true);
    const facts = within(await screen.findByRole("region", { name: "Technical details" }));
    // The session comes from the log, read just after the task opens.
    expect(await facts.findByText("sess-42")).toBeTruthy();
    expect(facts.getByText("Codex")).toBeTruthy();
    expect(facts.getByText("gpt-6.1-terra")).toBeTruthy();
    expect(facts.getByText("medium")).toBeTruthy();
    expect(facts.getByText(/1.200 in, 300 out|1,200 in, 300 out/)).toBeTruthy();
  });

  it("keeps lines plain and shows no strip while debug is off", async () => {
    await taskWithLog(false);
    await screen.findByText("Reading note.txt");
    expect(screen.queryByRole("button", { name: /Reading note\.txt/ })).toBeNull();
    expect(document.querySelector(".dbg-strip")).toBeNull();
  });

  it("offers to open and copy the log from the task's menu", async () => {
    const { api, task } = await taskWithLog(true);
    api.pickInMenu("log-copy");
    await click("More for Sum up the call notes");
    api.pickInMenu("log-open");
    await click("More for Sum up the call notes");
    expect(api.debugCalls).toMatchObject({ copied: [task.id], revealed: [task.id] });
  });
});

describe("reading the log while a task changes", () => {
  it("reads at least every half second during a steady stream of changes, and keeps a read already on its way", async () => {
    vi.useFakeTimers();
    try {
      const api = createMemoryApi();
      // Each read answers a little later than the next change, as a long log would.
      let calls = 0;
      api.debug.taskLog = vi.fn(
        () =>
          new Promise<LogLine[]>((resolve) => {
            const n = ++calls;
            setTimeout(() => resolve([line({ type: "session", sessionId: `s${n}` })]), 150);
          }),
      );
      const { result, rerender } = renderHook(({ at }) => useDebugLog(api, "t1", true, at), {
        initialProps: { at: "0" },
      });
      for (let i = 1; i <= 20; i++) {
        await act(async () => {
          vi.advanceTimersByTime(100);
        });
        rerender({ at: String(i) });
      }
      // 2 seconds of a change every 100 ms: the first read at once, then one every REREAD_MS.
      expect(calls).toBeGreaterThanOrEqual(Math.floor(2000 / REREAD_MS));
      // The answers arrived while changes kept coming, and they show.
      expect(result.current?.sessionId).toMatch(/^s\d+$/);
    } finally {
      vi.useRealTimers();
    }
  });
});
