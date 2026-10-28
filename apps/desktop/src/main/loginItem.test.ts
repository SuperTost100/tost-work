/** @vitest-environment node */
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AT_LOGIN, setOpenAtLogin } from "./loginItem";

describe("setOpenAtLogin", () => {
  it("uses the system's login items on Mac and Windows", async () => {
    const calls: unknown[] = [];
    const deps = {
      platform: "darwin" as const,
      setLoginItemSettings: (s: unknown) => calls.push(s),
      autostartDir: "/x",
      exec: "/x",
    };
    await setOpenAtLogin(true, deps);
    await setOpenAtLogin(false, deps);
    expect(calls).toEqual([
      { openAtLogin: true, args: [AT_LOGIN] },
      { openAtLogin: false, args: [AT_LOGIN] },
    ]);
  });

  it("writes and removes an autostart entry on Linux, quoting the path", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "tw-login-")), "autostart");
    const deps = {
      platform: "linux" as const,
      setLoginItemSettings: () => {
        throw new Error("not on Linux");
      },
      autostartDir: dir,
      exec: '/home/giulia/Apps/Tost Work "beta".AppImage',
    };
    await setOpenAtLogin(true, deps);
    const entry = await readFile(join(dir, "tost-work.desktop"), "utf8");
    expect(entry).toContain('Exec="/home/giulia/Apps/Tost Work \\"beta\\".AppImage" --at-login');
    await setOpenAtLogin(false, deps);
    await expect(access(join(dir, "tost-work.desktop"))).rejects.toThrow();
  });
});
