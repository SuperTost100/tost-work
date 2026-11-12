import { useCallback, useEffect, useRef, useState } from "react";
import { AccountRow } from "@/components/AccountRow";
import { AiSends } from "@/components/AiSends";
import { KeyRow } from "@/components/KeyRow";
import { SetupSandboxNotice } from "@/components/SandboxNotice";
import { Sprigs } from "@/components/Sprigs";
import { Switch } from "@/components/Switch";
import { errorText } from "@/lib/errorText";
import { Logo } from "@/lib/Logo";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { MessageKey } from "../../../shared/i18n";
import { type AiId, type Level, NOTES_MAX, type Settings, SUBSCRIPTIONS, sectionOn } from "../../../shared/model";
import { NotesLimit } from "./Profile";

const TOTAL = 6;
const LEVELS: Level[] = ["beginner", "intermediate", "advanced", "expert"];
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "";

/** The ways to connect an AI: the two subscriptions and the course key, under the sandbox notice when Linux needs one. */
function Connect({
  api,
  onConnected,
  onSignedIn,
}: {
  api: TostWorkApi;
  onConnected: (ai: AiId, connected: boolean) => void;
  onSignedIn: (ai: AiId) => void;
}) {
  return (
    <>
      <SetupSandboxNotice api={api} />
      <div className="opts">
        {SUBSCRIPTIONS.map((ai) => (
          <AccountRow key={ai} api={api} ai={ai} variant="setup" onConnected={onConnected} onSignedIn={onSignedIn} />
        ))}
        <KeyRow api={api} variant="setup" onConnected={onConnected} onSaved={() => onSignedIn("key")} />
      </div>
    </>
  );
}

/** First-run setup: name, a few words about the user, level, an AI account and a first project. Each step is saved as soon as it's done. */
export function Setup({
  api,
  settings,
  onChange,
}: {
  api: TostWorkApi;
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);
  // Each step starts at the top, where its title is, even when the step before was scrolled in a short window. After a
  // step change the title takes the focus, so the next Tab goes through the new step's fields; the first step is left
  // as the app opens it.
  const page = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // The step the page last showed, so only a real change moves the focus, also when React runs the effect twice.
  const shown = useRef(step);
  useEffect(() => {
    page.current?.scrollTo?.(0, 0);
    if (shown.current !== step) heading.current?.focus();
    shown.current = step;
  }, [step]);
  const [name, setName] = useState(settings.name);
  const [work, setWork] = useState(settings.work);
  const [notes, setNotes] = useState(settings.notes);
  const aboutFilled = Boolean(work.trim() || notes.trim());
  const [connected, setConnected] = useState<Partial<Record<AiId, boolean>>>({});
  const anyConnected = Object.values(connected).some(Boolean);
  const onConnected = useCallback((ai: AiId, c: boolean) => setConnected((prev) => ({ ...prev, [ai]: c })), []);
  const [folder, setFolder] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<Settings>) => onChange(await api.settings.update(patch));
  const go = async (next: number, patch?: Partial<Settings>) => {
    setError(null);
    setBusy(true);
    try {
      if (patch) await save(patch);
      setStep(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  // The project made by an earlier try, so a retry after a failed save doesn't make it again.
  const created = useRef<{ name: string; folder: string } | null>(null);
  const finish = async (withProject: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const name = projectName.trim();
      const already = created.current?.folder === folder && created.current?.name === name;
      if (withProject && folder && !already) {
        await api.projects.create({ name, folder });
        created.current = { name, folder };
      }
      await save({ setupDone: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  const chooseFolder = async () => {
    const picked = await api.projects.pickFolder();
    if (!picked) return;
    setFolder(picked);
    if (!projectName.trim()) setProjectName(folderName(picked));
  };

  const titles: [MessageKey, MessageKey][] = [
    ["setup.name.title", "setup.name.sub"],
    ["setup.about.title", "setup.about.sub"],
    ["setup.level.title", "setup.level.sub"],
    ["setup.start.title", "setup.start.sub"],
    ["setup.ai.title", "setup.ai.sub"],
    ["setup.project.title", "setup.project.sub"],
  ];
  const [title, sub] = titles[step] ?? ["setup.name.title", "setup.name.sub"];

  return (
    <main className="main">
      <div className="solo" ref={page}>
        <div className="setup">
          <div className="brand2">
            <Logo size={28} />
            <b>Tost Work</b>
          </div>
          <div className="dots">
            {titles.map(([key], i) => (
              <i key={key} className={i <= step ? "on" : undefined} />
            ))}
            <span style={{ marginLeft: 6 }}>{t("setup.step", { n: String(step + 1), total: String(TOTAL) })}</span>
          </div>
          <h1 ref={heading} tabIndex={-1}>
            {t(title)}
            <br />
            <span>{t(sub)}</span>
          </h1>

          {step === 0 && (
            <>
              <label className="fld">
                <span>{t("setup.name.label")}</span>
                <input
                  className="input"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim()) void go(1, { name: name.trim() });
                  }}
                />
              </label>
              <label className="fld">
                <span>{t("setup.language")}</span>
                <select
                  className="input"
                  value={settings.language ?? ""}
                  onChange={(e) =>
                    void save({ language: (e.target.value || null) as Settings["language"] }).catch((err: Error) =>
                      setError(err.message),
                    )
                  }
                >
                  <option value="">{t("setup.languageSystem")}</option>
                  <option value="en">English</option>
                  <option value="it">Italiano</option>
                </select>
              </label>
            </>
          )}

          {step === 1 && (
            <>
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
                  rows={5}
                  placeholder={t("profile.notesHint")}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <NotesLimit length={notes.length} />
              </label>
              <p className="t3" style={{ fontSize: 13 }}>
                {t("setup.about.later")}
              </p>
            </>
          )}

          {step === 2 && (
            <fieldset className="opts">
              <legend className="sr">{t("setup.level.title")}</legend>
              {LEVELS.map((level) => (
                <label key={level} className={settings.level === level ? "opt on" : "opt"}>
                  <input
                    type="radio"
                    name="level"
                    value={level}
                    checked={settings.level === level}
                    onChange={() => void save({ level }).catch((e: Error) => setError(e.message))}
                  />
                  <span>
                    <b>{t(`level.${level}` as MessageKey)}</b>
                    <span className="d">{t(`level.${level}.d` as MessageKey)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {step === 3 && (
            <div className="sgroup">
              <div className="srow">
                <div className="lbl">
                  <b>{t("setup.start.notifications")}</b>
                  <span>{t("setup.start.notifications.d")}</span>
                </div>
                <Switch
                  label={t("setup.start.notifications")}
                  on={settings.notifications}
                  onChange={(notifications) => void save({ notifications }).catch((e: Error) => setError(e.message))}
                />
              </div>
              {/* Starting at login is for jobs, so it's asked only of levels that have them. */}
              {sectionOn(settings, "jobs") && (
                <div className="srow">
                  <div className="lbl">
                    <b>{t("settings.openAtLogin")}</b>
                    <span>{t("settings.openAtLogin.d")}</span>
                  </div>
                  <Switch
                    label={t("settings.openAtLogin")}
                    on={settings.openAtLogin}
                    onChange={(openAtLogin) => void save({ openAtLogin }).catch((e: Error) => setError(e.message))}
                  />
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <>
              <p className="lede">{t("setup.ai.lede")}</p>
              <AiSends />
              <Connect
                api={api}
                onConnected={onConnected}
                // The account signed in last runs new tasks.
                onSignedIn={(ai) => void save({ defaultAi: ai }).catch((err: unknown) => setError(errorText(err)))}
              />
            </>
          )}

          {step === 5 && (
            <>
              <p className="lede">{t("setup.project.lede")}</p>
              <fieldset className="fld">
                <legend>{t("dialog.folder")}</legend>
                <span className="row">
                  <span className={folder ? "fld-path" : "fld-path t3"}>{folder ?? t("dialog.noFolder")}</span>
                  <button type="button" className="btn" onClick={() => void chooseFolder()}>
                    {t("dialog.chooseFolder")}
                  </button>
                </span>
              </fieldset>
              {folder && (
                <label className="fld">
                  <span>{t("dialog.name")}</span>
                  <input className="input" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                </label>
              )}
            </>
          )}

          {error && (
            <p className="fld-error" role="alert">
              {error}
            </p>
          )}

          <div className="row">
            {step > 0 && (
              <button type="button" className="btn" disabled={busy} onClick={() => setStep(step - 1)}>
                {t("setup.back")}
              </button>
            )}
            <span className="grow" />
            {step === 0 && (
              <button
                type="button"
                className="btn dark"
                disabled={busy || !name.trim()}
                onClick={() => void go(1, { name: name.trim() })}
              >
                {t("setup.next")}
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                className={aboutFilled ? "btn dark" : "btn"}
                disabled={busy}
                onClick={() => void go(2, { work: work.trim(), notes: notes.trim() })}
              >
                {aboutFilled ? t("setup.next") : t("setup.skip")}
              </button>
            )}
            {step === 2 && (
              <button type="button" className="btn dark" disabled={busy} onClick={() => void go(3)}>
                {t("setup.next")}
              </button>
            )}
            {step === 3 && (
              <button type="button" className="btn dark" disabled={busy} onClick={() => void go(4)}>
                {t("setup.next")}
              </button>
            )}
            {step === 4 && (
              <>
                <span className="t3" style={{ fontSize: 13 }}>
                  {t("setup.next.project")}
                </span>
                <button
                  type="button"
                  className={anyConnected ? "btn dark" : "btn"}
                  disabled={busy}
                  onClick={() => void go(5)}
                >
                  {anyConnected ? t("setup.next") : t("setup.skip")}
                </button>
              </>
            )}
            {step === 5 && (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => void finish(false)}>
                  {t("setup.skip")}
                </button>
                <button
                  type="button"
                  className="btn dark"
                  disabled={busy || !folder || !projectName.trim()}
                  onClick={() => void finish(true)}
                >
                  {t("setup.finish")}
                </button>
              </>
            )}
          </div>
        </div>
        <Sprigs />
      </div>
    </main>
  );
}
