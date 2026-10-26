import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("shows the sidebar sections for the level and greets the user on the work home", () => {
    render(<App userName="Giulia" />);
    for (const name of ["New task", "Projects", "Skills"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // Jobs and the board start at Intermediate.
    expect(screen.queryByRole("button", { name: "Jobs" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Giulia/);
  });

  it("keeps Start task disabled until there is a brief", () => {
    render(<App userName="Giulia" />);
    const start = screen.getAllByRole("button", { name: "Start task" })[0] as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it("keeps the brief when the user visits another section and comes back", () => {
    render(<App userName="Giulia" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Summarise the contract" } });
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Summarise the contract");
  });
});
