import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The commit a build comes from, so two builds of one version can be told apart. */
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "dev";
  }
}

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/** Constants the build writes into the app: its version and commit. */
export const buildInfo = {
  __APP_VERSION__: JSON.stringify(version),
  __APP_BUILD__: JSON.stringify(commit()),
};
