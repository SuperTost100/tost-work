import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "@/App";
import { createMemoryApi } from "@/lib/memoryApi";

describe("starting and finishing a task", () => {
  it("starts a task from the home, answers its question and shows the review", async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Write a proposal for Alpi Logistica" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });

    // The task screen opens on the question, and the sidebar flags the task.
    await screen.findByText("Who pays the insurance?");
    expect(screen.getAllByText("needs you").length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /We do/ }));
    });
    await screen.findByText("Check it against your brief");
    expect(screen.getByText("Travel not included")).toBeTruthy();
    expect(screen.getByText("Proposta.docx")).toBeTruthy();
    expect(screen.queryByText("Who pays the insurance?")).toBeNull();
  });
});

describe("failures and double clicks", () => {
  it("starts one task when Enter is pressed twice", async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Write a proposal" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(await api.tasks.list()).toHaveLength(1);
  });

  it("shows an answer that fails instead of dropping it", async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Write a proposal" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });
    const option = await screen.findByRole("button", { name: /We do/ });
    // As when the task was stopped elsewhere and the answer arrives after the question is gone.
    api.tasks.answer = async () => {
      throw new Error("This task isn't waiting for an answer");
    };
    await act(async () => {
      fireEvent.click(option);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/isn't waiting for an answer/);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("projects", () => {
  it("creates a project from a folder and names it after the folder", async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(screen.getByText(/No projects yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
    });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Proposals");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Proposals" })).toBeTruthy());
  });

  it("shows a placeholder for sections that aren't built yet", () => {
    render(<App userName="Giulia" api={createMemoryApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "Jobs" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/arrives in a later version/);
  });
});
