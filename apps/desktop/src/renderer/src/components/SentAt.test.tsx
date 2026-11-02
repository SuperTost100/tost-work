import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageContext } from "@/lib/useT";
import { AgentMessage } from "./AgentMessage";

describe("a message's time", () => {
  it("shows when it was sent beside the copy button, in the app's language", () => {
    const at = new Date(2025, 11, 30, 10, 0).toISOString();
    render(
      <LanguageContext.Provider value="it">
        <AgentMessage text="Fatto." at={at} />
      </LanguageContext.Provider>,
    );
    const time = screen.getByText("30 dic 2025 10:00");
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("datetime")).toBe(at);
    expect(time.closest(".msg-tools")).toBeTruthy();
  });

  it("shows nothing for an answer still coming in", () => {
    const { container } = render(<AgentMessage text="Sto scrivendo" />);
    expect(container.querySelector("time")).toBeNull();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves on at midnight in a task left open", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 23, 50));
    render(<AgentMessage text="Fatto." at={new Date(2026, 10, 2, 23, 40).toISOString()} />);
    expect(screen.getByText("23:40")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(11 * 60 * 1000);
    });
    expect(screen.getByText("yesterday 23:40")).toBeTruthy();
  });
});
