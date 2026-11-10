/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { translate } from "../shared/i18n";
import type { Job, Task } from "../shared/model";
import { AT_LOGIN } from "./loginItem";
import { onSecondLaunch, opensWindow, panelBounds, showsForSecondLaunch, staysInMenuBar, trayMenu } from "./tray";

const job = (title: string, time: string, on = true) =>
  ({ title, on, skip: null, schedule: { repeat: "daily", time } }) as unknown as Job;
const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate("en", key, vars);

describe("staysInMenuBar", () => {
  it("stays whenever the setting allows it, job or no job", () => {
    expect(staysInMenuBar({ stayInMenuBar: true })).toBe(true);
    expect(staysInMenuBar({ stayInMenuBar: false })).toBe(false);
  });
});

describe("opensWindow", () => {
  it("opens the window at login only when the user chose it", () => {
    expect(opensWindow(true, { loginOpens: "menuBar" })).toBe(false);
    expect(opensWindow(true, { loginOpens: "window" })).toBe(true);
    expect(opensWindow(false, { loginOpens: "menuBar" })).toBe(true);
  });
});

describe("showsForSecondLaunch", () => {
  const exe = "C:\\Users\\giulia\\AppData\\Local\\Programs\\tost-work\\Tost Work.exe";

  it("brings the window forward when the user opens Tost Work again", () => {
    expect(showsForSecondLaunch({ atLogin: false }, [exe])).toBe(true);
    // Data that didn't arrive, or came from an unexpected sender, counts as a plain launch.
    expect(showsForSecondLaunch(null, [exe])).toBe(true);
    expect(showsForSecondLaunch("at-login", [exe])).toBe(true);
  });

  it("leaves the running copy alone when the login started the second one", () => {
    expect(showsForSecondLaunch({ atLogin: true }, [exe, AT_LOGIN])).toBe(false);
    expect(showsForSecondLaunch({ atLogin: true }, [exe])).toBe(false);
    // Windows can reorder the arguments and add Chromium's own; the flag still counts.
    expect(showsForSecondLaunch(undefined, [exe, "--allow-file-access-from-files", AT_LOGIN])).toBe(false);
  });
});

describe("onSecondLaunch", () => {
  const exe = "C:\\Users\\giulia\\AppData\\Local\\Programs\\tost-work\\Tost Work.exe";
  const cwd = "C:\\Users\\giulia";

  it("reads the data from the event's fourth argument, after the working directory", () => {
    const show = vi.fn();
    onSecondLaunch(show)({}, [exe], cwd, { atLogin: true });
    expect(show).not.toHaveBeenCalled();
    onSecondLaunch(show)({}, [exe], cwd, { atLogin: false });
    expect(show).toHaveBeenCalledTimes(1);
  });
});

describe("panelBounds", () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const size = { width: 340, height: 420 };

  it("opens under a menu-bar icon, centred on it", () => {
    expect(panelBounds({ x: 1000, y: 0, width: 24, height: 24 }, size, area)).toEqual({
      x: 842,
      y: 31,
      width: 340,
      height: 420,
    });
  });

  it("stays inside the screen when the icon is near its edge", () => {
    expect(panelBounds({ x: 1420, y: 0, width: 20, height: 24 }, size, area).x).toBe(1440 - 340 - 6);
  });

  it("opens above an icon in a taskbar at the bottom, and shrinks to fit a short screen", () => {
    const taskbar = { x: 0, y: 0, width: 1920, height: 1040 };
    expect(panelBounds({ x: 1700, y: 1048, width: 24, height: 24 }, size, taskbar).y).toBe(1040 - 420 - 6);
    expect(panelBounds({ x: 1000, y: 0, width: 24, height: 24 }, { width: 340, height: 2000 }, area).height).toBe(863);
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
