import type { AuthStatus, Installation, LoginSession } from "cli-funnel";
import type { CodexAccount, SignInEvent } from "../shared/api";

/** The parts of cli-funnel the sign-in uses, so tests can stand in for the real Codex. */
export interface AccountSource {
  detect(): Promise<Installation>;
  authStatus(): Promise<AuthStatus>;
  login(): LoginSession;
  logout(): Promise<void>;
}

/** The ChatGPT sign-in through Codex. One sign-in at a time; its progress goes out through `emit`. */
export class Accounts {
  private session: LoginSession | null = null;

  constructor(
    private source: AccountSource,
    private emit: (event: SignInEvent) => void,
    /** Opens a page in the user's browser; rejects when the system can't. */
    private openUrl: (url: string) => Promise<void>,
  ) {}

  async status(): Promise<CodexAccount> {
    const install = await this.source.detect();
    if (!install.installed) return { installed: false, loggedIn: false };
    const auth = await this.source.authStatus();
    return {
      installed: true,
      version: install.version,
      loggedIn: auth.loggedIn,
      account: auth.account,
      plan: auth.plan,
    };
  }

  /** Starts the sign-in and returns at once. Resolves when the flow ends, for tests. */
  signIn(): Promise<void> {
    if (this.session) throw new Error("A sign-in is already open");
    const session = this.source.login();
    this.session = session;
    return this.follow(session);
  }

  sendCode(code: string): void {
    if (!this.session) throw new Error("No sign-in is waiting for a code");
    this.session.sendCode(code);
  }

  cancel(): void {
    this.session?.cancel();
    this.session = null;
  }

  /** Signs out of ChatGPT in Codex, ending any sign-in still open, and returns the new state. */
  async signOut(): Promise<CodexAccount> {
    this.cancel();
    await this.source.logout();
    return this.status();
  }

  private async follow(session: LoginSession): Promise<void> {
    // After a cancel, events already queued in the old session must not reach a newer sign-in.
    const current = () => this.session === session;
    const emit = (event: SignInEvent) => {
      if (current()) this.emit(event);
    };
    try {
      for await (const event of session) {
        if (!current()) break;
        if (event.type === "open-url") {
          // Only web pages: a sign-in link is never a file or another app's scheme.
          if (!event.url.startsWith("https://")) continue;
          // The link is shown either way, so the user can open it by hand if the browser didn't.
          emit({ type: "link", url: event.url });
          if (!event.opened)
            await this.openUrl(event.url).catch((err: unknown) =>
              emit({
                type: "error",
                message: `The browser didn't open: ${err instanceof Error ? err.message : String(err)}`,
              }),
            );
        } else if (event.type === "code-prompt") {
          emit({ type: "code", message: event.message });
        } else if (event.type === "needs-terminal") {
          emit({ type: "error", message: `Run this in a terminal: ${event.command.join(" ")}` });
        } else if (event.type === "done") {
          const account = await this.status();
          emit({ type: "done", account });
        } else if (event.type === "error") {
          emit({ type: "error", message: event.message });
        }
      }
    } catch (err) {
      emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (current()) this.session = null;
    }
  }
}
