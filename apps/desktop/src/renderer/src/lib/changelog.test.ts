import { describe, expect, it } from "vitest";
import { CHANGELOG, compareVersions, parseChangelog, shownEntries } from "./changelog";

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
  });
});

describe("compareVersions", () => {
  it("compares the numbers, not the text", () => {
    expect(compareVersions("0.0.20", "0.0.19")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.2.0")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.0.99")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

describe("shownEntries", () => {
  const entries = parseChangelog(SAMPLE);
  it("hides versions newer than the app and puts the newest first", () => {
    expect(shownEntries(entries, "1.2.0").map((e) => e.version)).toEqual(["1.2.0"]);
    expect(shownEntries(entries, "1.10.0").map((e) => e.version)).toEqual(["1.10.0", "1.2.0"]);
    expect(shownEntries(entries, "1.0.0")).toEqual([]);
  });
});

describe("the bundled changelog", () => {
  it("has both languages for every version, newest first, each version once", () => {
    expect(CHANGELOG.map((e) => e.version)).toEqual(expect.arrayContaining(["0.0.19", "0.0.20"]));
    for (const entry of CHANGELOG) {
      expect(entry.items.en.length, `${entry.version} en`).toBeGreaterThan(0);
      expect(entry.items.it.length, `${entry.version} it`).toBeGreaterThan(0);
    }
    const versions = CHANGELOG.map((e) => e.version);
    expect(versions).toEqual([...versions].sort((a, b) => compareVersions(b, a)));
    expect(new Set(versions).size).toBe(versions.length);
  });
});
