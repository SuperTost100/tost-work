import { Dialog } from "@base-ui/react/dialog";
import { useCallback, useContext, useRef } from "react";
import { legalHtml } from "@/lib/legal";
import { LanguageContext, useT } from "@/lib/useT";

/** The privacy notice over the screen it was opened from, read from the copy that ships with the app, so it opens offline. */
export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useContext(LanguageContext);
  // The focus starts on Close, because the first link inside the notice would scroll it open halfway down.
  const close = useRef<HTMLButtonElement>(null);
  // A ref callback, because the popup mounts after this component does, so an effect would find no element.
  const fill = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) el.innerHTML = legalHtml("privacy", lang);
    },
    [lang],
  );
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-backdrop" />
        <Dialog.Popup className="modal legalmodal" initialFocus={close}>
          <div className="mh">
            <Dialog.Title render={<b className="grow" />}>{t("legal.privacy")}</Dialog.Title>
          </div>
          {/* The text is ours and ships with the app, as in About, so it needs no sanitizing. */}
          <div className="ib doc legal" ref={fill} />
          <div className="mf">
            <span className="grow" />
            <Dialog.Close ref={close} className="btn">
              {t("dialog.close")}
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
