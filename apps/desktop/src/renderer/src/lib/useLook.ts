import { useEffect } from "react";
import type { Language } from "../../../shared/i18n";
import type { Settings } from "../../../shared/model";

/**
 * Puts the language and the theme on the page. The theme goes on as an attribute, because on Linux Electron's theme
 * choice doesn't reach the colour-scheme media query. "Same as system" follows the system as it changes.
 */
export function useLook(lang: Language, theme: Settings["theme"] | undefined): void {
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (!theme) return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (media?.matches ? "dark" : "light") : theme;
    };
    apply();
    media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [theme]);
}
