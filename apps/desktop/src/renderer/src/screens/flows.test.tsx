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
    // The file shows in the side panel and as the preview's title, and its content is drawn.
    expect(screen.getAllByText("Proposta.docx")).toHaveLength(2);
    expect(await screen.findByText(/ci ha chiesto di ridurre i tempi/)).toBeTruthy();
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

describe("answering twice", () => {
  it("sends one answer when an option is clicked twice", async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Write a proposal" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });
    const option = await screen.findByRole("button", { name: /We do/ });
    let calls = 0;
    const realAnswer = api.tasks.answer;
    api.tasks.answer = (id, answer) => {
      calls++;
      return realAnswer(id, answer);
    };
    await act(async () => {
      fireEvent.click(option);
      fireEvent.click(option);
    });
    expect(calls).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the answer draft", () => {
  const startAndWait = async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Write a proposal" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });
    const box = (await screen.findByRole("textbox", { name: "Or answer in your own words" })) as HTMLTextAreaElement;
    return { api, box };
  };

  it("goes when an option is picked instead", async () => {
    const { api, box } = await startAndWait();
    fireEvent.change(box, { target: { value: "Maybe half" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /We do/ }));
    });
    // The next question of the same task starts with an empty box.
    act(() =>
      api.emit("t1", { type: "question", question: { id: "q2", text: "Which template?", options: ["A", "B"] } }),
    );
    expect((screen.getByRole("textbox", { name: "Or answer in your own words" }) as HTMLTextAreaElement).value).toBe(
      "",
    );
  });

  it("keeps what was typed while the answer was sending", async () => {
    const { api, box } = await startAndWait();
    // The send succeeds later, and the question stays open, so the box stays on screen.
    const [waiting] = await api.tasks.list();
    let finish = () => {};
    let sent = "";
    api.tasks.answer = (_id, answer) => {
      sent = answer;
      return new Promise((resolve) => {
        finish = () => waiting && resolve(waiting);
      });
    };
    fireEvent.change(box, { target: { value: "Half and half" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sent).toBe("Half and half");
    fireEvent.change(box, { target: { value: "Also add a note" } });
    await act(async () => finish());
    expect(box.value).toBe("Also add a note");
  });
});

describe("a typed answer", () => {
  it("stays in the box when sending it fails, and goes once it's sent", async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Write a proposal" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });
    const box = await screen.findByRole("textbox", { name: "Or answer in your own words" });
    const realAnswer = api.tasks.answer;
    api.tasks.answer = async () => {
      throw new Error("The app didn't respond");
    };
    fireEvent.change(box, { target: { value: "Split it half and half" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(screen.getByRole("alert").textContent).toMatch(/didn't respond/);
    expect((box as HTMLTextAreaElement).value).toBe("Split it half and half");

    api.tasks.answer = realAnswer;
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(await screen.findByText("Split it half and half")).toBeTruthy();
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

  it("says so when a project's history fails to load", async () => {
    const api = createMemoryApi();
    api.tasks.listForProject = async () => {
      throw new Error("Couldn't read the tasks");
    };
    render(<App userName="Giulia" api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Proposals/ }));
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't read the tasks/);
  });

  it("shows a placeholder for sections that aren't built yet", () => {
    render(<App userName="Giulia" api={createMemoryApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "Jobs" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/arrives in a later version/);
  });
});
