import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState } from "react";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { errorText } from "@/lib/errorText";
import { useT } from "@/lib/useT";
import type { Project } from "../../../shared/model";

/** A project's instructions, edited formatted. Save keeps them for the next tasks; Cancel keeps the old ones. */
export function ProjectInstructionsDialog({
  project,
  onSave,
  onClose,
}: {
  project: Project;
  /** Saves the text. A rejection is shown in the dialog, which stays open. */
  onSave: (instructions: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(project.instructions);
  const [error, setError] = useState<string | null>(null);
  // The ref stops a double click in the same tick; the state greys the button out.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    // A click outside doesn't close it, so a stray click can't throw away what was typed.
    <Dialog.Root open disablePointerDismissal onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-backdrop" />
        <Dialog.Popup className="modal instrmodal">
          <div className="mh">
            <Dialog.Title render={<b className="grow" />}>
              {t("project.instructionsTitle", { name: project.name })}
            </Dialog.Title>
          </div>
          <div className="ib">
            <p className="t3">{t("project.instructionsHint")}</p>
            <MarkdownEditor
              label={t("project.instructions")}
              placeholder={t("project.instructionsExample")}
              value={draft}
              onChange={setDraft}
            />
            {error && (
              <p className="fld-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="mf">
            <span className="grow" />
            <Dialog.Close className="btn">{t("dialog.cancel")}</Dialog.Close>
            <button
              type="button"
              className="btn dark"
              disabled={busy || draft === project.instructions}
              onClick={() => void save()}
            >
              {t("skills.save")}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
