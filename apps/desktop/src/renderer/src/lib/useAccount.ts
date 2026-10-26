import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAccount, TostWorkApi } from "../../../shared/api";
import type { AgentProvider } from "../../../shared/model";
import { errorText } from "./errorText";

/**
 * A subscription through its agent CLI (ChatGPT through Codex, Claude through Claude Code): its state, the sign-in
 * with its link and code, and the sign-out. `onConnected` hears every state it learns, `onSignedIn` and `onSignedOut`
 * only the user's own sign-in and sign-out.
 */
export function useAccount(
  api: TostWorkApi,
  provider: AgentProvider,
  {
    onConnected,
    onSignedIn,
    onSignedOut,
  }: { onConnected?: (connected: boolean) => void; onSignedIn?: () => void; onSignedOut?: () => void } = {},
) {
  const [account, setAccount] = useState<AgentAccount | null>(null);
  const [checking, setChecking] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [codePrompt, setCodePrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept in a ref so a new callback each render doesn't resubscribe to the sign-in events.
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const status = await api.account.status(provider);
      setAccount(status);
      onConnected?.(status.loggedIn);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  }, [api, provider, onConnected]);

  // Leaving the screen ends a sign-in still open, so the next one can start.
  useEffect(() => () => void api.account.cancel(provider), [api, provider]);

  useEffect(() => {
    void check();
    return api.account.onSignIn((from, event) => {
      if (from !== provider) return;
      if (event.type === "link") setLink(event.url);
      else if (event.type === "code") setCodePrompt(event.message);
      else if (event.type === "error") {
        setError(event.message);
        setSigningIn(false);
      } else {
        setAccount(event.account);
        onConnected?.(event.account.loggedIn);
        if (event.account.loggedIn) signedIn.current?.();
        setSigningIn(false);
        setCodePrompt(null);
      }
    });
  }, [api, provider, check, onConnected]);

  const signIn = async () => {
    setError(null);
    setLink(null);
    setSigningIn(true);
    try {
      await api.account.signIn(provider);
    } catch (err) {
      setError(errorText(err));
      setSigningIn(false);
    }
  };

  const sendCode = (code: string) =>
    void api.account.sendCode(provider, code).catch((err: unknown) => setError(errorText(err)));

  const signOut = async () => {
    setError(null);
    setSigningOut(true);
    try {
      const status = await api.account.signOut(provider);
      setAccount(status);
      if (!status.loggedIn) onSignedOut?.();
      setLink(null);
      setCodePrompt(null);
      setSigningIn(false);
      onConnected?.(status.loggedIn);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSigningOut(false);
    }
  };

  return { account, checking, signingIn, signingOut, link, codePrompt, error, check, signIn, sendCode, signOut };
}
