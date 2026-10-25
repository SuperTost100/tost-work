import type { AuthStatus, Installation, LoginSession } from "cli-funnel";
import type { CodexAccount, SignInEvent } from "../shared/api";

/** The parts of cli-funnel the sign-in uses, so tests can stand in for the real Codex. */
export interface AccountSource {
  detect(): Promise<Installation>;
  authStatus(): Promise<AuthStatus>;
  login(): LoginSession;
}

/** The ChatGPT sign-in through Codex. One sign-in at a time; its progress goes out through `emit`. */
export class Accounts {
  private session: LoginSession | null = null;

  constructor(
    private source: AccountSource,
    private emit: (event: SignInEvent) => void,
    private openUrl: (url: string) => void,
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

  private async follow(session: LoginSession): Promise<void> {
    try {
      for await (const event of session) {
        if (event.type === "open-url") {
          // Only web pages: a sign-in link is never a file or another app's scheme.
          if (!event.url.startsWith("https://")) continue;
          if (!event.opened) this.openUrl(event.url);
          this.emit({ type: "link", url: event.url });
        } else if (event.type === "code-prompt") {
          this.emit({ type: "code", message: event.message });
        } else if (event.type === "needs-terminal") {
          this.emit({ type: "error", message: `Run this in a terminal: ${event.command.join(" ")}` });
        } else if (event.type === "done") {
          this.emit({ type: "done", account: await this.status() });
        } else if (event.type === "error") {
          this.emit({ type: "error", message: event.message });
        }
      }
    } catch (err) {
      this.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (this.session === session) this.session = null;
    }
  }
}
