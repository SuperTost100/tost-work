import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { licenseOf, linkOf, type PackageJson, readJson, shippedRoots } from "./credits";
import { BUNDLED_ASSETS, LICENSES_DIR, LICENSES_FILE } from "./src/shared/credits";

/**
 * Licences the app may ship. They are permissive: they allow redistribution inside a program released under MIT as
 * long as the notice travels with it, which this file does. Anything else (GPL, LGPL, AGPL, MPL, EPL, CC-BY-NC, SSPL,
 * BUSL, unknown) needs a decision from the owner, so adding a package under one fails the licence test.
 */
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Zlib",
]);

/**
 * Whether an SPDX expression can be satisfied with allowed licences: one alternative of an OR is enough, every part
 * of an AND is needed, and `WITH` exceptions or ids outside the list are refused.
 */
export function isAllowedLicense(expression: string): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const peek = () => tokens[at]?.toUpperCase();
  const atom = (): boolean => {
    const token = tokens[at++];
    if (token === undefined) return false;
    if (token === "(") {
      const inner = or();
      if (tokens[at++] !== ")") return false;
      return inner;
    }
    return ALLOWED_LICENSES.has(token);
  };
  const and = (): boolean => {
    let ok = atom();
    while (peek() === "AND") {
      at++;
      ok = atom() && ok;
    }
    return ok;
  };
  const or = (): boolean => {
    let ok = and();
    while (peek() === "OR") {
      at++;
      ok = and() || ok;
    }
    return ok;
  };
  const result = or();
  return result && at === tokens.length;
}

export interface LicenseText {
  file: string;
  text: string;
}

export interface LicensedPackage {
  name: string;
  version: string;
  license: string;
  url: string | null;
  texts: LicenseText[];
}

const mit = (copyright: string) =>
  `MIT License

Copyright (c) ${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/**
 * Installed packages that declare MIT but ship no licence file, so the text comes from their repository's LICENSE.
 * Keyed by name and version: a new version has to be checked again, and goes from here when it ships its own file.
 */
const MISSING_TEXT: Record<string, LicenseText> = {
  "cli-funnel@0.7.0": {
    file: "LICENSE (github.com/SuperTost100/cli-funnel)",
    text: mit("2026 cli-funnel contributors"),
  },
  "isarray@1.0.0": {
    file: "LICENSE (github.com/juliangruber/isarray)",
    text: mit("2013 Julian Gruber <julian@juliangruber.com>"),
  },
};

/** Packages that are listed but whose own dependencies are not shipped: Electron's only download the binary. */
const LEAVES = new Set(["electron"]);

const NOTICE_FILE = /^(licen[cs]es?|copying|notice|patents)([._-].*)?$/i;
/** The files that hold the licence terms themselves. NOTICE and PATENTS files only add to them. */
const LICENSE_FILE = /^(licen[cs]es?|copying)(?![a-z0-9])/i;

/** Whether the texts include the licence terms, and not only notices that go with them. */
export const hasLicenseText = (texts: LicenseText[]) => texts.some((t) => LICENSE_FILE.test(t.file));
const NOT_TEXT = /\.(?:[cm]?[jt]sx?|json|map|html?|css|node)$/i;

/** The folder of a dependency as Node finds it from a package: its own `node_modules`, then each parent's. */
function locate(from: string, name: string): string | null {
  for (let dir = dirname(from); ; dir = dirname(dir)) {
    const candidate = join(basename(dir) === "node_modules" ? dir : join(dir, "node_modules"), name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}

function noticeTexts(dir: string): LicenseText[] {
  const seen = new Set<string>();
  const texts: LicenseText[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!NOTICE_FILE.test(file) || NOT_TEXT.test(file) || !statSync(join(dir, file)).isFile()) continue;
    const text = readFileSync(join(dir, file), "utf8").trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      texts.push({ file, text });
    }
  }
  return texts;
}

/**
 * Every npm package the app ships, with its licence text, read from the installed copies: what the packaged app
 * holds in its archive (the production dependencies and everything they need) and what the build bundles into the
 * window from the devDependencies the code imports, with everything those need too.
 */
export function licensedPackages(root: string): LicensedPackage[] {
  const found = new Map<string, LicensedPackage>();
  const visit = (dir: string, follow: boolean, shipped: boolean) => {
    const pkg = readJson(join(dir, "package.json"));
    const key = `${pkg.name}@${pkg.version}`;
    if (!pkg.name || !pkg.version) throw new Error(`Licences: ${dir} has no name or version.`);
    if (found.has(key)) return;
    const texts = noticeTexts(dir);
    const missing = MISSING_TEXT[key];
    if (missing && !hasLicenseText(texts)) texts.push(missing);
    found.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: licenseOf(pkg),
      url: linkOf(pkg),
      texts,
    });
    if (!follow) return;
    const needs = (list: PackageJson["dependencies"], optional: boolean) => {
      for (const name of Object.keys(list ?? {})) {
        const at = locate(dir, name);
        if (at) visit(at, true, shipped);
        else if (!optional) throw new Error(`Licences: ${name}, needed by ${key}, is not installed. Run pnpm install.`);
      }
    };
    needs(pkg.dependencies, false);
    // A package the window bundles never holds its optional, platform-specific libraries; the archive does.
    if (shipped) needs(pkg.optionalDependencies, true);
  };
  const productionRoots = new Set(Object.keys(readJson(join(root, "package.json")).dependencies ?? {}));
  for (const name of shippedRoots(root)) {
    const at = locate(join(root, "x"), name);
    if (!at) throw new Error(`Licences: ${name} is not installed. Run pnpm install first.`);
    visit(at, !LEAVES.has(name), productionRoots.has(name));
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** The licence files of the fonts and icons, by the name `BUNDLED_ASSETS` gives them, relative to the renderer's assets. */
export const ASSET_NOTICE_FILES: Record<string, string[]> = {
  "Schibsted Grotesk": ["fonts/schibsted-grotesk-OFL.txt"],
  "IBM Plex Mono": ["fonts/ibm-plex-mono-OFL.txt"],
  Carlito: ["fonts/carlito-OFL.txt"],
  Caladea: ["fonts/caladea-OFL.txt"],
  "MingCute icons": ["icons/mingcute-LICENSE.txt"],
};

const RULE = "=".repeat(78);
const THIN = "-".repeat(78);

function officeCliVersion(root: string): string {
  const script = readFileSync(join(root, "scripts", "fetch-officecli.mjs"), "utf8");
  const version = /const VERSION = "([^"]+)"/.exec(script)?.[1];
  if (!version) throw new Error("Licences: found no OfficeCLI version in scripts/fetch-officecli.mjs.");
  return version;
}

/** The notices as one text file: the pieces that don't come from npm first, then each npm package. */
export function renderLicenses(root: string, packages: LicensedPackage[]): string {
  const out: string[] = [
    "TOST WORK: THIRD-PARTY LICENCES",
    "",
    "Tost Work is released under the MIT licence (see LICENSE in the source repository). It includes the software",
    "listed below, each under its own licence. This file is generated when the app is built.",
    "",
    RULE,
    "ELECTRON AND CHROMIUM",
    RULE,
    "",
    "Tost Work is built on Electron (MIT), which contains Chromium and the libraries Chromium is made of. Their",
    "licences are shipped unchanged by Electron's own distribution:",
    "  LICENSE.electron.txt     Electron's licence",
    "  LICENSES.chromium.html   the licences of Chromium and its third-party components",
    "They sit in the app's folder on Windows and Linux and in Contents/Resources inside the app on macOS.",
    "",
    RULE,
    "OFFICECLI",
    RULE,
    "",
    `OfficeCLI ${officeCliVersion(root)} (Apache-2.0, https://github.com/iOfficeAI/OfficeCLI) is shipped as a separate program in the`,
    "bin folder of the app's resources, next to its own officecli-LICENSE, officecli-NOTICE and",
    "officecli-THIRD-PARTY-NOTICES.txt, which also cover the libraries it contains.",
    "",
    RULE,
    "FONTS AND ICONS",
    RULE,
  ];
  for (const asset of BUNDLED_ASSETS) {
    const files = ASSET_NOTICE_FILES[asset.name];
    if (!files) throw new Error(`Licences: ${asset.name} has no licence file in ASSET_NOTICE_FILES.`);
    out.push(
      "",
      THIN,
      asset.name,
      `Licence: ${asset.license}`,
      ...(asset.url ? [`Source: ${asset.url}`] : []),
      THIN,
      "",
    );
    for (const file of files)
      out.push(readFileSync(join(root, "src", "renderer", "src", "assets", file), "utf8").trim(), "");
  }
  out.push(RULE, "NPM PACKAGES", RULE);
  for (const pkg of packages) {
    out.push(
      "",
      THIN,
      `${pkg.name} ${pkg.version}`,
      `Licence: ${pkg.license}`,
      ...(pkg.url ? [`Source: ${pkg.url}`] : []),
      THIN,
      "",
    );
    for (const { text } of pkg.texts) out.push(text, "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** The package a bundled module belongs to, from its path: the last `node_modules/<name>` in it. */
function packageOfModule(id: string): string | null {
  const path = id.replace(/\\/g, "/").replace(/\?.*$/, "");
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const parts = path.slice(at + "/node_modules/".length).split("/");
  return (parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]) ?? null;
}

/** The packages the bundled modules come from that the licence file doesn't list, by name. */
export function unlistedPackages(moduleIds: Iterable<string>, listed: ReadonlySet<string>): string[] {
  const missing = new Set<string>();
  for (const id of moduleIds) {
    const name = packageOfModule(id);
    if (name && !listed.has(name)) missing.add(name);
  }
  return [...missing].sort();
}

/**
 * Writes the notices file (when `write` is set) and fails the build if the bundle holds code from a package the file
 * leaves out, which would mean a licence is missing from what ships.
 */
export function licensesPlugin(options: { write: boolean; root?: string }): Plugin {
  const root = options.root ?? dirname(fileURLToPath(import.meta.url));
  let names: Set<string> | null = null;
  const known = () => {
    names ??= new Set(licensedPackages(root).map((p) => p.name));
    return names;
  };
  return {
    name: "tost-work-licenses",
    buildStart() {
      if (!options.write) return;
      const target = join(root, LICENSES_DIR, LICENSES_FILE);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, renderLicenses(root, licensedPackages(root)));
    },
    buildEnd(error) {
      if (error) return;
      const missing = unlistedPackages(this.getModuleIds(), known());
      if (missing.length) {
        throw new Error(`Licences: the bundle holds ${missing.join(", ")}, which licences.ts doesn't list.`);
      }
    },
  };
}
