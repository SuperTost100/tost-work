import { useCallback, useEffect, useRef, useState } from "react";
import { Sprigs } from "@/components/Sprigs";
import { Icon } from "@/lib/Icon";
import { Logo } from "@/lib/Logo";
import { useT } from "@/lib/useT";
import type { CodexAccount, TostWorkApi } from "../../../shared/api";
import type { MessageKey } from "../../../shared/i18n";
import type { Level, Settings } from "../../../shared/model";

const TOTAL = 4;
const LEVELS: Level[] = ["beginner", "intermediate", "advanced", "expert"];
const CODEX_INSTALL = "npm install -g @openai/codex";
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "";

/** The ChatGPT option: whether Codex is there and signed in, and the sign-in itself. */
function Connect({ api, onConnected }: { api: TostWorkApi; onConnected: (connected: boolean) => void }) {
  const t = useT();
  const [account, setAccount] = useState<CodexAccount | null>(null);
  const [checking, setChecking] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [codePrompt, setCodePrompt] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const status = await api.account.status();
      setAccount(status);
      onConnected(status.loggedIn);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, [api, onConnected]);

  // Leaving the step (Back, Skip) ends a sign-in still open, so the next one can start.
  useEffect(() => () => void api.account.cancel(), [api]);

  useEffect(() => {
    void check();
    return api.account.onSignIn((event) => {
      if (event.type === "link") setLink(event.url);
      else if (event.type === "code") setCodePrompt(event.message);
      else if (event.type === "error") {
        setError(event.message);
        setSigningIn(false);
      } else {
        setAccount(event.account);
        onConnected(event.account.loggedIn);
        setSigningIn(false);
        setCodePrompt(null);
      }
    });
  }, [api, check, onConnected]);

  const signIn = async () => {
    setError(null);
    setLink(null);
    setSigningIn(true);
    try {
      await api.account.signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSigningIn(false);
    }
  };

  let detail: React.ReactNode = <span className="d">{t("ai.chatgpt.d")}</span>;
  let action: React.ReactNode = null;
  if (checking) detail = <span className="d">{t("ai.checking")}</span>;
  else if (account && !account.installed) {
    detail = (
      <span className="d">
        {t("ai.missing")}
        <code className="cmd">{CODEX_INSTALL}</code>
      </span>
    );
    action = (
      <button type="button" className="btn" onClick={() => void check()}>
        {t("ai.checkAgain")}
      </button>
    );
  } else if (account?.loggedIn) {
    detail = (
      <span className="d ok">
        <Icon name="check" />
        {account.account ? t("ai.connected", { account: account.account }) : t("ai.connectedPlain")}
      </span>
    );
  } else if (signingIn) {
    detail = (
      <span className="d">
        {t("ai.waiting")}
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="link">
            {t("ai.openLink")}
          </a>
        )}
      </span>
    );
  } else if (account) {
    action = (
      <button type="button" className="btn dark" onClick={() => void signIn()}>
        {t("ai.signIn")}
      </button>
    );
  }

  return (
    <div className="opts">
      <div className={account?.loggedIn ? "opt on" : "opt"}>
        <span>
          <b>{t("ai.chatgpt")}</b>
          {detail}
          {codePrompt && (
            <span className="keybox">
              <input
                className="input grow"
                aria-label={t("ai.code")}
                placeholder={codePrompt}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                disabled={!code.trim()}
                onClick={() => void api.account.sendCode(code.trim()).catch((e: Error) => setError(e.message))}
              >
                {t("ai.sendCode")}
              </button>
            </span>
          )}
          {error && (
            <span className="d err" role="alert">
              {error}
            </span>
          )}
        </span>
        {action}
      </div>
      {(["claude", "key"] as const).map((k) => (
        <div className="opt off" key={k} aria-disabled="true">
          <span>
            <b>{t(`ai.${k}` as MessageKey)}</b>
            <span className="d">{t(`ai.${k}.d` as MessageKey)}</span>
          </span>
          <span className="t3 soon">{t("ai.later")}</span>
        </div>
      ))}
    </div>
  );
}

/** First-run setup: name, level, an AI account and a first project. Each step is saved as soon as it's done. */
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
  const [name, setName] = useState(settings.name);
  const [connected, setConnected] = useState(false);
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
    ["setup.level.title", "setup.level.sub"],
    ["setup.ai.title", "setup.ai.sub"],
    ["setup.project.title", "setup.project.sub"],
  ];
  const [title, sub] = titles[step] ?? ["setup.name.title", "setup.name.sub"];

  return (
    <div className="main">
      <div className="solo">
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
          <h1>
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

          {step === 2 && (
            <>
              <p className="lede">{t("setup.ai.lede")}</p>
              <Connect api={api} onConnected={setConnected} />
            </>
          )}

          {step === 3 && (
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
              <button type="button" className="btn dark" disabled={busy} onClick={() => void go(2)}>
                {t("setup.next")}
              </button>
            )}
            {step === 2 && (
              <>
                <span className="t3" style={{ fontSize: 13 }}>
                  {t("setup.next.project")}
                </span>
                <button
                  type="button"
                  className={connected ? "btn dark" : "btn"}
                  disabled={busy}
                  onClick={() => void go(3)}
                >
                  {connected ? t("setup.next") : t("setup.skip")}
                </button>
              </>
            )}
            {step === 3 && (
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
    </div>
  );
}
