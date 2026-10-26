import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "@/App";
import { createMemoryApi } from "@/lib/memoryApi";
import { DEFAULT_SETTINGS } from "../../../shared/model";

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

describe("file actions", () => {
  it("shows why Open did nothing", async () => {
    const api = createMemoryApi();
    api.files.open = async () => {
      throw new Error("The file was moved or deleted");
    };
    render(<App userName="Giulia" api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Write a proposal" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });
    const option = await screen.findByRole("button", { name: /We do/ });
    await act(async () => {
      fireEvent.click(option);
    });
    // A task without a project is a quick edit, so Open is on the preview and in the What changed panel.
    const [open] = await screen.findAllByRole("button", { name: "Open" });
    if (!open) throw new Error("no Open button");
    await act(async () => {
      fireEvent.click(open);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/moved or deleted/);
  });
});

describe("quick edit", () => {
  it("attaches a file, saves a copy and takes another instruction", async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    });
    // The chip can be removed and added again.
    fireEvent.click(screen.getByRole("button", { name: "Remove letter-bank.docx" }));
    expect(screen.queryByText("letter-bank.docx")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Fix the typos" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });

    expect(await screen.findByText(/letter-bank.docx, not in a project/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /We do/ }));
    });
    await screen.findByText("Check it against your brief");

    expect(screen.getByRole("status").textContent).toBe("Your original isn't touched");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    });
    expect(screen.getByRole("status").textContent).toBe("Saved in /Users/giulia/Documents");

    fireEvent.change(screen.getByRole("textbox", { name: "Ask for another change" }), {
      target: { value: "Make it shorter" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(await screen.findByText("Done, I made the change.")).toBeTruthy();
    // The new run's steps sit under the instruction that started it.
    const instruction = screen.getByText("Make it shorter");
    const step = screen.getByText("Make the change");
    expect(instruction.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The old review checked the old brief, so it's gone.
    expect(screen.queryByText("Check it against your brief")).toBeNull();
  });
});

describe("approvals", () => {
  it("asks before an overwrite, then lets the user restore the old version", async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Update the proposal" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /We do/ }));
    });
    await screen.findByText("Check it against your brief");

    act(() =>
      api.emit("t1", {
        type: "approval",
        approval: { id: "a1", action: "overwrite", paths: ["/tmp/Proposta.docx"] },
      }),
    );
    expect(screen.getByText("The task wants to replace Proposta.docx")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow overwrite" }));
    });
    expect(screen.queryByRole("button", { name: "Allow overwrite" })).toBeNull();
    expect(screen.getByText("The version before the edit is kept")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    });
    expect(screen.getByText("You restored the earlier version")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    // Undo puts the edited version back, so the row is back to offering Restore.
    expect(screen.getByText("The version before the edit is kept")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
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

  it("shows the version and build on the Settings placeholder", () => {
    render(<App userName="Giulia" api={createMemoryApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(`Tost Work ${__APP_VERSION__} · build ${__APP_BUILD__}`)).toBeTruthy();
  });

  it("shows a placeholder for sections that aren't built yet", () => {
    const settings = { ...DEFAULT_SETTINGS, name: "Giulia", level: "intermediate" as const, setupDone: true };
    render(<App userName="Giulia" api={createMemoryApi()} settings={settings} />);
    fireEvent.click(screen.getByRole("button", { name: "Jobs" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/arrives in a later version/);
  });
});

describe("a running task", () => {
  it("says it's working, with the current step, until it stops", async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Write a proposal" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });
    await screen.findByText("Who pays the insurance?");
    // While it waits for the user, the question is the status, not the working line.
    expect(screen.queryByText("Working on it")).toBeNull();

    const [task] = await api.tasks.list();
    act(() => api.emit(task?.id ?? "", { type: "withdrawn", id: "q1" }));
    expect((await screen.findByText("Working on it")).closest(".working")?.textContent).toBe(
      "Working on it · Read the notes",
    );
    // Two signs while it works: the line above the composer and the tag in Recent. The header shows none.
    expect(screen.getAllByText("working")).toHaveLength(1);
    expect(screen.queryByText("writing · 1 of 2")).toBeNull();
    expect(screen.getByRole("button", { name: /Write a proposal.*working/ })).toBeTruthy();

    act(() => api.emit(task?.id ?? "", { type: "stopped" }));
    expect(screen.queryByText("Working on it")).toBeNull();
  });
});

describe("the account row", () => {
  it("opens Settings from the gear", () => {
    render(<App userName="Giulia" api={createMemoryApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
  });

  it("opens the profile from the name, and saves what the AI should know", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    const saved: unknown[] = [];
    const settings = await api.settings.get();
    render(<App userName="Giulia" api={api} settings={settings} onSettings={(s) => saved.push(s)} />);
    fireEvent.click(screen.getByRole("button", { name: "Giulia, About you" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("About you");
    fireEvent.change(screen.getByRole("textbox", { name: "What you do" }), {
      target: { value: "I run AI courses for companies" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "What else the AI should know" }), {
      target: { value: "Short documents, please." },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(await api.settings.get()).toMatchObject({
      work: "I run AI courses for companies",
      notes: "Short documents, please.",
    });
    expect(saved).toHaveLength(1);
  });

  it("reads as saved after saving text with spaces around it", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    const initial = await api.settings.get();
    const { rerender } = render(<App userName="Giulia" api={api} settings={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Giulia, About you" }));
    fireEvent.change(screen.getByRole("textbox", { name: "What you do" }), { target: { value: "  Writer  " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    rerender(<App userName="Giulia" api={api} settings={await api.settings.get()} />);
    expect((screen.getByRole("textbox", { name: "What you do" }) as HTMLInputElement).value).toBe("Writer");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Saved. The next tasks will use it.")).toBeTruthy();
  });

  it("keeps what the user typed while the profile was saving", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    const update = api.settings.update;
    let finish: () => void = () => {};
    api.settings.update = (patch) => new Promise((resolve) => (finish = () => resolve(update(patch))));
    render(<App userName="Giulia" api={api} settings={await api.settings.get()} />);
    fireEvent.click(screen.getByRole("button", { name: "Giulia, About you" }));
    const work = screen.getByRole("textbox", { name: "What you do" }) as HTMLInputElement;
    fireEvent.change(work, { target: { value: "Writer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(work, { target: { value: "Writer and trainer" } });
    await act(async () => finish());
    expect(work.value).toBe("Writer and trainer");
  });
});

describe("the task menu in Recent", () => {
  const started = async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Write a proposal" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });
    await screen.findByText("Who pays the insurance?");
    const [task] = await api.tasks.list();
    act(() => api.emit(task?.id ?? "", { type: "stopped" }));
    return api;
  };

  it("renames a task in place", async () => {
    const api = await started();
    api.pickInMenu("rename");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More for Write a proposal" }));
    });
    const field = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(field, { target: { value: "Alpi proposal" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(await screen.findByRole("button", { name: "More for Alpi proposal" })).toBeTruthy();
    expect((await api.tasks.list())[0]?.title).toBe("Alpi proposal");
  });

  it("keeps the old name on Escape", async () => {
    const api = await started();
    api.pickInMenu("rename");
    await act(async () => {
      fireEvent.contextMenu(screen.getByRole("button", { name: "More for Write a proposal" }));
    });
    const field = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(field, { target: { value: "Something else" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();
    expect((await api.tasks.list())[0]?.title).toBe("Write a proposal");
  });

  it("deletes a task from a right-click and leaves its screen", async () => {
    const api = await started();
    api.pickInMenu("delete");
    const row = screen.getAllByRole("button", { name: /Write a proposal/ })[0];
    await act(async () => {
      if (row) fireEvent.contextMenu(row);
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "More for Write a proposal" })).toBeNull());
    expect(await api.tasks.list()).toEqual([]);
    expect(screen.queryByText("Who pays the insurance?")).toBeNull();
  });
});
