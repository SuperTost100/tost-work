import { type Language, type MessageKey, translate } from "../shared/i18n";

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
}

/** The error's sentence in `lang`: a UserError is translated, any other error keeps its own message. */
export function userMessage(err: unknown, lang: Language): string {
  if (err instanceof UserError) return translate(lang, err.key, err.vars);
  return err instanceof Error ? err.message : String(err);
}
