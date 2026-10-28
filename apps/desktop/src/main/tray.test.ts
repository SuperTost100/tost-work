/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { translate } from "../shared/i18n";
import type { Job, Task } from "../shared/model";
import { staysInMenuBar, trayMenu } from "./tray";

const job = (title: string, time: string, on = true) =>
  ({ title, on, skip: null, schedule: { repeat: "daily", time } }) as unknown as Job;
const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate("en", key, vars);

describe("staysInMenuBar", () => {
  it("stays only while a job is on and the setting allows it", () => {
    expect(staysInMenuBar({ stayInMenuBar: true }, [job("a", "09:00", false), job("b", "10:00")])).toBe(true);
    expect(staysInMenuBar({ stayInMenuBar: true }, [job("a", "09:00", false)])).toBe(false);
    expect(staysInMenuBar({ stayInMenuBar: false }, [job("b", "10:00")])).toBe(false);
  });
});

describe("trayMenu", () => {
  it("lists what needs the user, what's working and the next job, and each item does its part", () => {
    const calls: string[] = [];
    const actions = {
      open: () => calls.push("open"),
      openTask: (id: string) => calls.push(`task ${id}`),
      quit: () => calls.push("quit"),
    };
    const tasks = [
      { id: "a", status: "needs-you" },
      { id: "b", status: "needs-you" },
      { id: "c", status: "running" },
      { id: "d", status: "done" },
    ] as Task[];
    const now = new Date(2026, 9, 28, 10, 0);
    const items = trayMenu(t, "en", [job("Invoices", "09:00"), job("Follow-ups", "18:00")], tasks, now, actions);
    expect(items.map((i) => i.label ?? i.type)).toEqual([
      "Open Tost Work",
      "separator",
      "2 tasks need you",
      "1 working",
      "Next: Follow-ups, today 18:00",
      "separator",
      "Quit Tost Work",
    ]);
    for (const item of items) item.click?.(undefined as never, undefined, undefined as never);
    expect(calls).toEqual(["open", "task a", "quit"]);
    const quiet = trayMenu(t, "en", [], [], now, actions);
    expect(quiet.map((i) => i.label ?? i.type)).toContain("No job on");
  });
});
