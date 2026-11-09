/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { setOpenAtLogin } from "./loginItem";
import { parseState, setStartupTask } from "./startupTask";

describe("the Microsoft Store package's startup task", () => {
  it("reads the state PowerShell prints, past any other output", () => {
    expect(parseState("WARNING: something\r\nstate=Enabled\r\n")).toBe("Enabled");
    expect(parseState("state=DisabledByUser")).toBe("DisabledByUser");
    expect(parseState("Exception calling GetAsync")).toBeNull();
  });

  it("asks for the change and fails when Windows keeps the task as it was", async () => {
    const asked: string[] = [];
    const answer = (state: string) => async (env: Record<string, string>) => {
      asked.push(env.TOST_WORK_STARTUP as string);
      return `state=${state}\n`;
    };
    await setStartupTask(true, answer("Enabled"));
    await setStartupTask(false, answer("Disabled"));
    expect(asked).toEqual(["on", "off"]);
    await expect(setStartupTask(true, answer("DisabledByUser"))).rejects.toThrow("DisabledByUser");
    await expect(setStartupTask(false, answer("Enabled"))).rejects.toThrow("Enabled");
    await expect(setStartupTask(true, async () => "")).rejects.toThrow("didn't report");
  });

  it("takes over from Electron's login item inside the package", async () => {
    const calls: boolean[] = [];
    await setOpenAtLogin(true, {
      platform: "win32",
      setLoginItemSettings: () => {
        throw new Error("Electron's switch does nothing in a package");
      },
      autostartDir: "/x",
      exec: "/x",
      startupTask: async (on) => {
        calls.push(on);
      },
    });
    expect(calls).toEqual([true]);
  });
});
