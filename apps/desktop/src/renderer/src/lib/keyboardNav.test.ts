import { afterEach, describe, expect, it } from "vitest";
import { trackKeyboardNav } from "./keyboardNav";

const marked = () => "keys" in document.documentElement.dataset;
const key = (init: KeyboardEventInit) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));

describe("focus rings follow keyboard moves", () => {
  let stop = () => {};
  afterEach(() => stop());

  it("turns on with Tab or an arrow key, and off with the next click", () => {
    stop = trackKeyboardNav();
    key({ key: "Tab" });
    expect(marked()).toBe(true);
    document.dispatchEvent(new Event("pointerdown"));
    expect(marked()).toBe(false);
    key({ key: "ArrowDown" });
    expect(marked()).toBe(true);
  });

  it("stays off for Shift on its own, typing and shortcuts", () => {
    stop = trackKeyboardNav();
    for (const init of [
      { key: "Shift" },
      { key: "a" },
      { key: "Enter" },
      { key: "Tab", metaKey: true },
      { key: "ArrowLeft", ctrlKey: true },
    ])
      key(init);
    expect(marked()).toBe(false);
  });
});
