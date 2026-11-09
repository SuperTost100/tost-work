import { execFile } from "node:child_process";
import { join } from "node:path";

/**
 * Starting at login from the Microsoft Store package. Electron's login item doesn't work inside a package; a packaged
 * app starts at login through the startup task its manifest declares (build/appx-manifest.xml), which only Windows'
 * StartupTask API turns on and off. Electron can't reach that API, and a helper from outside the package, such as
 * PowerShell, runs without the package's identity, which the API needs: CI showed it. So the package carries its own
 * small helper, build/startup-task/StartupTask.cs, compiled by the Store job into resources/bin.
 */

/** The state the helper printed, or null when it printed none, as when it caught an error. */
export function parseState(output: string): string | null {
  return /^state=(\w+)/m.exec(output)?.[1] ?? null;
}

type Run = (change: "on" | "off") => Promise<string>;

const runHelper: Run = (change) =>
  new Promise((resolve, reject) => {
    execFile(
      join(process.resourcesPath, "bin", "startup-task.exe"),
      [change],
      { windowsHide: true, timeout: 30_000 },
      (err, stdout) => (err ? reject(new Error(`${err.message}\n${stdout}`)) : resolve(stdout)),
    );
  });

/**
 * Turns the package's startup task on or off. Fails when Windows keeps it from changing: the user turned it off in
 * Task Manager or Settings (DisabledByUser), which only they can undo there, or a policy did.
 */
export async function setStartupTask(on: boolean, run: Run = runHelper): Promise<void> {
  const output = await run(on ? "on" : "off");
  const state = parseState(output);
  if (state === null) throw new Error(`The startup task's helper didn't report its state: ${output.trim()}`);
  if (on ? state !== "Enabled" : state === "Enabled") throw new Error(`Windows kept the startup task ${output.trim()}`);
}
