import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { Credit } from "./src/shared/credits";

interface PackageJson {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  homepage?: string;
  repository?: string | { url?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as PackageJson;

/** Source files the app is built from, without the tests: what a test imports doesn't ship. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.|test-setup|\.d\.ts$/.test(name) ? [path] : [];
  });
}

/** The package an import specifier names: `react-dom/client` is `react-dom`, `@scope/pkg/x` is `@scope/pkg`. */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? null);
}

function licenseOf(pkg: PackageJson): string {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  const types = pkg.licenses?.flatMap((l) => (l.type ? [l.type] : [])) ?? [];
  return types.length ? types.join(" OR ") : "unknown";
}

/** The package's page as an https link, from its homepage or its repository. */
function linkOf(pkg: PackageJson): string | null {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const clean = repo
    ?.replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/\.git$/, "");
  for (const url of [pkg.homepage, clean]) if (url?.startsWith("https://")) return url;
  return null;
}

/**
 * The npm packages the app ships, with their licences, read from the installed copies. These are the `dependencies`
 * plus the `devDependencies` the app's own code imports, because the build bundles those into the window (React,
 * for one) or runs them as the app (Electron). Tools that only build or test it are left out.
 */
export function npmCredits(root: string): Credit[] {
  const app = readJson(join(root, "package.json"));
  const dev = Object.keys(app.devDependencies ?? {});
  const imported = new Set<string>();
  for (const file of sourceFiles(join(root, "src"))) {
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const name = specifier ? packageOf(specifier) : null;
      if (name) imported.add(name);
    }
  }
  const names = new Set([...Object.keys(app.dependencies ?? {}), ...dev.filter((name) => imported.has(name))]);
  return [...names].sort().map((name) => {
    const path = join(root, "node_modules", name, "package.json");
    if (!existsSync(path)) throw new Error(`Credits: ${name} is not installed. Run pnpm install first.`);
    const pkg = readJson(path);
    return { name, version: pkg.version, license: licenseOf(pkg), url: linkOf(pkg) };
  });
}

/** `virtual:credits`: the list above, made when the app is built so nobody keeps it up to date by hand. */
export function creditsPlugin(root = dirname(fileURLToPath(import.meta.url))): Plugin {
  const id = "virtual:credits";
  return {
    name: "tost-work-credits",
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load: (source) => (source === `\0${id}` ? `export default ${JSON.stringify(npmCredits(root))};` : null),
  };
}
