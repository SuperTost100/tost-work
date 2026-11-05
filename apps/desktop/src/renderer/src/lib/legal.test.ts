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
    const months = {
      en: [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ],
      it: [
        "gennaio",
        "febbraio",
        "marzo",
        "aprile",
        "maggio",
        "giugno",
        "luglio",
        "agosto",
        "settembre",
        "ottobre",
        "novembre",
        "dicembre",
      ],
    };
    const date = (text: string, lang: "en" | "it") => {
      const match = /(\d{1,2}) (\p{L}+) (\d{4})/u.exec(text);
      const month = match ? months[lang].indexOf(match[2] ?? "") : -1;
      return match && month >= 0 ? `${match[3]}-${month + 1}-${match[1]}` : null;
    };
    for (const doc of ["terms", "privacy"] as const) {
      const it = date(LEGAL_SOURCES[doc].it, "it");
      expect(it).not.toBeNull();
      expect(date(LEGAL_SOURCES[doc].en, "en")).toBe(it);
    }
  });

  it("shows the contact address as text, since the window opens only https links", () => {
    for (const lang of ["en", "it"] as const) {
      const html = legalHtml("terms", lang);
      expect(html).toContain("tommaso.barbera@tost.one");
      expect(html).not.toContain("mailto:");
    }
  });

  it("opens every link in the browser", () => {
    const html = legalHtml("privacy", "en");
    const links = html.match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain('target="_blank"');
  });
});
