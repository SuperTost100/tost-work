import { execFile } from "node:child_process";

/**
 * Starting at login from the Microsoft Store package. Electron's login item doesn't work inside a package; a packaged
 * app starts at login through the startup task its manifest declares (build/appx-manifest.xml), which only Windows'
 * StartupTask API turns on and off. Electron has no binding for it, so Windows PowerShell 5.1, which ships with every
 * Windows 10 and 11 and reaches WinRT, calls it. It runs as the app's child, inside the package, which the API needs.
 */

/** The task's id in the manifest. */
export const STARTUP_TASK = "TostWorkStartup";

/** Turns the task on ("on"), off ("off"), and prints its state: Enabled, Disabled, DisabledByUser, DisabledByPolicy… */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
} | Select-Object -First 1
function Wait-Op($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result
}
$null = [Windows.ApplicationModel.StartupTask, Windows.ApplicationModel, ContentType = WindowsRuntime]
$task = Wait-Op ([Windows.ApplicationModel.StartupTask]::GetAsync('${STARTUP_TASK}')) ([Windows.ApplicationModel.StartupTask])
if ($env:TOST_WORK_STARTUP -eq 'on') { $null = Wait-Op ($task.RequestEnableAsync()) ([Windows.ApplicationModel.StartupTaskState]) }
if ($env:TOST_WORK_STARTUP -eq 'off') { $task.Disable() }
Write-Output "state=$($task.State)"
`;

/** The task's state from the script's output, or null when the output has none, as when PowerShell failed. */
export function parseState(output: string): string | null {
  return /^state=(\w+)\s*$/m.exec(output)?.[1] ?? null;
}

type Run = (env: Record<string, string>) => Promise<string>;

const runPowerShell: Run = (env) =>
  new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 30_000 },
      (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout)),
    );
  });

/**
 * Turns the package's startup task on or off. Fails when Windows keeps it from changing: the user turned it off in
 * Task Manager or Settings (DisabledByUser), which only they can undo there, or a policy did.
 */
export async function setStartupTask(on: boolean, run: Run = runPowerShell): Promise<void> {
  const state = parseState(await run({ TOST_WORK_STARTUP: on ? "on" : "off" }));
  if (state === null) throw new Error("PowerShell didn't report the startup task's state");
  if (on ? state !== "Enabled" : state === "Enabled") throw new Error(`Windows kept the startup task ${state}`);
}
