/** @vitest-environment node */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ASSET_NOTICE_FILES,
  isAllowedLicense,
  licensedPackages,
  renderLicenses,
  unlistedPackages,
} from "../../licenses";
import { BUNDLED_ASSETS } from "../shared/credits";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A small app on disk with `installed` packages, each given as its package.json and its files. */
function app(opts: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  source: string;
  installed: Record<string, { pkg: object; files?: Record<string, string> }>;
}) {
  const root = mkdtempSync(join(tmpdir(), "licenses-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: opts.dependencies, devDependencies: opts.devDependencies }),
  );
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "main.ts"), opts.source);
  for (const [name, { pkg, files }] of Object.entries(opts.installed)) {
    const dir = join(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", license: "MIT", ...pkg }));
    for (const [file, text] of Object.entries(files ?? { LICENSE: `${name} licence` })) {
      writeFileSync(join(dir, file), text);
    }
  }
  return root;
}

describe("isAllowedLicense", () => {
  it("accepts permissive licences and expressions with a permissive way out", () => {
    for (const ok of ["MIT", "Apache-2.0", "(MIT OR GPL-3.0-or-later)", "(MPL-2.0 OR Apache-2.0)", "(MIT AND Zlib)"]) {
      expect(isAllowedLicense(ok), ok).toBe(true);
    }
  });

  it("refuses copyleft, restricted, unknown and half-allowed licences", () => {
    const bad = [
      "GPL-3.0-or-later",
      "LGPL-2.1",
      "AGPL-3.0",
      "MPL-2.0",
      "EPL-2.0",
      "CC-BY-NC-4.0",
      "SSPL-1.0",
      "BUSL-1.1",
      "UNLICENSED",
      "unknown",
      "SEE LICENSE IN LICENSE.md",
      "(MIT AND GPL-3.0-only)",
      "MIT WITH Classpath-exception-2.0",
      "(MIT OR",
      "",
    ];
    for (const license of bad) expect(isAllowedLicense(license), license).toBe(false);
  });
});

describe("licensedPackages", () => {
  it("follows the dependencies of what ships, with their licence files, and leaves out tools and Electron's downloads", () => {
    const root = app({
      dependencies: { a: "1" },
      devDependencies: { ui: "1", electron: "1", vitest: "1" },
      source: 'import { x } from "ui"; import { app } from "electron"; import "a";',
      installed: {
        a: { pkg: { dependencies: { b: "1" }, optionalDependencies: { "a-native": "1", "a-other": "1" } } },
        b: { pkg: { license: "ISC" }, files: { "LICENSE.md": "b licence", "NOTICE.txt": "b notice", "index.js": "x" } },
        "a-native": { pkg: {} },
        ui: { pkg: { dependencies: { helper: "1" }, optionalDependencies: { "ui-native": "1" } } },
        helper: { pkg: {} },
        "ui-native": { pkg: {} },
        electron: { pkg: { dependencies: { "electron-download": "1" } } },
        "electron-download": { pkg: {} },
        vitest: { pkg: {} },
      },
    });
    const list = licensedPackages(root);
    // a-other isn't installed, which an optional dependency may be. ui-native is only for the archive, not the window.
    expect(list.map((p) => p.name)).toEqual(["a", "a-native", "b", "electron", "helper", "ui"]);
    const b = list.find((p) => p.name === "b");
    expect(b?.license).toBe("ISC");
    expect(b?.texts).toEqual([
      { file: "LICENSE.md", text: "b licence" },
      { file: "NOTICE.txt", text: "b notice" },
    ]);
  });

  it("says so when a needed package is not installed", () => {
    const root = app({
      dependencies: { a: "1" },
      source: "",
      installed: { a: { pkg: { dependencies: { gone: "1" } } } },
    });
    expect(() => licensedPackages(root)).toThrow(/gone, needed by a@1.0.0, is not installed/);
  });
});

describe("unlistedPackages", () => {
  const listed = new Set(["react", "@milkdown/kit"]);

  it("finds nothing for listed packages, including scoped ones and pnpm's paths", () => {
    expect(
      unlistedPackages(
        [
          "/repo/node_modules/.pnpm/react@19.3.1/node_modules/react/index.js",
          "/repo/node_modules/.pnpm/@milkdown+kit@7.23.0/node_modules/@milkdown/kit/lib/index.js?commonjs-proxy",
          "\\0vite/preload-helper.js",
          "/repo/apps/desktop/src/main/index.ts",
        ],
        listed,
      ),
    ).toEqual([]);
  });

  it("names the packages in the bundle that the file leaves out", () => {
    expect(
      unlistedPackages(
        [
          "/repo/node_modules/.pnpm/sneaky@1.0.0/node_modules/sneaky/index.js",
          "/repo/node_modules/.pnpm/x@1/node_modules/@scope/other/index.js",
          "/repo/node_modules/.pnpm/react@1/node_modules/react/index.js",
        ],
        listed,
      ),
    ).toEqual(["@scope/other", "sneaky"]);
  });
});

describe("the licences the real app ships", () => {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const packages = licensedPackages(root);

  it("are all permissive, so none conflicts with releasing the app under MIT", () => {
    const refused = packages
      .filter((p) => !isAllowedLicense(p.license))
      .map((p) => `${p.name}@${p.version} ${p.license}`);
    expect(refused).toEqual([]);
  });

  it("each come with their text, and cover what the window and the archive hold", () => {
    expect(packages.filter((p) => p.texts.length === 0).map((p) => `${p.name}@${p.version}`)).toEqual([]);
    const names = packages.map((p) => p.name);
    // Direct dependencies, bundled devDependencies and things only those need.
    expect(names).toEqual(
      expect.arrayContaining(["zod", "react", "react-dom", "electron", "pako", "prosemirror-model"]),
    );
    expect(names).not.toContain("vitest");
    expect(names).not.toContain("typescript");
  });

  it("have a licence file for every font and icon set the credits name", () => {
    expect(Object.keys(ASSET_NOTICE_FILES).sort()).toEqual(BUNDLED_ASSETS.map((a) => a.name).sort());
  });

  it("go into one text with the assets, OfficeCLI, Electron and each package, and are packaged with the app", () => {
    const text = renderLicenses(root, packages);
    for (const asset of BUNDLED_ASSETS) expect(text, asset.name).toContain(asset.name);
    expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(text).toContain("Apache License");
    expect(text).toMatch(/OfficeCLI \d+\.\d+\.\d+ \(Apache-2\.0/);
    expect(text).toContain("LICENSES.chromium.html");
    for (const p of packages) expect(text, p.name).toContain(`${p.name} ${p.version}`);
    expect(readFileSync(join(root, "electron-builder.yml"), "utf8")).toContain(
      "from: resources/generated/THIRD-PARTY-LICENSES.txt",
    );
  });
});
