import { useEffect, useState } from "react";
import { App } from "@/App";
import { LanguageContext } from "@/lib/useT";
import { Setup } from "@/screens/Setup";
import type { TostWorkApi } from "../../shared/api";
import { languageFrom, translate } from "../../shared/i18n";
import type { Settings } from "../../shared/model";

/** Loads the settings, sets the language from them, and shows setup until it's done. */
export function Root({ api = window.tostWork }: { api?: TostWorkApi }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lang = settings?.language ?? languageFrom(navigator.language);

  useEffect(() => {
    api?.settings.get().then(setSettings, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [api]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  let screen: React.ReactNode;
  if (!api) screen = <App api={api} />;
  else if (error)
    screen = (
      <div className="main">
        <div className="solo">
          <p role="alert">{translate(lang, "setup.failed", { error })}</p>
        </div>
      </div>
    );
  else if (!settings) screen = <div className="main" />;
  else if (!settings.setupDone) screen = <Setup api={api} settings={settings} onChange={setSettings} />;
  else screen = <App api={api} userName={settings.name} />;

  return (
    <LanguageContext.Provider value={lang}>
      {settings?.setupDone || !api ? screen : <div className="app">{screen}</div>}
    </LanguageContext.Provider>
  );
}
