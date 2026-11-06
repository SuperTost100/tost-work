import { useState } from "react";
import { errorText } from "@/lib/errorText";
import type { useT } from "@/lib/useT";
import type { Approval, Decision } from "../../../shared/model";

const names = (paths: string[]) => paths.map((p) => p.split(/[\\/]/).pop() ?? p).join(", ");

/** The one line that says what the task wants to do, also used in the home's notices. */
export function approvalTitle(t: ReturnType<typeof useT>, approval: Approval): string {
  const key = approval.action === "delete" ? "approval.delete" : "approval.overwrite";
  return t(key, { names: names(approval.paths) });
}

/**
 * The "Needs you" card for an overwrite or delete. The safe choice is the dark button, as in the mockup. An overwrite
 * can also be turned down altogether, with the quieter button on the left.
 */
export function ApprovalCard({
  approval,
  t,
  onDecide,
}: {
  approval: Approval;
  t: ReturnType<typeof useT>;
  onDecide: (decision: Decision) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = approval.action === "delete";
  const decide = async (decision: Decision) => {
    setBusy(true);
    setError(null);
    try {
      await onDecide(decision);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="composer asking approve" aria-label={t("tag.needsYou")}>
      <div className="q">
        {approvalTitle(t, approval)}
        <span className="d">{remove ? t("approval.deleteDetail") : t("approval.overwriteDetail")}</span>
        {error && (
          <span className="d err" role="alert">
            {error}
          </span>
        )}
      </div>
      <div className="acts">
        {!remove && (
          <button type="button" className="tbtn discard" disabled={busy} onClick={() => void decide("discard")}>
            {t("approval.discard")}
          </button>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => void decide("allow")}>
          {remove ? t("approval.trash") : t("approval.allowOverwrite")}
        </button>
        <button type="button" className="btn dark" disabled={busy} onClick={() => void decide("refuse")}>
          {remove ? t("approval.keep") : t("approval.saveNew")}
        </button>
      </div>
    </section>
  );
}
