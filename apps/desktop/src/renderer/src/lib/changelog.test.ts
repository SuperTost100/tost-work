import { describe, expect, it } from "vitest";
import { CHANGELOG, compareVersions, parseChangelog, shownEntries, stageOf, versionLabel } from "./changelog";

const SAMPLE = `<!-- a comment
spanning two lines -->

## 1.2.0

### en

- **Title:** First change.
- Second change.

### it

- **Titolo:** Prima modifica.
- Seconda modifica.

## 1.10.0

### en

- Newer.

### it

- Più nuova.
`;

describe("parseChangelog", () => {
  it("reads versions, languages and changes, and skips comments", () => {
    expect(parseChangelog(SAMPLE)).toEqual([
      {
        version: "1.2.0",
        items: {
          en: ["**Title:** First change.", "Second change."],
          it: ["**Titolo:** Prima modifica.", "Seconda modifica."],
        },
      },
      { version: "1.10.0", items: { en: ["Newer."], it: ["Più nuova."] } },
    ]);
  });

  it("names the line of a mistake", () => {
    expect(() => parseChangelog("## next\n")).toThrow(/line 1.*not a version/);
    expect(() => parseChangelog("## 1.0.0\n### fr\n")).toThrow(/line 2/);
    expect(() => parseChangelog("## 1.0.0\n- no language yet\n")).toThrow(/line 2.*language/);
    expect(() => parseChangelog("## 1.0.0\n### en\nplain text\n")).toThrow(/line 3/);
    expect(() => parseChangelog("### en\n")).toThrow(/line 1/);
    expect(() => parseChangelog("## 0.1.0-gamma\n")).toThrow(/line 1.*not a version/);
    expect(() => parseChangelog("## a-0.1.0\n")).toThrow(/line 1.*not a version/);
    // A change that only looks like a version is still a change.
    expect(parseChangelog("## 1.0.0\n### en\n- v0.1.0\n- 0.2.0\n")[0]?.items.en).toEqual(["v0.1.0", "0.2.0"]);
  });
});

describe("compareVersions", () => {
  it("compares the numbers, not the text", () => {
    expect(compareVersions("0.0.20", "0.0.19")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.2.0")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.0.99")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("puts a stage before the release itself, and compares the numbers first", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("0.6.0-beta", "0.5.0-alpha")).toBeGreaterThan(0);
    expect(compareVersions("0.0.23-dev", "0.0.22-dev")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0-alpha", "0.1.0-alpha")).toBe(0);
  });
});

describe("stages", () => {
  it("reads the stage from the version, and shows it as a word", () => {
    expect(stageOf("0.0.23-dev")).toBe("dev");
    expect(stageOf("0.2.0-alpha")).toBe("alpha");
    expect(stageOf("0.6.0-beta")).toBe("beta");
    expect(stageOf("1.0.0")).toBe("stable");
    expect(versionLabel("0.1.0-alpha")).toBe("0.1.0 alpha");
    expect(versionLabel("1.0.0")).toBe("1.0.0");
  });
});

describe("shownEntries", () => {
  const entries = parseChangelog(SAMPLE);
  it("hides versions newer than the app and puts the newest first", () => {
    expect(shownEntries(entries, "1.2.0").map((e) => e.version)).toEqual(["1.2.0"]);
    expect(shownEntries(entries, "1.10.0").map((e) => e.version)).toEqual(["1.10.0", "1.2.0"]);
    expect(shownEntries(entries, "1.0.0")).toEqual([]);
  });

  it("shows only the entries of the app's own stage", () => {
    const staged = parseChangelog(
      ["0.0.22-dev", "0.0.23-dev", "0.1.0-alpha", "0.2.0-alpha", "0.6.0-beta"]
        .map((v) => `## ${v}\n### en\n- ${v}\n### it\n- ${v}\n`)
        .join(""),
    );
    const shown = (app: string) => shownEntries(staged, app).map((e) => e.version);
    expect(shown("0.0.23-dev")).toEqual(["0.0.23-dev", "0.0.22-dev"]);
    expect(shown("0.2.0-alpha")).toEqual(["0.2.0-alpha", "0.1.0-alpha"]);
    expect(shown("0.1.0-alpha")).toEqual(["0.1.0-alpha"]);
    expect(shown("0.6.0-beta")).toEqual(["0.6.0-beta"]);
    expect(shown("1.0.0")).toEqual([]);
  });
});

describe("the bundled changelog", () => {
  it("has both languages for every version, newest first, each version once", () => {
    expect(CHANGELOG.map((e) => e.version)).toEqual(expect.arrayContaining(["0.0.19-dev", "0.0.20-dev"]));
    for (const entry of CHANGELOG) {
      expect(entry.items.en.length, `${entry.version} en`).toBeGreaterThan(0);
      expect(entry.items.it.length, `${entry.version} it`).toBeGreaterThan(0);
    }
    const versions = CHANGELOG.map((e) => e.version);
    expect(versions).toEqual([...versions].sort((a, b) => compareVersions(b, a)));
    expect(new Set(versions).size).toBe(versions.length);
  });
});
