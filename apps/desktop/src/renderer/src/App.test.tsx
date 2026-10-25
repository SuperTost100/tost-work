import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("shows the sidebar sections and greets the user on the work home", () => {
    render(<App userName="Giulia" />);
    for (const name of ["New task", "Projects", "Skills", "Jobs", "Board"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Giulia/);
  });

  it("keeps Start task disabled until there is a brief", () => {
    render(<App userName="Giulia" />);
    const start = screen.getAllByRole("button", { name: "Start task" })[0] as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });
});
