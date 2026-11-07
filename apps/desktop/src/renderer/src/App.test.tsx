import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { createMemoryApi } from "./lib/memoryApi";

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

  it("asks the main process's questions in its own card, with a third button, and sends back the answer", async () => {
    const api = createMemoryApi();
    render(<App api={api} />);
    let answer = "";
    act(() => {
      void api
        .askFromMain({
          message: "offerta.docx is already in that folder",
          yes: "Replace",
          danger: true,
          alt: "Keep both",
        })
        .then((a) => {
          answer = a;
        });
    });
    const card = await screen.findByRole("alertdialog");
    expect(
      within(card)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Cancel", "Replace", "Keep both"]);
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Keep both" }));
    });
    await waitFor(() => expect(answer).toBe("alt"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
