import { AlertDialog } from "@base-ui/react/alert-dialog";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type Ask, type Confirmation, ConfirmContext } from "@/lib/useConfirm";
import { useT } from "@/lib/useT";
import type { QuestionAnswer } from "../../../shared/api";

interface Open {
  question: Confirmation;
  answer: (answer: QuestionAnswer) => void;
}

/**
 * The app's own card for questions before something that can't be undone, the same on every system. Cancel has the
 * focus when it opens, so Return can't delete; Esc cancels, and a click outside does nothing. One card at a time: a
 * question asked while another is open is answered no.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState<Open | null>(null);
  // Set at once, so two questions in the same tick can't both open.
  const busy = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>((question) => {
    if (busy.current) return Promise.resolve("no");
    busy.current = true;
    return new Promise<QuestionAnswer>((resolve) => {
      setOpen({
        question,
        answer: (answer) => {
          busy.current = false;
          setOpen(null);
          resolve(answer);
        },
      });
    });
  }, []);

  // Esc is the card's alone: a dialog behind it, such as the job builder, also listens for it and would close too,
  // losing what was typed there. Caught on the window before any of them hears it.
  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      open.answer("no");
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [open]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {open && (
        <AlertDialog.Root open onOpenChange={(isOpen) => !isOpen && open.answer("no")}>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="dlg-backdrop" />
            <AlertDialog.Popup className="modal confirmmodal" initialFocus={cancel}>
              <div className="cb">
                <AlertDialog.Title render={<b />}>{open.question.message}</AlertDialog.Title>
                {open.question.detail && (
                  <AlertDialog.Description render={<p className="t2" />}>
                    {open.question.detail}
                  </AlertDialog.Description>
                )}
              </div>
              <div className="mf">
                <span className="grow" />
                <AlertDialog.Close ref={cancel} className="btn">
                  {t("dialog.cancel")}
                </AlertDialog.Close>
                <button
                  type="button"
                  className={`btn${open.question.danger ? " danger fill" : open.question.alt ? "" : " dark"}`}
                  onClick={() => open.answer("yes")}
                >
                  {open.question.yes}
                </button>
                {open.question.alt && (
                  <button type="button" className="btn dark" onClick={() => open.answer("alt")}>
                    {open.question.alt}
                  </button>
                )}
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </ConfirmContext.Provider>
  );
}
