import { createContext, useContext } from "react";
import { type Language, type MessageKey, translate } from "./i18n";

export const LanguageContext = createContext<Language>("en");

export function useT() {
  const lang = useContext(LanguageContext);
  return (key: MessageKey, vars?: Record<string, string>) => translate(lang, key, vars);
}
