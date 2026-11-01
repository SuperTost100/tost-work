import { useEffect, useRef } from "react";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";

/** How long the message stays, unless the pointer or the keyboard is on it. */
export const SAVED_TOAST_MS = 5000;

/**
 * Says where a task saved for later went, with a button to open it. It goes after a few seconds, or on Escape or its
 * close button. The parent puts it in a live region, so screen readers hear it.
 */
export function SavedToast({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // While the pointer or the focus is on it, it waits another round, so it never goes from under the user.
    const wait = () => {
      timer = setTimeout(() => (box.current?.matches(":hover, :focus-within") ? wait() : onClose()), SAVED_TOAST_MS);
    };
    wait();
    return () => clearTimeout(timer);
  }, [onClose]);
  useEffect(() => {
    // Before the page's own Escape, such as the one that closes the Board's side panel, so one press closes one thing.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('[role="menu"], [role="dialog"], [role="alertdialog"]'))
        return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="toast saved" ref={box}>
      <Icon name="check" />
      <span className="grow">{t("saved.toast")}</span>
      <button type="button" className="btn" onClick={onOpen}>
        {t("saved.open")}
      </button>
      <button type="button" className="iconbtn" aria-label={t("common.dismiss")} onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
