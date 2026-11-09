import { type Language, type MessageKey, translate } from "../shared/i18n";
import type { AgentProvider } from "../shared/model";
import type { SandboxMissing, SandboxReadiness } from "../shared/sandbox";

/**
 * An error a person can read in the window. It carries a message key instead of a sentence, because the main process
 * doesn't know the app's language where it throws: whoever hands the error on (the IPC handlers, a task's saved
 * failure, a job's last run) says it in the language then. Its `message` is the English sentence, for logs and tests.
 */
export class UserError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly vars?: Record<string, string>,
  ) {
    super(translate("en", key, vars));
    this.name = "UserError";
  }

  /** The sentence in `lang`. */
  say(lang: Language): string {
    return translate(lang, this.key, this.vars);
  }
}

const MISSING_KEYS: Record<SandboxMissing, MessageKey> = {
  bwrap: "sandbox.missing.bwrap",
  socat: "sandbox.missing.socat",
  userns: "sandbox.missing.userns",
};

/** What the sandbox lacks, as a list in `lang`. */
const missingText = (lang: Language, missing: SandboxMissing[]) =>
  missing.map((m) => translate(lang, MISSING_KEYS[m])).join(", ");

/**
 * A task that can't start because its AI's sandbox can't on this Linux system. It carries what's missing, so the
 * window can show the commands that fix it, and says it in a plain sentence until then.
 */
export class SandboxNotReady extends UserError {
  constructor(
    readonly provider: AgentProvider,
    readonly readiness: SandboxReadiness,
  ) {
    super("error.sandboxNotReady", {
      ai: provider === "claude" ? "Claude" : "ChatGPT",
      missing: missingText("en", readiness.missing),
    });
    this.name = "SandboxNotReady";
  }

  override say(lang: Language): string {
    return translate(lang, this.key, { ...this.vars, missing: missingText(lang, this.readiness.missing) });
  }
}

/** The error's sentence in `lang`: a UserError is translated, any other error keeps its own message. */
export function userMessage(err: unknown, lang: Language): string {
  if (err instanceof UserError) return err.say(lang);
  return err instanceof Error ? err.message : String(err);
}
