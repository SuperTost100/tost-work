import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAVED_TOAST_MS, SavedToast } from "./SavedToast";

afterEach(() => vi.useRealTimers());

describe("the message after saving for later", () => {
  it("goes by itself after five seconds, and stays while the focus is on it", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<SavedToast onOpen={() => {}} onClose={onClose} />);
    screen.getByRole("button", { name: "Open" }).focus();
    act(() => {
      vi.advanceTimersByTime(SAVED_TOAST_MS);
    });
    expect(onClose).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Open" }).blur();
    act(() => {
      vi.advanceTimersByTime(SAVED_TOAST_MS);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape and its close button, and opens the task with Open", () => {
    const onClose = vi.fn();
    const onOpen = vi.fn();
    render(<SavedToast onOpen={onOpen} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
