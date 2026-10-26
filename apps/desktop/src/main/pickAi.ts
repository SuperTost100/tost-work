import { type AgentProvider, type AiId, PROVIDER_OF } from "../shared/model";

/**
 * The account a new task runs on: the chosen one unless it's known to be signed out (or, for the course key, gone),
 * otherwise the first one known to be signed in, then the key. A check that fails (null) proves nothing, so it never
 * moves a task off the chosen account. With nothing usable, the chosen one, so the task fails with that account's own
 * message: sign in, or paste the key again.
 */
export async function pickAi(
  chosen: AiId | null,
  signedIn: (provider: AgentProvider) => Promise<boolean | null>,
  hasKey = false,
): Promise<AiId> {
  if (chosen === "key") {
    if (hasKey) return "key";
  } else if (chosen && (await signedIn(PROVIDER_OF[chosen])) !== false) return chosen;
  if ((await signedIn("codex")) === true) return "chatgpt";
  if ((await signedIn("claude")) === true) return "claude";
  if (hasKey) return "key";
  return chosen ?? "chatgpt";
}
