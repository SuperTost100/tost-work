/** The keys that move focus. Typing, shortcuts and a key such as Shift on its own don't. */
const MOVING_KEYS = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * Marks the page with `data-keys` while the user moves around with the keyboard, and clears it on the next click or
 * tap, so the stylesheet draws focus rings only then. Chromium alone also turns on :focus-visible when any key is
 * pressed after a click, Shift included, which drew a ring on a clicked task in Recent tasks.
 */
export function trackKeyboardNav(doc: Document = document): () => void {
  const root = doc.documentElement;
  const onKey = (e: KeyboardEvent) => {
    if (MOVING_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) root.dataset.keys = "";
  };
  const onPointer = () => {
    delete root.dataset.keys;
  };
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("pointerdown", onPointer, true);
  return () => {
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("pointerdown", onPointer, true);
    onPointer();
  };
}
