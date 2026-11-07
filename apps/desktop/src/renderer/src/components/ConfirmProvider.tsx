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
      // The app's own shortcuts, such as Cmd+K for search, wait until the card is answered. Copying text still works.
      if (e.metaKey || e.ctrlKey) {
        e.stopPropagation();
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      open.answer("no");
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [open]);

  // Over another dialog, such as the job editor, the two would each keep focus to themselves, and Tab left the card.
  // While the card is open everything else on the page is inert, so Tab and clicks stay in it.
  // The card's own layer at the top of the page, so it's known before the card is drawn into it.
  const [layer] = useState(() => document.createElement("div"));
  useEffect(() => {
    document.body.append(layer);
    return () => layer.remove();
  }, [layer]);
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const own = layer;
    const others: HTMLElement[] = [];
    const quiet = (el: Element) => {
      if (!(el instanceof HTMLElement) || el === own || el.inert) return;
      el.inert = true;
      others.push(el);
    };
    for (const el of document.body.children) quiet(el);
    // A dialog opened meanwhile, say from the menu bar, adds its own layer: it waits behind the card too.
    const added = new MutationObserver((changes) => {
      for (const change of changes) for (const node of change.addedNodes) if (node instanceof Element) quiet(node);
    });
    added.observe(document.body, { childList: true });
    return () => {
      added.disconnect();
      for (const el of others) el.inert = false;
    };
  }, [isOpen, layer]);

  // The last question stays drawn while the card closes.
  const last = useRef<Confirmation | null>(null);
  if (open) last.current = open.question;
  const shown = open?.question ?? last.current;

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {/* Mounted all along and opened, as the search dialog is: a dialog created already open didn't keep Tab inside. */}
      <AlertDialog.Root open={open !== null} onOpenChange={(isOpen) => !isOpen && open?.answer("no")}>
        <AlertDialog.Portal container={layer}>
          <AlertDialog.Backdrop className="dlg-backdrop" />
          {shown && (
            <AlertDialog.Popup className="modal confirmmodal" initialFocus={cancel}>
              <div className="cb">
                <AlertDialog.Title render={<b />}>{shown.message}</AlertDialog.Title>
                {shown.detail && (
                  <AlertDialog.Description render={<p className="t2" />}>{shown.detail}</AlertDialog.Description>
                )}
              </div>
              <div className="mf">
                <span className="grow" />
                <AlertDialog.Close ref={cancel} className="btn">
                  {t("dialog.cancel")}
                </AlertDialog.Close>
                <button
                  type="button"
                  className={`btn${shown.danger ? " danger fill" : shown.alt ? "" : " dark"}`}
                  onClick={() => open?.answer("yes")}
                >
                  {shown.yes}
                </button>
                {shown.alt && (
                  <button type="button" className="btn dark" onClick={() => open?.answer("alt")}>
                    {shown.alt}
                  </button>
                )}
              </div>
            </AlertDialog.Popup>
          )}
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
