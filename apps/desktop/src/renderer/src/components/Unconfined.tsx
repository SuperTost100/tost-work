import { useCallback, useRef } from "react";
import { Icon } from "@/lib/Icon";
import { useConfirm } from "@/lib/useConfirm";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { AgentProvider } from "../../../shared/model";
import type { ModelPick } from "../../../shared/modelChoice";

/**
 * The note inside a row whose AI runs Claude Code on Windows, where Claude has no sandbox. It spans the row under the
 * text and the button, as a row's grid allows.
 */
export function UnconfinedNote() {
  const t = useT();
  return (
    <span className="unconfined" role="note">
      <Icon name="alert" className="unconfined-ic" />
      <span>{t("unconfined.note")}</span>
    </span>
  );
}

/**
 * The card that says Claude isn't limited to the task's folder on Windows, before the user connects it. Resolves true
 * to go ahead and false on Cancel. When `active` is false, off Windows or for an AI that isn't Claude, it resolves true
 * without asking. Continue is saved, so no task asks again (see `useClaudeGate`).
 *
 * It asks once per row: after Continue the row's next button (Install, then Sign in) goes straight on, and Cancel
 * leaves the next press asking again. The row is new each time its screen opens, so a user who comes back to connect
 * Claude later sees the card again.
 */
export function useAskUnconfined(api: TostWorkApi, active: boolean): () => Promise<boolean> {
  const ask = useUnconfinedCard(api);
  const agreed = useRef(false);
  return useCallback(async () => {
    if (!active || agreed.current) return true;
    const yes = await ask();
    if (yes) agreed.current = true;
    return yes;
  }, [active, ask]);
}

/** Shows the card, and saves Continue in the settings. Resolves true on Continue. */
function useUnconfinedCard(api: TostWorkApi | undefined): () => Promise<boolean> {
  const t = useT();
  const confirm = useConfirm();
  return useCallback(async () => {
    const yes = await confirm({
      message: t("unconfined.title"),
      detail: [t("unconfined.p1"), t("unconfined.p2")],
      yes: t("unconfined.go"),
    });
    if (yes) await api?.settings.update({ unconfinedAcknowledged: true });
    return yes;
  }, [api, confirm, t]);
}

/**
 * A run about to start: on an existing task, or on a new one with what it runs on. A pick left out is the one in the
 * settings, as the main process does for a task.
 */
export type RunOn = { taskId: string } | { pick?: ModelPick };

/** The AI a run will use, as the main process will choose it. */
async function providerOf(api: TostWorkApi, on: RunOn, saved: ModelPick): Promise<AgentProvider> {
  if ("taskId" in on) return (await api.tasks.get(on.taskId))?.provider ?? "codex";
  const pick = on.pick ?? saved;
  if ("ai" in pick && pick.ai !== "key") return pick.ai === "claude" ? "claude" : "codex";
  // A preset runs on the default AI, and the course key on its vendor's: the main process knows both.
  const choices = await api.models.choices();
  const ai = "ai" in pick ? pick.ai : choices.ai;
  return choices.lists.find((l) => l.ai === ai)?.provider ?? choices.provider;
}

/** Runs `run`, after the notice when it's needed; null when the user pressed Cancel and nothing ran. */
export type ClaudeGate = <T>(on: RunOn, run: () => Promise<T>) => Promise<T | null>;

/**
 * Asks before a run starts on Claude where it has no sandbox, until the user has pressed Continue once: a user who was
 * connected before (a sign-in or an Anthropic key from earlier) hasn't seen the card in setup. On Cancel nothing runs
 * and the caller leaves everything as it was. Off Windows, and once the user has said yes, `run` is called straight
 * away, as if there were no gate.
 */
export function useClaudeGate(api: TostWorkApi | undefined): ClaudeGate {
  const ask = useUnconfinedCard(api);
  const known = useRef(false);
  return useCallback<ClaudeGate>(
    (on, run) => {
      if (!api?.claudeUnconfined || known.current) return run();
      return (async () => {
        const settings = await api.settings.get();
        known.current = settings.unconfinedAcknowledged;
        if (!known.current && (await providerOf(api, on, settings.modelPick)) === "claude") {
          known.current = await ask();
          if (!known.current) return null;
        }
        return run();
      })();
    },
    [api, ask],
  );
}
