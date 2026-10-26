import { useCallback, useRef, useState } from "react";
import { Icon } from "@/lib/Icon";
import { useAccount } from "@/lib/useAccount";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { MessageKey } from "../../../shared/i18n";
import { type AiId, PROVIDER_OF } from "../../../shared/model";

/** The agent CLI behind each subscription, and how to install it until setup can do it with a button. */
const CLI: Record<AiId, { name: string; install: string }> = {
  chatgpt: { name: "Codex", install: "npm install -g @openai/codex" },
  claude: { name: "Claude Code", install: "npm install -g @anthropic-ai/claude-code" },
};

/**
 * One subscription: whether its CLI is there and signed in, the sign-in with its link and code, and in Settings the
 * sign-out. Setup shows it as an option card, Settings as an account row.
 */
export function AccountRow({
  api,
  ai,
  variant,
  onConnected,
  onSignedIn,
  onSignedOut,
}: {
  api: TostWorkApi;
  ai: AiId;
  variant: "setup" | "settings";
  onConnected?: (ai: AiId, connected: boolean) => void;
  onSignedIn?: (ai: AiId) => void;
  onSignedOut?: (ai: AiId) => void;
}) {
  const t = useT();
  // The hook re-checks when its callback changes, so it gets a stable one that reads the latest prop.
  const connectedRef = useRef(onConnected);
  connectedRef.current = onConnected;
  const connected = useCallback((c: boolean) => connectedRef.current?.(ai, c), [ai]);
  const { account, checking, signingIn, signingOut, link, codePrompt, error, check, signIn, sendCode, signOut } =
    useAccount(api, PROVIDER_OF[ai], {
      onConnected: connected,
      onSignedIn: () => onSignedIn?.(ai),
      onSignedOut: () => onSignedOut?.(ai),
    });
  const [code, setCode] = useState("");
  const setup = variant === "setup";
  const cli = CLI[ai];
  const name = t(`ai.${ai}.short` as MessageKey);

  let detail: React.ReactNode = setup ? t(`ai.${ai}.d` as MessageKey) : t("settings.notConnected");
  let action: React.ReactNode = null;
  let ok = false;
  if (checking) detail = t("ai.checking", { cli: cli.name });
  else if (account && !account.installed) {
    detail = (
      <>
        {t("ai.missing", { cli: cli.name })} <code className="cmd">{cli.install}</code>
      </>
    );
    action = (
      <button
        type="button"
        className="btn"
        aria-label={t("ai.checkAgainFor", { cli: cli.name })}
        onClick={() => void check()}
      >
        {t("ai.checkAgain")}
      </button>
    );
  } else if (account?.loggedIn) {
    ok = true;
    detail = account.account ? t("ai.connected", { account: account.account }) : t("ai.connectedPlain");
    if (!setup)
      action = (
        <button
          type="button"
          className="btn"
          aria-label={t("ai.signOutOf", { name })}
          disabled={signingOut}
          onClick={() => void signOut()}
        >
          {t("settings.signOut")}
        </button>
      );
  } else if (signingIn) {
    detail = (
      <>
        {t("ai.waiting")}{" "}
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="link">
            {t("ai.openLink")}
          </a>
        )}
      </>
    );
  } else if (account) {
    action = (
      <button
        type="button"
        className={setup ? "btn dark" : "btn"}
        aria-label={t("ai.signInTo", { name })}
        onClick={() => void signIn()}
      >
        {t("ai.signIn")}
      </button>
    );
  }

  const body = (
    <span>
      <b>{t(`ai.${ai}` as MessageKey)}</b>
      <span className={setup ? (ok ? "d ok" : "d") : undefined}>
        {setup && ok && <Icon name="check" />}
        {detail}
      </span>
      {codePrompt && (
        <span className="keybox">
          <input
            className="input grow"
            aria-label={t("ai.code")}
            placeholder={codePrompt}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="button" className="btn" disabled={!code.trim()} onClick={() => sendCode(code.trim())}>
            {t("ai.sendCode")}
          </button>
        </span>
      )}
      {error && (
        <span className={setup ? "d err" : "err"} role="alert">
          {error}
        </span>
      )}
    </span>
  );
  return (
    <div className={setup ? (ok ? "opt on" : "opt") : "acct"}>
      {body}
      {action}
    </div>
  );
}
