/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { setOpenAtLogin } from "./loginItem";
import { parseState, setStartupTask } from "./startupTask";

describe("the Microsoft Store package's startup task", () => {
  it("reads the state the helper prints, past any other output", () => {
    expect(parseState("note\r\nstate=Enabled\r\n")).toBe("Enabled");
    expect(parseState("state=DisabledByUser")).toBe("DisabledByUser");
    expect(parseState("state=Missing tasks=Other")).toBe("Missing");
    expect(parseState("error=Element not found.")).toBeNull();
  });

  it("asks for the change and fails when Windows keeps the task as it was", async () => {
    const asked: string[] = [];
    const answer = (state: string) => async (change: string) => {
      asked.push(change);
      return `state=${state}\n`;
    };
    await setStartupTask(true, answer("Enabled"));
    await setStartupTask(false, answer("Disabled"));
    expect(asked).toEqual(["on", "off"]);
    await expect(setStartupTask(true, answer("DisabledByUser"))).rejects.toThrow("DisabledByUser");
    await expect(setStartupTask(false, answer("Enabled"))).rejects.toThrow("Enabled");
    await expect(setStartupTask(true, async () => "")).rejects.toThrow("didn't report");
    await setStartupTask(true, answer("EnabledByPolicy"));
    await expect(setStartupTask(false, answer("EnabledByPolicy"))).rejects.toThrow("EnabledByPolicy");
    await expect(setStartupTask(false, answer("Missing tasks="))).rejects.toThrow("Missing");
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
