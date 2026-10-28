import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    let sent: string[] = [];
    api.tasks.answer = (_id, answers) => {
      sent = answers;
      return new Promise((resolve) => {
        finish = () => waiting && resolve(waiting);
      });
    };
    fireEvent.change(box, { target: { value: "Half and half" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sent).toEqual(["Half and half"]);
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
    // Sent, it's on the task as the answered line, which opens onto the answer.
    fireEvent.click(await screen.findByRole("button", { name: "You answered 1 question" }));
    expect(screen.getByText("Split it half and half")).toBeTruthy();
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
  it("lists the skills it followed in its side panel too", async () => {
    const api = createMemoryApi();
    const task = await api.tasks.start({ projectId: null, brief: "Tidy this letter", attachments: [] });
    render(<App userName="Giulia" api={api} />);
    const [open] = await screen.findAllByText(/Tidy this letter/);
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    await act(async () => api.emit(task.id, { type: "activity", kind: "skill", target: "@word" }));
    expect(await screen.findByText("Skills it followed")).toBeTruthy();
    expect(await screen.findByText("Word documents")).toBeTruthy();
    // A skill no longer there shows by its folder name, even one named like an object property.
    await act(async () => api.emit(task.id, { type: "activity", kind: "skill", target: "constructor" }));
    expect(await screen.findByText("constructor")).toBeTruthy();
  });

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

describe("what the agent is doing", () => {
  it("shows the latest actions while it works, then folds them into one line", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const task = await api.tasks.start({ projectId: project.id, brief: "Write the course outline", attachments: [] });
    act(() => {
      api.emit(task.id, { type: "withdrawn", id: "q1" });
      api.emit(task.id, { type: "activity", kind: "read", target: "note.txt" });
      api.emit(task.id, { type: "activity", kind: "web", target: "corsi AI Biella" });
    });
    render(<App userName="Giulia" api={api} />);
    const [open] = await screen.findAllByText("Write the course outline");
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    expect(screen.getByRole("button", { name: "What it's doing" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Reading note.txt")).toBeTruthy();
    // The line above the composer only says it's at work: the log above already says what it's doing.
    expect(screen.getByRole("status").textContent).toBe("Working on it");

    // A guide the agent read shows in the side panel by its title.
    await act(async () => api.emit(task.id, { type: "activity", kind: "skill", target: "@word" }));
    expect(await screen.findByText("Skills it followed")).toBeTruthy();
    expect(await screen.findByText("Word documents")).toBeTruthy();

    act(() => api.emit(task.id, { type: "done" }));
    const line = screen.getByRole("button", { name: "What it did (3)" });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Reading note.txt")).toBeNull();
    fireEvent.click(line);
    expect(screen.getByText("Reading note.txt")).toBeTruthy();
  });

  it("shows each batch of actions above the message that followed it, and only the newest batch as live", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const task = await api.tasks.start({ projectId: project.id, brief: "Sum up the calls", attachments: [] });
    act(() => {
      api.emit(task.id, { type: "withdrawn", id: "q1" });
      api.emit(task.id, { type: "activity", kind: "read", target: "call-1.docx" });
      api.emit(task.id, { type: "message", text: "I found the notes from both calls." });
      api.emit(task.id, { type: "activity", kind: "read", target: "plan.md" });
    });
    render(<App userName="Giulia" api={api} />);
    const [open] = await screen.findAllByText("Sum up the calls");
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    const done = screen.getByRole("button", { name: "What it did (1)" });
    const live = screen.getByRole("button", { name: "What it's doing" });
    const message = screen.getByText("I found the notes from both calls.");
    // The finished batch sits above the message, folded; the live one comes after it.
    expect(done.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(message.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Reading call-1.docx")).toBeNull();
    expect(screen.getByText("Reading plan.md")).toBeTruthy();
  });

  it("says it's asking a question while one waits, and keeps the check for when the work is over", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const task = await api.tasks.start({ projectId: project.id, brief: "Write the quote", attachments: [] });
    const review = { asked: [{ text: "Write the quote" }], decided: [], checkYourself: [] };
    act(() => {
      api.emit(task.id, { type: "withdrawn", id: "q1" });
      api.emit(task.id, { type: "activity", kind: "read", target: "prices.pdf" });
      api.emit(task.id, {
        type: "file",
        change: { path: "/home/giulia/Courses/Quote.docx", kind: "add", role: "made" },
      });
      api.emit(task.id, { type: "review", review });
      api.emit(task.id, { type: "question", question: { id: "q2", text: "Which services?", options: ["A", "B"] } });
    });
    render(<App userName="Giulia" api={api} />);
    const [open] = await screen.findAllByText("Write the quote");
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    expect(screen.getByRole("button", { name: "What it's doing" })).toBeTruthy();
    // The log's last line, and the announcement for screen readers.
    const asking = screen.getAllByText("Asking you a question");
    expect(asking.map((el) => Boolean(el.closest(".activity")))).toEqual([true, false]);
    expect(asking[1]?.getAttribute("aria-live")).toBe("polite");
    expect(screen.queryByText("Check it against your brief")).toBeNull();

    act(() => {
      api.emit(task.id, { type: "withdrawn", id: "q2" });
      api.emit(task.id, { type: "done" });
    });
    expect(screen.queryAllByText("Asking you a question")).toHaveLength(0);
    expect(screen.getByText("Check it against your brief")).toBeTruthy();
  });
});

describe("a round of questions", () => {
  it("refuses a round with an answer missing, as the app does", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const task = await api.tasks.start({ projectId: project.id, brief: "Plan it", attachments: [] });
    act(() =>
      api.emit(task.id, {
        type: "question",
        question: { id: "r9", text: "Who?", options: ["A", "B"], more: [{ text: "When?", options: ["Now", "Later"] }] },
      }),
    );
    await expect(api.tasks.answer(task.id, ["A"])).rejects.toThrow(/one answer per question/);
    expect((await api.tasks.get(task.id))?.question?.id).toBe("r9");
  });

  it("asks them one at a time, lets the user step back, and sends all the answers together", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const task = await api.tasks.start({ projectId: project.id, brief: "Plan the training day", attachments: [] });
    act(() =>
      api.emit(task.id, {
        type: "question",
        question: {
          id: "r1",
          text: "Who is it for?",
          options: ["Everyone", "Engineers"],
          more: [
            { text: "How long?", options: ["Half a day", "A full day"] },
            { text: "Where?", options: ["On site", "Online"] },
          ],
        },
      }),
    );
    render(<App userName="Giulia" api={api} />);
    const [open] = await screen.findAllByText("Plan the training day");
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    expect(screen.getByText("Question 1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Engineers/ }));
    fireEvent.click(screen.getByRole("button", { name: /Half a day/ }));
    // Back to the second, and the first answer in the user's own words this time.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Half a day/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Two hours" } });
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByText("Question 3 of 3")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Online/ }));
    });
    const sent = (await api.tasks.get(task.id))?.messages.at(-1)?.text;
    expect(sent).toBe("Who is it for?\n→ Engineers\n\nHow long?\n→ Two hours\n\nWhere?\n→ Online");

    // The answered round is one folded line that opens onto each question and its answer.
    const line = await screen.findByRole("button", { name: "You answered 3 questions" });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Two hours")).toBeNull();
    fireEvent.click(line);
    expect(screen.getByText("How long?")).toBeTruthy();
    expect(screen.getByText("Two hours")).toBeTruthy();
  });

  it("clears the box when the last answer is an option, even if sending it fails", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const task = await api.tasks.start({ projectId: project.id, brief: "Plan the visit", attachments: [] });
    act(() =>
      api.emit(task.id, {
        type: "question",
        question: { id: "r3", text: "Day?", options: ["Mon", "Fri"], more: [{ text: "Room?", options: ["A", "B"] }] },
      }),
    );
    api.tasks.answer = async () => {
      throw new Error("offline");
    };
    render(<App userName="Giulia" api={api} />);
    const [open] = await screen.findAllByText("Plan the visit");
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    fireEvent.click(screen.getByRole("button", { name: /^1Mon$/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "stale text" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^2B$/ }));
    });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps what was typed when stepping back, and won't send a round too long for one message", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const task = await api.tasks.start({ projectId: project.id, brief: "Plan the course", attachments: [] });
    act(() =>
      api.emit(task.id, {
        type: "question",
        question: {
          id: "r2",
          text: "Who?",
          options: ["A", "B"],
          more: [{ text: "Notes?", options: ["None", "Some"] }],
        },
      }),
    );
    render(<App userName="Giulia" api={api} />);
    const [open] = await screen.findAllByText("Plan the course");
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    fireEvent.click(screen.getByRole("button", { name: /^1A$/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "half typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: /^1A$/ }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("half typed");

    // Focus follows the question, so the keyboard carries on from there.
    expect(document.activeElement?.textContent).toMatch(/Notes\?/);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(document.activeElement?.textContent).toMatch(/Who\?/);
    // Typing there keeps the focus in the box, keystroke after keystroke.
    const box = screen.getByRole("textbox");
    box.focus();
    for (const text of ["t", "ty", "typ"]) {
      fireEvent.change(box, { target: { value: text } });
      expect(document.activeElement).toBe(box);
    }
    // Text typed and then replaced by an option doesn't come back.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "typed first" } });
    fireEvent.click(screen.getByRole("button", { name: /^1A$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("button", { name: /^1A$/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^1A$/ }));

    // Two answers that each fit, but not together.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x".repeat(60_000) } });
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "y".repeat(60_000) } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/answers together are longer/);
    expect((await api.tasks.get(task.id))?.status).toBe("needs-you");
  });
});

describe("long messages", () => {
  it("won't send a text longer than a message holds, and says to attach it", () => {
    render(<App userName="Giulia" api={createMemoryApi()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x".repeat(100_001) } });
    expect(screen.getByRole("button", { name: "Start task" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/Attach it as a file/);
  });

  it("folds a long brief behind Show all", async () => {
    const api = createMemoryApi();
    const brief = `Summarise this email. ${"Lorem ipsum dolor sit amet. ".repeat(80)}THE END`;
    await api.tasks.start({ projectId: null, brief, attachments: [] });
    render(<App userName="Giulia" api={api} />);
    const [open] = await screen.findAllByText(/^Summarise this email/);
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    expect(document.querySelector(".you")?.textContent).not.toMatch(/THE END/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    });
    expect(document.querySelector(".you")?.textContent).toMatch(/THE END/);
  });
});

describe("the files of a task", () => {
  it("shows a file picked in the side panel, and lists the attached files as used", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
    const task = await api.tasks.start({
      projectId: project.id,
      brief: "Compare the offers",
      attachments: ["/home/giulia/offer.pdf"],
    });
    act(() => {
      api.emit(task.id, { type: "file", change: { path: "/home/giulia/Proposals/a.docx", kind: "add", role: "made" } });
      api.emit(task.id, { type: "file", change: { path: "/home/giulia/Proposals/b.xlsx", kind: "add", role: "made" } });
      api.emit(task.id, {
        type: "file",
        change: { path: "/home/giulia/Proposals/prices.xlsx", kind: "update", role: "used" },
      });
    });
    render(<App userName="Giulia" api={api} />);
    // Find first, then act: waiting inside act holds back the updates the wait is for.
    const [open] = await screen.findAllByText("Compare the offers");
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    // The newest file shows first; picking the other one in the side panel switches the card to it.
    expect(screen.getByRole("tab", { name: "b.xlsx" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "a.docx" }));
    });
    expect(screen.getByRole("tab", { name: "a.docx" }).getAttribute("aria-selected")).toBe("true");
    const panel = within(document.querySelector(".rp") as HTMLElement);
    expect(panel.getByText("Used")).toBeTruthy();
    expect(panel.getByText("offer.pdf")).toBeTruthy();
    // The attachment says it was attached; a file the task only read doesn't.
    expect(panel.getAllByText("Attached")).toHaveLength(1);
    expect(panel.getByText("prices.xlsx")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/arrives in a later version/);
  });
});

describe("an answer as it's written", () => {
  const started = async (brief: string) => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const task = await api.tasks.start({ projectId: project.id, brief, attachments: [] });
    act(() => api.emit(task.id, { type: "withdrawn", id: "q1" }));
    return { api, task };
  };
  const open = async (title: string) => {
    const [row] = await screen.findAllByText(title);
    await act(async () => {
      fireEvent.click(row as HTMLElement);
    });
  };

  it("shows the words as they come, from the start even when the task opens halfway, then the whole answer", async () => {
    const { api, task } = await started("Sum up the calls");
    act(() => api.emit(task.id, { type: "text", text: "Both calls " }));
    render(<App userName="Giulia" api={api} />);
    await open("Sum up the calls");
    act(() => api.emit(task.id, { type: "text", text: "went well. " }));
    expect(await screen.findByText("Both calls went well.")).toBeTruthy();

    act(() => {
      api.emit(task.id, { type: "message", text: "Both calls went well. Mark wants a proposal by Friday." });
      api.emit(task.id, { type: "done" });
    });
    expect(await screen.findByText("Both calls went well. Mark wants a proposal by Friday.")).toBeTruthy();
    // The draft went with the message: the text shows once.
    expect(screen.queryByText("Both calls went well.")).toBeNull();
  });

  it("leaves out the brief check when the answer stayed in the chat", async () => {
    const { api, task } = await started("Take stock of the calls");
    act(() => {
      api.emit(task.id, {
        type: "review",
        review: { asked: [{ text: "Take stock" }], decided: [], checkYourself: [] },
      });
      api.emit(task.id, { type: "message", text: "Here's where things stand." });
      api.emit(task.id, { type: "done" });
    });
    render(<App userName="Giulia" api={api} />);
    await open("Take stock of the calls");
    expect(await screen.findByText("Here's where things stand.")).toBeTruthy();
    expect(screen.queryByText("Check it against your brief")).toBeNull();
  });
});

describe("a running task", () => {
  it("says it's working until it stops", async () => {
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
    expect((await screen.findByText("Working on it")).closest(".working")?.textContent).toBe("Working on it");
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

describe("copying a message", () => {
  it("copies the agent's message with its formatting, and the user's as text", async () => {
    const writes: ClipboardItem[][] = [];
    const texts: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => void writes.push(items),
        writeText: async (text: string) => void texts.push(text),
      },
    });
    class Item {
      constructor(readonly parts: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", Item);
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const task = await api.tasks.start({ projectId: project.id, brief: "Sum up the calls", attachments: [] });
    act(() => {
      api.emit(task.id, { type: "withdrawn", id: "q1" });
      api.emit(task.id, { type: "message", text: "Two **calls** done." });
    });
    render(<App userName="Giulia" api={api} />);
    const [open] = await screen.findAllByText("Sum up the calls");
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    const [brief, message] = screen.getAllByRole("button", { name: "Copy" });
    await act(async () => fireEvent.click(brief as HTMLElement));
    expect(texts).toEqual(["Sum up the calls"]);
    await act(async () => fireEvent.click(message as HTMLElement));
    expect(writes).toHaveLength(1);
    const parts = (writes[0]?.[0] as unknown as Item | undefined)?.parts ?? {};
    expect(await parts["text/plain"]?.text()).toBe("Two calls done.");
    expect(await parts["text/html"]?.text()).toContain("<strong>calls</strong>");
    expect(screen.getAllByRole("button", { name: "Copied" })).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});

describe("a notification click", () => {
  it("opens the task it was about, even one older than the recent list", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const task = await api.tasks.start({ projectId: project.id, brief: "Write the course outline", attachments: [] });
    // The recent list leaves it out, as it would with 50 newer tasks.
    vi.spyOn(api.tasks, "list").mockResolvedValue([]);
    render(<App userName="Giulia" api={api} />);
    await screen.findAllByText(/Giulia/);
    expect(screen.queryByText("Write the course outline")).toBeNull();
    await act(async () => api.openFromOutside(task.id));
    expect(await screen.findByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("says a deleted task is gone, and only the latest click opens", async () => {
    const api = createMemoryApi();
    const project = await api.projects.create({ name: "Courses", folder: "/home/giulia/Courses" });
    const first = await api.tasks.start({ projectId: project.id, brief: "First outline", attachments: [] });
    const second = await api.tasks.start({ projectId: project.id, brief: "Second outline", attachments: [] });
    render(<App userName="Giulia" api={api} />);
    await screen.findAllByText("Second outline");
    await act(async () => api.openFromOutside("deleted"));
    expect(await screen.findByText("That task isn't there any more.")).toBeTruthy();
    // The first lookup answers last, but the second click is the one that counts.
    const get = api.tasks.get;
    vi.spyOn(api.tasks, "get").mockImplementation(async (id) => {
      if (id === first.id) await new Promise((r) => setTimeout(r, 30));
      return get(id);
    });
    await act(async () => {
      api.openFromOutside(first.id);
      api.openFromOutside(second.id);
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getAllByText("Second outline").length).toBeGreaterThan(1);
  });
});
