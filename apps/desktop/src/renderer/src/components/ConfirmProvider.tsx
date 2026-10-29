import { AlertDialog } from "@base-ui/react/alert-dialog";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type Confirm, type Confirmation, ConfirmContext } from "@/lib/useConfirm";
import { useT } from "@/lib/useT";

interface Open {
  question: Confirmation;
  answer: (yes: boolean) => void;
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

  const confirm = useCallback<Confirm>((question) => {
    if (busy.current) return Promise.resolve(false);
    busy.current = true;
    return new Promise<boolean>((resolve) => {
      setOpen({
        question,
        answer: (yes) => {
          busy.current = false;
          setOpen(null);
          resolve(yes);
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
      open.answer(false);
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [open]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {open && (
        <AlertDialog.Root open onOpenChange={(isOpen) => !isOpen && open.answer(false)}>
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
                  className={`btn ${open.question.danger ? "danger fill" : "dark"}`}
                  onClick={() => open.answer(true)}
                >
                  {open.question.yes}
                </button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </ConfirmContext.Provider>
  );
}
