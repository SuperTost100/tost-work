import { useT } from "@/lib/useT";

/** The placeholder for a section that isn't built yet. */
export function Soon({ section, showVersion = false }: { section: string; showVersion?: boolean }) {
  const t = useT();
  return (
    <div className="main">
      <div className="top" />
      <div className="scroll">
        <div className="col" style={{ paddingTop: 120 }}>
          <div className="hello">
            <h1>{t("soon.title", { section })}</h1>
          </div>
          <p className="t2" style={{ fontSize: 15 }}>
            {t("soon.body")}
          </p>
          {showVersion && (
            <p className="t3" style={{ fontSize: 13, marginTop: 24 }}>
              {t("about.version", { version: __APP_VERSION__, build: __APP_BUILD__ })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
