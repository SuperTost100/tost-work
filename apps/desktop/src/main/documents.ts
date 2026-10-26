import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { app } from "electron";
import type { DocumentTools } from "./engine/codex";
import { makePdf } from "./pdf";

/**
 * OfficeCLI and the Word, Excel, PowerPoint and PDF skills, where the build put them. Null when OfficeCLI is missing,
 * as in a checkout where `node scripts/fetch-officecli.mjs` hasn't run: the agent then works without them.
 */
export function documentTools(): DocumentTools | null {
  const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform as string] ?? process.platform;
  const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
  const bin = app.isPackaged ? join(resources, "bin") : join(resources, "bin", `${os}-${process.arch}`);
  const officecli = join(bin, process.platform === "win32" ? "officecli.exe" : "officecli");
  if (!existsSync(officecli)) {
    console.warn(`No OfficeCLI at ${officecli}. Run node scripts/fetch-officecli.mjs to add it.`);
    return null;
  }
  // Windows spells it Path; a second PATH key would leave the child with either one.
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const env = {
    [pathKey]: `${bin}${delimiter}${process.env[pathKey] ?? ""}`,
    // OfficeCLI otherwise checks for updates online once a day and replaces its own binary.
    OFFICECLI_SKIP_UPDATE: "1",
    // And it otherwise leaves a background process holding the file after each command.
    OFFICECLI_NO_AUTO_RESIDENT: "1",
    // shortcut: 1.0.158 still writes OfficeCLI.Version and OfficeCLI.LastModified into the custom properties of every
    // file it saves (iOfficeAI/OfficeCLI#518); this switch turns that off in the release that adds it.
    OFFICECLI_NO_STAMP: "1",
  };
  return {
    skills: join(resources, "skills"),
    env,
    makePdf: (source, target) => makePdf(officecli, { ...process.env, ...env }, source, target),
  };
}
