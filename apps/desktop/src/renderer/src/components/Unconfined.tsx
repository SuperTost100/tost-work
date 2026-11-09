import { useCallback, useRef } from "react";
import { Icon } from "@/lib/Icon";
import { useConfirm } from "@/lib/useConfirm";
import { useT } from "@/lib/useT";

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
 * without asking.
 *
 * It asks once per row: after Continue the row's next button (Install, then Sign in) goes straight on, and Cancel
 * leaves the next press asking again. The row is new each time its screen opens, so a user who comes back to connect
 * Claude later sees the card again.
 */
export function useAskUnconfined(active: boolean): () => Promise<boolean> {
  const t = useT();
  const confirm = useConfirm();
  const agreed = useRef(false);
  return useCallback(async () => {
    if (!active || agreed.current) return true;
    const yes = await confirm({
      message: t("unconfined.title"),
      detail: [t("unconfined.p1"), t("unconfined.p2")],
      yes: t("unconfined.go"),
    });
    if (yes) agreed.current = true;
    return yes;
  }, [active, confirm, t]);
}
