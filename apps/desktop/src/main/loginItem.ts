import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** What starting at login needs from Electron and the system, so the choice can be tested without them. */
export interface LoginDeps {
  platform: NodeJS.Platform;
  /** Electron's switch, which works on Mac and Windows. */
  setLoginItemSettings(settings: { openAtLogin: boolean; args?: string[] }): void;
  /** ~/.config/autostart, where Linux desktops look for programs to start. */
  autostartDir: string;
  /** The program to start: the AppImage when there is one, since the path inside it changes on each run. */
  exec: string;
  /** Set in the Microsoft Store package, where Electron's switch does nothing: turns the package's startup task on. */
  startupTask?: (on: boolean) => Promise<void>;
}

/** The flag a start at login carries, so Tost Work can start without opening its window. */
export const AT_LOGIN = "--at-login";

const DESKTOP_FILE = "tost-work.desktop";

/** Starts Tost Work when the user logs in, or stops doing so. */
export async function setOpenAtLogin(on: boolean, deps: LoginDeps): Promise<void> {
  if (deps.startupTask) {
    await deps.startupTask(on);
    return;
  }
  if (deps.platform !== "linux") {
    deps.setLoginItemSettings({ openAtLogin: on, args: [AT_LOGIN] });
    return;
  }
  const file = join(deps.autostartDir, DESKTOP_FILE);
  if (!on) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(deps.autostartDir, { recursive: true });
  // The path is quoted, as the desktop entry format asks for one with spaces.
  const exec = `"${deps.exec.replace(/(["`$\\])/g, "\\$1")}" ${AT_LOGIN}`;
  await writeFile(
    file,
    `[Desktop Entry]\nType=Application\nName=Tost Work\nExec=${exec}\nX-GNOME-Autostart-enabled=true\n`,
  );
}
