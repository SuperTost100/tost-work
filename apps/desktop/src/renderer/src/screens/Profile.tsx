import { useContext, useState } from "react";
import { errorText } from "@/lib/errorText";
import { LanguageContext, useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import { NOTES_MAX, type Settings } from "../../../shared/model";

/** Shown once the notes come close to their limit, so a long paste isn't cut without a word. */
export function NotesLimit({ length }: { length: number }) {
  const t = useT();
  // Numbers follow the app's language, which can differ from the system's.
  const lang = useContext(LanguageContext);
  if (length < NOTES_MAX * 0.9) return null;
  const n = (x: number) => x.toLocaleString(lang);
  return (
    <span className="t3" role="status" style={{ fontSize: 12.5 }}>
      {t("profile.notesLimit", { n: n(length), max: n(NOTES_MAX) })}
    </span>
  );
}

/** What the user tells the AI about themselves. Every task's instructions carry it. */
export function Profile({
  api,
  settings,
  onSaved,
}: {
  api?: TostWorkApi;
  settings: Settings;
  onSaved: (settings: Settings) => void;
}) {
  const t = useT();
  const [name, setName] = useState(settings.name);
  const [work, setWork] = useState(settings.work);
  const [notes, setNotes] = useState(settings.notes);
  const [status, setStatus] = useState<{ saved?: boolean; error?: string }>({});
  const [saving, setSaving] = useState(false);
  // Compared as they'll be saved, trimmed, so spaces alone don't count as a change.
  const changed = name.trim() !== settings.name || work.trim() !== settings.work || notes.trim() !== settings.notes;

  const save = async () => {
    if (!api || !name.trim()) return;
    setSaving(true);
    setStatus({});
    try {
      const sent = { name: name.trim(), work: work.trim(), notes: notes.trim() };
      const saved = await api.settings.update(sent);
      // A field shows what was stored, so the form reads as saved, unless the user typed in it while it saved.
      const keep = (stored: string, submitted: string) => (current: string) =>
        current.trim() === submitted ? stored : current;
      setName(keep(saved.name, sent.name));
      setWork(keep(saved.work, sent.work));
      setNotes(keep(saved.notes, sent.notes));
      onSaved(saved);
      setStatus({ saved: true });
    } catch (err) {
      setStatus({ error: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="main">
      <div className="top" />
      <div className="scroll">
        <form
          className="col profile"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="hello">
            <h1>{t("profile.title")}</h1>
          </div>
          <p className="t2">{t("profile.sub")}</p>
          <label className="fld">
            <span>{t("profile.name")}</span>
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="fld">
            <span>{t("profile.work")}</span>
            <input
              className="input"
              value={work}
              maxLength={300}
              placeholder={t("profile.workHint")}
              onChange={(e) => setWork(e.target.value)}
            />
          </label>
          <label className="fld">
            <span>{t("profile.notes")}</span>
            <textarea
              className="input area"
              value={notes}
              maxLength={NOTES_MAX}
              rows={7}
              placeholder={t("profile.notesHint")}
              onChange={(e) => setNotes(e.target.value)}
            />
            <NotesLimit length={notes.length} />
          </label>
          <div className="row">
            <span className="grow t3" role="status" style={{ fontSize: 13 }}>
              {status.error ?? (status.saved && !changed ? t("profile.saved") : "")}
            </span>
            <button type="submit" className="btn dark" disabled={saving || !changed || !name.trim()}>
              {t("profile.save")}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
