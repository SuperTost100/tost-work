import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { languageFrom } from "../../shared/i18n";
import { App } from "./App";
import { LanguageContext } from "./lib/useT";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
const lang = languageFrom(navigator.language);
document.documentElement.lang = lang;

createRoot(root).render(
  <StrictMode>
    <LanguageContext.Provider value={lang}>
      <App />
    </LanguageContext.Provider>
  </StrictMode>,
);
