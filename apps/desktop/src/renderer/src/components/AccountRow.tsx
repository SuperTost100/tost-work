import { useCallback, useRef, useState } from "react";
import { Icon } from "@/lib/Icon";
import { Spinner } from "@/lib/Spinner";
import { useAccount } from "@/lib/useAccount";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { MessageKey } from "../../../shared/i18n";
import { installLine } from "../../../shared/install";
import { PROVIDER_OF, type Subscription } from "../../../shared/model";
import { UnconfinedNote, useAskUnconfined } from "./Unconfined";

/** The agent CLI behind each subscription. */
const CLI: Record<Subscription, string> = { chatgpt: "Codex", claude: "Claude Code" };
const INSTALL_FAILED: Record<"offline" | "space" | "failed", MessageKey> = {
  offline: "ai.install.offline",
  space: "ai.install.space",
  failed: "ai.install.failed",
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
  ai: Subscription;
  variant: "setup" | "settings";
  onConnected?: (ai: Subscription, connected: boolean) => void;
  onSignedIn?: (ai: Subscription) => void;
  onSignedOut?: (ai: Subscription) => void;
}) {
  const t = useT();
  // The hook re-checks when its callback changes, so it gets a stable one that reads the latest prop.
  const connectedRef = useRef(onConnected);
  connectedRef.current = onConnected;
  const connected = useCallback((c: boolean) => connectedRef.current?.(ai, c), [ai]);
  const provider = PROVIDER_OF[ai];
  const {
    account,
    checking,
    signingIn,
    signingOut,
    installing,
    installFailed,
    link,
    codePrompt,
    error,
    check,
    signIn,
    sendCode,
    signOut,
    install,
  } = useAccount(api, provider, {
    onConnected: connected,
    onSignedIn: () => onSignedIn?.(ai),
    onSignedOut: () => onSignedOut?.(ai),
  });
  const [code, setCode] = useState("");
  // On Windows Claude runs without a sandbox, so the row says so and asks before Install and Sign in go ahead.
  const unconfined = ai === "claude" && api.claudeUnconfined;
  const askUnconfined = useAskUnconfined(unconfined);
  const goAhead = (run: () => Promise<void>) => () => void askUnconfined().then((yes) => (yes ? run() : undefined));
  const setup = variant === "setup";
  const cli = CLI[ai];
  const name = t(`ai.${ai}.short` as MessageKey);

  let detail: React.ReactNode = setup ? t(`ai.${ai}.d` as MessageKey) : t("settings.notConnected");
  let action: React.ReactNode = null;
  let ok = false;
  if (installing) {
    detail = t("ai.installing", { cli });
    // The button stays, so the row keeps its shape and the install can't be started twice.
    action = (
      <button type="button" className="btn busy" disabled aria-busy="true">
        <Spinner />
        {t("ai.installingShort")}
      </button>
    );
  } else if (checking) detail = t("ai.checking", { cli });
  else if (account && !account.installed) {
    detail = installFailed ? (
      <>
        {t(INSTALL_FAILED[installFailed.reason], { detail: installFailed.detail })} {t("ai.install.manual")}{" "}
        <code className="cmd">{installLine(provider, api.platform)}</code>
      </>
    ) : (
      t("ai.missing", { cli })
    );
    action = (
      <span className="row">
        {installFailed && (
          <button
            type="button"
            className="btn"
            aria-label={t("ai.checkAgainFor", { cli })}
            onClick={() => void check()}
          >
            {t("ai.checkAgain")}
          </button>
        )}
        <button type="button" className="btn" onClick={goAhead(install)}>
          {t("ai.install", { cli })}
        </button>
      </span>
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
      <button type="button" className="btn" aria-label={t("ai.signInTo", { name })} onClick={goAhead(signIn)}>
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
      {unconfined && <UnconfinedNote />}
    </div>
  );
}
