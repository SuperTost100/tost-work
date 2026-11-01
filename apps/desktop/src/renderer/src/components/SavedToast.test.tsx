import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
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

  it("closes only once its way out has played, and only once however often it is asked", async () => {
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const animate = vi.fn(() => ({ finished }) as unknown as Animation);
    HTMLElement.prototype.animate = animate;
    try {
      const onClose = vi.fn();
      render(<SavedToast onOpen={() => {}} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(animate).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => finish());
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      // jsdom has no animations of its own.
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    }
  });

  it("still closes after its way out in Strict Mode, which sets its effects up twice", async () => {
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    HTMLElement.prototype.animate = vi.fn(() => ({ finished }) as unknown as Animation);
    try {
      const onClose = vi.fn();
      render(
        <StrictMode>
          <SavedToast onOpen={() => {}} onClose={onClose} />
        </StrictMode>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      await act(async () => finish());
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    }
  });

  it("doesn't close the toast that replaced it when its way out ends", async () => {
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    HTMLElement.prototype.animate = vi.fn(() => ({ finished }) as unknown as Animation);
    try {
      const onClose = vi.fn();
      const { rerender } = render(<SavedToast key="a" onOpen={() => {}} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      rerender(<SavedToast key="b" onOpen={() => {}} onClose={onClose} />);
      await act(async () => finish());
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      // jsdom has no animations of its own.
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    }
  });
});
