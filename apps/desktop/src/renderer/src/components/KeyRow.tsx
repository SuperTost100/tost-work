import { useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import { type CourseKey, keyVendor } from "../../../shared/model";
import { UnconfinedNote, useAskUnconfined } from "./Unconfined";

const VENDOR = { openai: "OpenAI", anthropic: "Anthropic" } as const;

/**
 * The course API key: a box to paste it in, then whose it is and how it ends. Setup shows it as an option card,
 * Settings as an account row with Remove.
 */
export function KeyRow({
  api,
  variant,
  onConnected,
  onSaved,
  onRemoved,
}: {
  api: TostWorkApi;
  variant: "setup" | "settings";
  onConnected?: (ai: "key", connected: boolean) => void;
  onSaved?: () => void;
  onRemoved?: () => void;
}) {
  const t = useT();
  // undefined until the saved key has been looked up.
  const [info, setInfo] = useState<CourseKey | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = useRef(onConnected);
  connected.current = onConnected;
  const setup = variant === "setup";
  // An Anthropic key runs tasks on Claude Code, which has no sandbox on Windows: the same notice as Claude's own row.
  const askUnconfined = useAskUnconfined(api, api.claudeUnconfined);
  const unconfined = api.claudeUnconfined && info?.vendor === "anthropic";

  useEffect(() => {
    api.key.info().then(
      (saved) => {
        setInfo(saved);
        connected.current?.("key", saved !== null);
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [api]);

  const use = async () => {
    const key = draft.trim();
    // Checked here too, so the message speaks the interface's language.
    if (!keyVendor(key)) {
      setError(t("ai.key.invalid"));
      return;
    }
    if (keyVendor(key) === "anthropic" && !(await askUnconfined())) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.key.save(key);
      setInfo(saved);
      setDraft("");
      connected.current?.("key", true);
      onSaved?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.key.remove();
      setInfo(null);
      connected.current?.("key", false);
      onRemoved?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  let detail: React.ReactNode = setup ? t("ai.key.d") : t("settings.notConnected");
  if (info) {
    const saved = t("ai.key.saved", { vendor: VENDOR[info.vendor], last4: info.last4 });
    detail = info.untilClosed ? t("ai.key.untilClosed", { key: saved }) : saved;
  }

  return (
    <div className={setup ? (info ? "opt on wide" : "opt wide") : "acct"}>
      <span>
        <b>{t("ai.key")}</b>
        <span className={setup ? (info ? "d ok" : "d") : undefined}>
          {setup && info && <Icon name="check" />}
          {detail}
        </span>
        {info === null && (
          <span className="keybox">
            <input
              type="password"
              className="input grow"
              aria-label={t("ai.key.label")}
              placeholder="sk-…"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) void use();
              }}
            />
            <button type="button" className="btn" disabled={busy || !draft.trim()} onClick={() => void use()}>
              {t("ai.key.use")}
            </button>
          </span>
        )}
        {error && (
          <span className={setup ? "d err" : "err"} role="alert">
            {error}
          </span>
        )}
      </span>
      {info && !setup && (
        <button
          type="button"
          className="btn"
          aria-label={t("ai.key.removeLabel")}
          disabled={busy}
          onClick={() => void remove()}
        >
          {t("ai.key.remove")}
        </button>
      )}
      {unconfined && <UnconfinedNote />}
    </div>
  );
}
