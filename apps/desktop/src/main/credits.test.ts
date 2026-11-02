/** @vitest-environment node */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { npmCredits } from "../../credits";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A small app on disk: its package.json, one source file, and the installed packages given. */
function app(opts: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  source: string;
  installed: Record<string, object>;
}) {
  const root = mkdtempSync(join(tmpdir(), "credits-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: opts.dependencies, devDependencies: opts.devDependencies }),
  );
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "main.ts"), opts.source);
  writeFileSync(join(root, "src", "main.test.ts"), 'import "vitest";');
  for (const [name, pkg] of Object.entries(opts.installed)) {
    mkdirSync(join(root, "node_modules", name), { recursive: true });
    writeFileSync(join(root, "node_modules", name, "package.json"), JSON.stringify(pkg));
  }
  return root;
}

describe("npmCredits", () => {
  it("lists the dependencies and the dev dependencies the code imports, not the tools or what tests import", () => {
    const root = app({
      dependencies: { zod: "1" },
      devDependencies: { react: "1", "react-dom": "1", "@scope/ui": "1", vitest: "1", vite: "1" },
      source: `
        import { z } from "zod";
        import { createRoot } from "react-dom/client";
        import { Button } from "@scope/ui/button";
        import { x } from "./local";
        import { y } from "@/alias";
        import fs from "node:fs";
      `,
      installed: {
        zod: { version: "1.0.0", license: "MIT", homepage: "https://zod.dev" },
        "react-dom": {
          version: "2.0.0",
          license: "MIT",
          repository: { url: "git+https://github.com/facebook/react.git" },
        },
        "@scope/ui": { version: "3.0.0", licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] },
        react: { version: "2.0.0", license: { type: "MIT" } },
        vitest: { version: "9.0.0", license: "MIT" },
      },
    });
    expect(npmCredits(root)).toEqual([
      { name: "@scope/ui", version: "3.0.0", license: "MIT OR Apache-2.0", url: null },
      { name: "react-dom", version: "2.0.0", license: "MIT", url: "https://github.com/facebook/react" },
      { name: "zod", version: "1.0.0", license: "MIT", url: "https://zod.dev" },
    ]);
  });

  it("says so when a package is not installed", () => {
    const root = app({ dependencies: { zod: "1" }, source: "", installed: {} });
    expect(() => npmCredits(root)).toThrow(/zod is not installed/);
  });

  it("covers the real app: every production dependency with a licence and an https link at most", () => {
    const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
    const list = npmCredits(root);
    const names = list.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["zod", "jszip", "cli-funnel", "@modelcontextprotocol/sdk", "@milkdown/kit"]),
    );
    // Bundled into the window from devDependencies.
    expect(names).toEqual(expect.arrayContaining(["react", "marked", "pdfjs-dist"]));
    expect(names).not.toContain("vitest");
    expect(names).not.toContain("typescript");
    for (const c of list) {
      expect(c.license, c.name).not.toBe("unknown");
      expect(c.version, c.name).toBeTruthy();
      if (c.url) expect(c.url, c.name).toMatch(/^https:\/\//);
    }
  });
});
