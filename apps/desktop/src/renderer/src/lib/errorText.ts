import type { MessageKey } from "../../../shared/i18n";

/**
 * An error as a sentence for the user. Errors thrown in the main process reach the window wrapped as "Error invoking
 * remote method 'files:read': Error: …"; only the last part is meant for people. With `t`, a file the system couldn't
 * find is said in the app's language, with its name, instead of Node's "ENOENT: no such file or directory".
 */
export function errorText(err: unknown, t?: (key: MessageKey, vars?: Record<string, string>) => string): string {
  const text = err instanceof Error ? err.message : String(err);
  // The path runs to the last quote, since a name can hold an apostrophe. A copy's message names two paths, and either
  // can be the missing one, so it isn't guessed at.
  const missing = text.match(/ENOENT: no such file or directory, \w+ '((?:(?!' -> ')[\s\S])*)'$/);
  if (missing && t) return t("error.missing", { name: missing[1]?.split(/[\\/]/).pop() ?? "" });
  return text.replace(/^Error invoking remote method '[^']*': /, "").replace(/^(\w*Error): /, "");
}
