/**
 * An error as a sentence for the user. Errors thrown in the main process reach the window wrapped as "Error invoking
 * remote method 'files:read': Error: …"; only the last part is meant for people.
 */
export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']*': /, "").replace(/^(\w*Error): /, "");
}
