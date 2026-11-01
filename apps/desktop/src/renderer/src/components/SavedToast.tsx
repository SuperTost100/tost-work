import { useCallback, useEffect, useRef } from "react";
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
  // It sinks and fades before it goes, the way it came in (see .toast in app.css). Without animations, or with reduced
  // motion turned on, it goes at once.
  const leaving = useRef(false);
  // A second save replaces this toast at once; its way out, still playing, must not close the new one when it ends.
  const replaced = useRef(false);
  useEffect(() => {
    // Set again on setup, as Strict Mode runs the cleanup and the setup once more while the toast stays.
    replaced.current = false;
    return () => {
      replaced.current = true;
    };
  }, []);
  const leave = useCallback(() => {
    const el = box.current;
    if (leaving.current) return;
    if (!el?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return onClose();
    leaving.current = true;
    el.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(12px) scale(0.98)" }], {
      duration: 160,
      easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
      fill: "forwards",
    }).finished.then(gone, gone);
    function gone() {
      if (!replaced.current) onClose();
    }
  }, [onClose]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // While the pointer or the focus is on it, it waits another round, so it never goes from under the user.
    const wait = () => {
      timer = setTimeout(() => (box.current?.matches(":hover, :focus-within") ? wait() : leave()), SAVED_TOAST_MS);
    };
    wait();
    return () => clearTimeout(timer);
  }, [leave]);
  useEffect(() => {
    // Before the page's own Escape, such as the one that closes the Board's side panel, so one press closes one thing.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('[role="menu"], [role="dialog"], [role="alertdialog"]'))
        return;
      e.preventDefault();
      leave();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [leave]);
  return (
    <div className="toast saved" ref={box}>
      <Icon name="check" />
      <span className="grow">{t("saved.toast")}</span>
      <button type="button" className="btn" onClick={onOpen}>
        {t("saved.open")}
      </button>
      <button type="button" className="iconbtn" aria-label={t("common.dismiss")} onClick={leave}>
        <Icon name="close" />
      </button>
    </div>
  );
}
