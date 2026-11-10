/** @vitest-environment node */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const appPath = mkdtempSync(join(tmpdir(), "tw-documents-"));
vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => appPath } }));
const { documentTools } = await import("./documents");

const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform as string] ?? process.platform;
const bin = join(appPath, "resources", "bin", `${os}-${process.arch}`);
mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, process.platform === "win32" ? "officecli.exe" : "officecli"), "");

afterEach(() => vi.unstubAllEnvs());
afterAll(() => rmSync(appPath, { recursive: true, force: true }));

describe("documentTools", () => {
  it("puts OfficeCLI's folder on the PATH the CLI's commands get, also where the app's variable is spelled Path", () => {
    // Windows spells the app's variable Path. cli-funnel starts a CLI with { ...process.env, PATH: its search path,
    // ...env }, and Node on Windows keeps the spelling that sorts first among those that differ only in case.
    vi.stubEnv("PATH", undefined);
    vi.stubEnv("Path", "C:\\Windows");
    const env = documentTools()?.env ?? {};
    const child: Record<string, string | undefined> = { ...process.env, PATH: "C:\\Windows;C:\\funnel", ...env };
    const kept = Object.keys(child)
      .filter((k) => k.toUpperCase() === "PATH")
      .sort()[0];
    expect(kept && child[kept]?.split(delimiter)[0]).toBe(bin);
  });
});
