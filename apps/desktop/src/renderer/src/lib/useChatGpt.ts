import { useCallback, useEffect, useState } from "react";
import type { CodexAccount, TostWorkApi } from "../../../shared/api";
import { errorText } from "./errorText";

/** The ChatGPT account through Codex: its state, the sign-in with its link and code, and the sign-out. */
export function useChatGpt(api: TostWorkApi, onConnected?: (connected: boolean) => void) {
  const [account, setAccount] = useState<CodexAccount | null>(null);
  const [checking, setChecking] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [codePrompt, setCodePrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const status = await api.account.status();
      setAccount(status);
      onConnected?.(status.loggedIn);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  }, [api, onConnected]);

  // Leaving the screen ends a sign-in still open, so the next one can start.
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
        onConnected?.(event.account.loggedIn);
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
      setError(errorText(err));
      setSigningIn(false);
    }
  };

  const sendCode = (code: string) => void api.account.sendCode(code).catch((err: unknown) => setError(errorText(err)));

  const signOut = async () => {
    setError(null);
    setSigningOut(true);
    try {
      const status = await api.account.signOut();
      setAccount(status);
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
