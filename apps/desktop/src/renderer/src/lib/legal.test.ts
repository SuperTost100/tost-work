import { describe, expect, it } from "vitest";
import { LEGAL_SOURCES, legalHtml } from "@/lib/legal";

const headings = (text: string) => text.split("\n").filter((line) => /^#{1,2} /.test(line)).length;

describe("legal documents", () => {
  it("has the same sections in Italian and English, so a translation can't drop one", () => {
    for (const doc of ["terms", "privacy"] as const) {
      const { en, it: italian } = LEGAL_SOURCES[doc];
      expect(headings(en)).toBeGreaterThan(5);
      expect(headings(italian)).toBe(headings(en));
    }
  });

  it("dates both versions the same day", () => {
    for (const doc of ["terms", "privacy"] as const) {
      const day = (text: string) => /(\d{1,2}) \S+ (\d{4})/.exec(text)?.slice(1).join("-");
      expect(day(LEGAL_SOURCES[doc].it)).toBe(day(LEGAL_SOURCES[doc].en));
    }
  });

  it("opens every link in the browser", () => {
    const html = legalHtml("privacy", "en");
    const links = html.match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain('target="_blank"');
  });
});
