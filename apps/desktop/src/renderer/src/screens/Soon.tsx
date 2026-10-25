import { useT } from "@/lib/useT";

/** The placeholder for a section that isn't built yet. */
export function Soon({ section }: { section: string }) {
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
        </div>
      </div>
    </div>
  );
}
