import type { Language } from "../../../shared/i18n";
import type { Stage } from "../../../shared/model";
import source from "../assets/changelog.md?raw";

export interface ChangelogEntry {
  version: string;
  /** One line per change, in each language. A `**title:**` at the start is shown in bold. */
  items: Record<Language, string[]>;
}

const LANGUAGES: readonly Language[] = ["en", "it"];

/**
 * Reads the changelog file: a `## 1.2.3` heading per version, `### en` and `### it` under it, and `- ` lines of text.
 * A mistake in the file throws with its line, so the test on the real file catches it before a release does.
 */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let language: Language | null = null;
  const lines = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, "")).split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const fail = (why: string) => new Error(`Changelog line ${i + 1}: ${why}`);
    if (!line) return;
    const version = line.startsWith("## ") ? VERSION.exec(line.slice(3))?.[0] : undefined;
    if (version) {
      entry = { version, items: { en: [], it: [] } };
      entries.push(entry);
      language = null;
    } else if (line.startsWith("## ")) {
      throw fail(`"${line}" is not a version like 1.2.3 or 1.2.3-alpha`);
    } else if (line.startsWith("### ")) {
      const name = line.slice(4);
      const found = LANGUAGES.find((l) => l === name);
      if (!entry || !found) throw fail(`"${line}" needs a version above it and en or it`);
      language = found;
    } else if (line.startsWith("- ")) {
      if (!entry || !language) throw fail("a change needs a version and a language above it");
      entry.items[language].push(line.slice(2));
    } else {
      throw fail(`"${line}" is not a heading or a "- " line`);
    }
  });
  return entries;
}

/** A version as the app writes it: the numbers, then the stage for any build before 1.0.0, such as "0.1.0-alpha". */
const VERSION = /^\d+\.\d+\.\d+(?:-(?:dev|alpha|beta))?$/;

export type { Stage };

/** The stage a version belongs to: "0.0.23-dev" is a dev build, and a version without a stage is a stable release. */
export function stageOf(version: string): Stage {
  const stage = version.split("-")[1];
  return stage === "dev" || stage === "alpha" || stage === "beta" ? stage : "stable";
}

/** A version as people read it: "0.1.0 alpha". */
export const versionLabel = (version: string): string => version.replace("-", " ");

/** Negative when `a` is the older version, positive when it is the newer. A stage comes before the release itself. */
export function compareVersions(a: string, b: string): number {
  const [an = "", as] = a.split("-");
  const [bn = "", bs] = b.split("-");
  const x = an.split(".").map(Number);
  const y = bn.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return Number(!as) - Number(!bs);
}

/**
 * The entries of the app's own stage up to its version, newest first, so an alpha lists only alphas and not every
 * dev build before them. The entry for a release in preparation stays out of sight.
 */
export function shownEntries(entries: ChangelogEntry[], appVersion: string): ChangelogEntry[] {
  const stage = stageOf(appVersion);
  return entries
    .filter((e) => stageOf(e.version) === stage && compareVersions(e.version, appVersion) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

export const CHANGELOG = parseChangelog(source);
