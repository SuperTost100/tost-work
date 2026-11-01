import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageContext } from "@/lib/useT";
import { LINES } from "../../../shared/homeLines";
import type { Task } from "../../../shared/model";
import { Home } from "./Home";

afterEach(() => vi.restoreAllMocks());

describe("Home", () => {
  it("keeps its random pick when the language changes, and shows the same place in the other list", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const tasks = [
      { id: "t1", title: "Outline", status: "done", projectId: null, updatedAt: "2026-10-27T09:00:00Z" },
    ] as unknown as Task[];
    const home = (lang: "en" | "it") => (
      <LanguageContext.Provider value={lang}>
        <Home
          userName="Giulia"
          brief=""
          onBriefChange={() => {}}
          projectId={null}
          onProjectChange={() => {}}
          projects={[]}
          tasks={tasks}
          onStart={() => {}}
          onOpenTask={() => {}}
          onStartSaved={() => {}}
          onNewProject={() => {}}
          now={new Date(2026, 9, 27, 21)}
        />
      </LanguageContext.Provider>
    );
    const { rerender } = render(home("en"));
    expect(screen.getByText("Good evening, Giulia.")).toBeTruthy();
    expect(screen.getByText(LINES.en[Math.floor(LINES.en.length / 2)] as string)).toBeTruthy();
    vi.spyOn(Math, "random").mockReturnValue(0);
    rerender(home("it"));
    expect(screen.getByText("Buonasera, Giulia.")).toBeTruthy();
    expect(screen.getByText(LINES.it[Math.floor(LINES.it.length / 2)] as string)).toBeTruthy();
  });
});
