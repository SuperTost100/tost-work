import { marked } from "marked";
import privacyEn from "../../../../../../legal/privacy.en.md?raw";
import privacyIt from "../../../../../../legal/privacy.it.md?raw";
import termsEn from "../../../../../../legal/terms.en.md?raw";
import termsIt from "../../../../../../legal/terms.it.md?raw";
import type { Language } from "../../../shared/i18n";

export type LegalDoc = "terms" | "privacy";

/** The terms and the privacy notice live in `legal/` at the repository's root, so GitHub shows the same text. */
export const LEGAL_SOURCES: Record<LegalDoc, Record<Language, string>> = {
  terms: { en: termsEn, it: termsIt },
  privacy: { en: privacyEn, it: privacyIt },
};

/**
 * One document as HTML. The text is ours and ships with the app, so it needs no sanitizing. Its links get
 * `target="_blank"`, because the window only hands https links to the browser through window.open: a plain link
 * would load the page inside the app.
 */
export function legalHtml(doc: LegalDoc, lang: Language): string {
  const html = marked.parse(LEGAL_SOURCES[doc][lang], { async: false, gfm: true }) as string;
  return html.replace(/<a href="/g, '<a target="_blank" rel="noreferrer" href="');
}
