import { type AgentProvider, type AiId, PROVIDER_OF } from "../shared/model";

/**
 * The account a new task runs on: the chosen one unless it's known to be signed out, otherwise the first one known to
 * be signed in. A check that fails (null) proves nothing, so it never moves a task off the chosen account. With none
 * signed in, the chosen one, so the task fails with that agent's own "sign in" error.
 */
export async function pickAi(
  chosen: AiId | null,
  signedIn: (provider: AgentProvider) => Promise<boolean | null>,
): Promise<AiId> {
  if (chosen && (await signedIn(PROVIDER_OF[chosen])) !== false) return chosen;
  if ((await signedIn("codex")) === true) return "chatgpt";
  if ((await signedIn("claude")) === true) return "claude";
  return chosen ?? "chatgpt";
}
