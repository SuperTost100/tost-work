import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryApi, type MemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";
import { Board } from "@/screens/Board";
import { DEFAULT_SETTINGS, type Task } from "../../../shared/model";

const intermediate = { name: "Giulia", level: "intermediate" as const, setupDone: true };

// Find first, then act: waiting inside act holds back the updates the wait is for.
const click = async (target: HTMLElement | Promise<HTMLElement>) => {
  const el = await target;
  await act(async () => {
    fireEvent.click(el);
  });
};
const button = (name: string | RegExp) => screen.findByRole("button", { name });
const group = (name: string) => screen.findByRole("region", { name });
// The sidebar lists recent tasks by title too, so rows are looked for on the board only.
const inBoard = () => within(document.querySelector(".board-page") as HTMLElement);
const row = (name: string) => inBoard().findByRole("button", { name });
/** Opens a task from the sidebar's Recent. */
const openRecent = async (title: RegExp) =>
  click((await screen.findAllByRole("button", { name: title }))[0] as HTMLElement);

/** A memory API with a task of each kind: a question, an approval, one saved for later, and one finished. */
async function seeded(): Promise<{
  api: MemoryApi;
  ids: Record<"asking" | "approving" | "later" | "finished", string>;
}> {
  const api = createMemoryApi(intermediate);
  const proposals = await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
  const site = await api.projects.create({ name: "Website", folder: "/home/giulia/Website" });
  const asking = await api.tasks.start({ projectId: proposals.id, brief: "Proposal for Alpi", attachments: [] });
  const approving = await api.tasks.start({ projectId: site.id, brief: "Supplier contracts summary" });
  api.emit(approving.id, { type: "withdrawn", id: "q1" });
  api.emit(approving.id, {
    type: "approval",
    approval: { id: "a1", action: "overwrite", paths: ["/home/giulia/Website/contracts.xlsx"] },
  });
  const later = await api.tasks.saveForLater({ projectId: site.id, brief: "Write three case studies" });
  const finished = await api.tasks.start({ projectId: proposals.id, brief: "Proposal for Ferraris" });
  await api.tasks.answer(finished.id, ["The client"]);
  return { api, ids: { asking: asking.id, approving: approving.id, later: later.id, finished: finished.id } };
}

const openBoard = async (api: MemoryApi) => {
  render(<Root api={api} />);
  await click(button("Board"));
  return screen.findByRole("heading", { level: 1, name: "Board" });
};

beforeEach(() => {
  // The memory API's day, so its tasks are this week's whatever the date the tests run on.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(Date.UTC(2026, 9, 26, 12)) });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the board", () => {
  it("lists every task by status, and the filters narrow it with their counts", async () => {
    const { api } = await seeded();
    await openBoard(api);

    const needsYou = await group("Needs you");
    expect(within(needsYou).getByRole("button", { name: "Proposal for Alpi" })).toBeTruthy();
    expect(within(needsYou).getByText("Asks you: Who pays the insurance?")).toBeTruthy();
    expect(within(needsYou).getByText("The task wants to replace contracts.xlsx")).toBeTruthy();
    expect(within(await group("Drafts")).getByText("Brief written, not started")).toBeTruthy();
    const done = await group("Done in the last 7 days");
    expect(within(done).getByText("to check")).toBeTruthy();
    expect(within(done).getByText("Proposta.docx")).toBeTruthy();
    // Each row names its project.
    expect(within(done).getByText("Proposals")).toBeTruthy();

    const filters = screen.getByRole("radiogroup", { name: "Show" });
    expect(within(filters).getByRole("radio", { name: "Needs you 2" })).toBeTruthy();
    await click(within(filters).getByRole("radio", { name: "To check 1" }));
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
    expect(inBoard().getByRole("button", { name: "Proposal for Ferraris" })).toBeTruthy();
    await click(within(filters).getByRole("radio", { name: "Needs you 2" }));
    expect(inBoard().queryByRole("button", { name: "Proposal for Ferraris" })).toBeNull();
    expect(inBoard().getByRole("button", { name: "Supplier contracts summary" })).toBeTruthy();
  });

  it("saves a brief for later from the home's task box, and it waits in Drafts", async () => {
    const api = createMemoryApi(intermediate);
    await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
    const start = vi.spyOn(api.tasks, "start");
    render(<Root api={api} />);
    const box = await screen.findByRole("textbox", { name: "What should get done?" });
    fireEvent.change(box, { target: { value: "Draft the newsletter" } });
    await click(button("Save for later"));

    expect((box as HTMLTextAreaElement).value).toBe("");
    expect(start).not.toHaveBeenCalled();
    const [saved] = await api.tasks.listAll();
    expect(saved).toMatchObject({ status: "draft", brief: "Draft the newsletter", projectId: "p1" });
    await click(button("Board"));
    expect(within(await group("Drafts")).getByRole("button", { name: "Draft the newsletter" })).toBeTruthy();
  });

  it("saves one from New with a brief and a project", async () => {
    const api = createMemoryApi(intermediate);
    await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
    await api.projects.create({ name: "Website", folder: "/home/giulia/Website" });
    await openBoard(api);
    await click(button("New"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("What should get done"), { target: { value: "Rewrite About" } });
    fireEvent.change(within(dialog).getByLabelText("Project"), { target: { value: "p2" } });
    await click(within(dialog).getByRole("button", { name: "Save for later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await api.tasks.listAll())[0]).toMatchObject({ status: "draft", projectId: "p2", brief: "Rewrite About" });
    expect(within(await group("Drafts")).getByText("Website")).toBeTruthy();
  });

  it("starts a task saved for later from its row and goes to it", async () => {
    const { api, ids } = await seeded();
    await openBoard(api);
    const todo = await group("Drafts");
    await click(within(todo).getByRole("button", { name: "Start" }));
    // The task screen, where it works and asks its question.
    expect(await screen.findByText("Who pays the insurance?")).toBeTruthy();
    expect((await api.tasks.get(ids.later))?.status).toBe("needs-you");
  });

  it("answers an approval in place, with the task screen's words", async () => {
    const { api, ids } = await seeded();
    const decide = vi.spyOn(api.tasks, "decide");
    await openBoard(api);
    const needsYou = await group("Needs you");
    expect(within(needsYou).getByRole("button", { name: "Allow overwrite" })).toBeTruthy();
    await click(within(needsYou).getByRole("button", { name: "Save as new file" }));
    expect(decide).toHaveBeenCalledWith(ids.approving, "refuse");
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Needs you" })).queryByText(/Supplier/)).toBeNull(),
    );
  });

  it("turns an overwrite down in place, saving nothing", async () => {
    const { api, ids } = await seeded();
    const decide = vi.spyOn(api.tasks, "decide");
    await openBoard(api);
    const needsYou = await group("Needs you");
    await click(within(needsYou).getByRole("button", { name: "Don't save" }));
    expect(decide).toHaveBeenCalledWith(ids.approving, "discard");
  });

  it("answers an approval from the side panel too", async () => {
    const { api, ids } = await seeded();
    const decide = vi.spyOn(api.tasks, "decide");
    await openBoard(api);
    await click(row("Supplier contracts summary"));
    const panel = await screen.findByRole("complementary", { name: "Supplier contracts summary" });
    expect(within(panel).getByText(/contracts\.xlsx/)).toBeTruthy();
    await click(within(panel).getByRole("button", { name: "Allow overwrite" }));
    expect(decide).toHaveBeenCalledWith(ids.approving, "allow");
  });

  it("opens a summary beside the list, which Escape or a second click closes", async () => {
    const { api } = await seeded();
    await openBoard(api);
    const ferraris = await row("Proposal for Ferraris");
    await click(ferraris);
    const panel = await screen.findByRole("complementary", { name: "Proposal for Ferraris" });
    expect(within(panel).getByText("Proposal for Ferraris", { selector: "p" })).toBeTruthy();
    expect(within(panel).getByText("Proposta.docx")).toBeTruthy();
    expect(ferraris.getAttribute("aria-expanded")).toBe("true");
    await click(ferraris);
    expect(screen.queryByRole("complementary", { name: "Proposal for Ferraris" })).toBeNull();

    await click(ferraris);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("complementary", { name: "Proposal for Ferraris" })).toBeNull();

    // Open task goes to the task.
    await click(ferraris);
    const again = await screen.findByRole("complementary", { name: "Proposal for Ferraris" });
    await click(within(again).getByRole("button", { name: "Open task" }));
    expect(await screen.findByText("Check it against your brief")).toBeTruthy();
  });

  it("marks finished work checked from the side panel, which clears its to-check tag", async () => {
    const { api, ids } = await seeded();
    await openBoard(api);
    await click(row("Proposal for Ferraris"));
    const panel = await screen.findByRole("complementary", { name: "Proposal for Ferraris" });
    await click(within(panel).getByRole("button", { name: "Mark as checked" }));
    expect((await api.tasks.get(ids.finished))?.reviewedAt).toBeTruthy();
    await waitFor(() => expect(inBoard().queryByText("to check")).toBeNull());
    const filters = screen.getByRole("radiogroup", { name: "Show" });
    expect(within(filters).getByRole("radio", { name: "To check" })).toBeTruthy();
    // Nothing left to mark.
    expect(within(panel).queryByRole("button", { name: "Mark as checked" })).toBeNull();
  });

  it("groups by project from the display menu, and remembers it", async () => {
    const { api } = await seeded();
    await openBoard(api);
    await click(button("Display options"));
    await click(await screen.findByRole("menuitemradio", { name: "Project" }));
    await waitFor(async () => expect((await api.settings.get()).boardGroup).toBe("project"));
    expect(await group("Proposals")).toBeTruthy();
    expect(within(await group("Website")).getByRole("button", { name: "Write three case studies" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Drafts" })).toBeNull();
  });

  it("in columns, starts a Drafts card dropped on Running, and does nothing with other drops", async () => {
    const { api, ids } = await seeded();
    const startSaved = vi.spyOn(api.tasks, "startSaved");
    const review = vi.spyOn(api.tasks, "markReviewed");
    await openBoard(api);
    await click(button("Columns"));
    await waitFor(async () => expect((await api.settings.get()).boardView).toBe("columns"));
    const todo = await group("Drafts");
    const card = within(todo).getByRole("button", { name: "Write three case studies" });
    expect(card.getAttribute("draggable")).toBe("true");
    // A card that's working can't be picked up.
    expect(inBoard().getByRole("button", { name: "Proposal for Alpi" }).getAttribute("draggable")).toBe("false");

    // Dropped on Done, a Drafts card stays where it was.
    fireEvent.dragStart(card);
    fireEvent.dragOver(screen.getByRole("region", { name: "Done" }));
    fireEvent.drop(screen.getByRole("region", { name: "Done" }));
    fireEvent.dragEnd(card);
    expect(startSaved).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();

    fireEvent.dragStart(card);
    fireEvent.dragOver(screen.getByRole("region", { name: "Running" }));
    await act(async () => {
      fireEvent.drop(screen.getByRole("region", { name: "Running" }));
    });
    expect(startSaved).toHaveBeenCalledWith(ids.later);
    // The board stays open; the card has left Drafts.
    expect(screen.getByRole("heading", { level: 1, name: "Board" })).toBeTruthy();
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Drafts" })).queryByRole("button")).toBeNull(),
    );
  });

  it("in columns, marks a card to check dropped on Done", async () => {
    const { api, ids } = await seeded();
    await api.settings.update({ boardView: "columns" });
    await openBoard(api);
    const card = within(await group("To check")).getByRole("button", { name: "Proposal for Ferraris" });
    fireEvent.dragStart(card);
    fireEvent.dragOver(screen.getByRole("region", { name: "Done" }));
    await act(async () => {
      fireEvent.drop(screen.getByRole("region", { name: "Done" }));
    });
    expect((await api.tasks.get(ids.finished))?.reviewedAt).toBeTruthy();
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Done" })).getByRole("button", { name: "Proposal for Ferraris" }),
      ).toBeTruthy(),
    );
  });
});

describe("the finished task screen", () => {
  it("marks the work checked near its check, and opening it alone doesn't", async () => {
    const { api, ids } = await seeded();
    render(<Root api={api} />);
    await openRecent(/Proposal for Ferraris/);
    expect(await screen.findByText("Check it against your brief")).toBeTruthy();
    expect((await api.tasks.get(ids.finished))?.reviewedAt).toBeUndefined();
    const top = document.querySelector(".main .top") as HTMLElement;
    expect(within(top).getByText("to check")).toBeTruthy();
    await click(button("Mark as checked"));
    await waitFor(() => expect(within(top).queryByText("to check")).toBeNull());
    expect(screen.queryByRole("button", { name: "Mark as checked" })).toBeNull();
    expect((await api.tasks.get(ids.finished))?.reviewedAt).toBeTruthy();
  });

  it("starts a task saved for later from its screen, which has no follow-up box until then", async () => {
    const { api, ids } = await seeded();
    render(<Root api={api} />);
    await openRecent(/Write three case studies/);
    expect(await screen.findByText("Saved for later. Nothing has run yet.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Say what to do next" })).toBeNull();
    await click(button("Start"));
    expect(await screen.findByText("Who pays the insurance?")).toBeTruthy();
    expect((await api.tasks.get(ids.later))?.status).toBe("needs-you");
  });
});

describe("the task menu on the board", () => {
  const confirm = async (name: string) => {
    const card = await screen.findByRole("alertdialog");
    await click(within(card).getByRole("button", { name }));
  };

  it("opens from a row's … and from a right-click, and starts, checks and unchecks", async () => {
    const { api, ids } = await seeded();
    const menu = vi.spyOn(api.tasks, "menu");
    await openBoard(api);

    api.pickInMenu("review");
    await act(async () => {
      fireEvent.contextMenu(await row("Proposal for Ferraris"));
    });
    expect(menu).toHaveBeenLastCalledWith(ids.finished);
    await waitFor(async () => expect((await api.tasks.get(ids.finished))?.reviewedAt).toBeTruthy());
    await waitFor(() => expect(inBoard().queryByText("to check")).toBeNull());

    api.pickInMenu("unreview");
    await click(inBoard().getByRole("button", { name: "More for Proposal for Ferraris" }));
    await waitFor(async () => expect((await api.tasks.get(ids.finished))?.reviewedAt).toBeUndefined());
    expect(await inBoard().findByText("to check")).toBeTruthy();

    // Start goes to the task, as its Start button does.
    api.pickInMenu("start");
    await click(inBoard().getByRole("button", { name: "More for Write three case studies" }));
    expect(menu).toHaveBeenLastCalledWith(ids.later);
    expect(await screen.findByText("Who pays the insurance?")).toBeTruthy();
    expect((await api.tasks.get(ids.later))?.status).toBe("needs-you");
  });

  it("has a … on every card and in the side panel, and deletes after asking", async () => {
    const { api, ids } = await seeded();
    await api.settings.update({ boardView: "columns" });
    await openBoard(api);
    const card = within(await group("To check")).getByRole("button", { name: "More for Proposal for Ferraris" });
    expect(card).toBeTruthy();

    await click(inBoard().getByRole("button", { name: "Write three case studies" }));
    const panel = await screen.findByRole("complementary", { name: "Write three case studies" });
    api.pickInMenu("delete");
    await click(within(panel).getByRole("button", { name: "More for Write three case studies" }));
    await confirm("Cancel");
    expect(await api.tasks.get(ids.later)).toBeTruthy();
    await act(async () => {
      fireEvent.contextMenu(inBoard().getByRole("button", { name: "Write three case studies" }));
    });
    await confirm("Delete");
    expect(await api.tasks.get(ids.later)).toBeNull();
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Write three case studies" })).toBeNull());
    expect(inBoard().queryByRole("button", { name: "Write three case studies" })).toBeNull();
  });

  it("renames on the row, or in the panel's head when picked there", async () => {
    const { api, ids } = await seeded();
    await openBoard(api);
    api.pickInMenu("rename");
    await click(inBoard().getByRole("button", { name: "More for Write three case studies" }));
    const field = within(await group("Drafts")).getByRole("textbox", { name: "Rename" });
    fireEvent.change(field, { target: { value: "Case studies" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(await row("Case studies")).toBeTruthy();
    expect((await api.tasks.get(ids.later))?.title).toBe("Case studies");

    await click(row("Case studies"));
    const panel = await screen.findByRole("complementary", { name: "Case studies" });
    await click(within(panel).getByRole("button", { name: "More for Case studies" }));
    const inPanel = within(panel).getByRole("textbox", { name: "Rename" });
    fireEvent.change(inPanel, { target: { value: "Three case studies" } });
    // Escape keeps the old name, and leaves the panel open.
    fireEvent.keyDown(inPanel, { key: "Escape" });
    expect(within(panel).queryByRole("textbox")).toBeNull();
    expect((await api.tasks.get(ids.later))?.title).toBe("Case studies");
    expect(screen.getByRole("complementary", { name: "Case studies" })).toBeTruthy();
  });

  it("offers only what the task's state allows", async () => {
    const { api, ids } = await seeded();
    // Start isn't in a finished task's menu, so picking it there does nothing.
    api.pickInMenu("start");
    expect(await api.tasks.menu(ids.finished)).toBeNull();
    api.pickInMenu("review");
    expect(await api.tasks.menu(ids.later)).toBeNull();
    expect(await api.tasks.menu(ids.finished)).toBe("review");
  });
});

describe("a task saved for later, opened", () => {
  it("shows its brief, files and project in the task box, and saves the changes without starting", async () => {
    const api = createMemoryApi(intermediate);
    await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
    await api.projects.create({ name: "Website", folder: "/home/giulia/Website" });
    const saved = await api.tasks.saveForLater({
      projectId: "p1",
      brief: "Write three case studies",
      attachments: ["/home/giulia/notes.txt"],
    });
    const startSaved = vi.spyOn(api.tasks, "startSaved");
    render(<Root api={api} />);
    await openRecent(/Write three case studies/);

    const box = (await screen.findByRole("textbox", { name: "What should get done?" })) as HTMLTextAreaElement;
    expect(box.value).toBe("Write three case studies");
    expect(screen.getByRole("button", { name: "Remove notes.txt" })).toBeTruthy();
    const saveChanges = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    // Nothing to save until something changes.
    expect(saveChanges.disabled).toBe(true);

    fireEvent.change(box, { target: { value: "Write two case studies" } });
    await click(screen.getByRole("button", { name: "Remove notes.txt" }));
    await click(document.querySelector(".under .pick") as HTMLElement);
    await click(await screen.findByRole("menuitem", { name: "Website" }));
    await click(saveChanges);

    await waitFor(async () =>
      expect(await api.tasks.get(saved.id)).toMatchObject({
        status: "draft",
        title: "Write two case studies",
        brief: "Write two case studies",
        projectId: "p2",
        attachments: [],
      }),
    );
    expect(startSaved).not.toHaveBeenCalled();
    expect(saveChanges.disabled).toBe(true);
  });

  it("starts with the brief as edited", async () => {
    const api = createMemoryApi(intermediate);
    await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
    const saved = await api.tasks.saveForLater({ projectId: "p1", brief: "Write three case studies" });
    render(<Root api={api} />);
    await openRecent(/Write three case studies/);
    const box = await screen.findByRole("textbox", { name: "What should get done?" });
    fireEvent.change(box, { target: { value: "Write one case study, for Alpi" } });
    await click(button("Start"));

    expect(await screen.findByText("Who pays the insurance?")).toBeTruthy();
    expect(await api.tasks.get(saved.id)).toMatchObject({
      status: "needs-you",
      brief: "Write one case study, for Alpi",
    });
  });
});

describe("the home's Drafts", () => {
  it("lists the tasks saved for later, with Start, and no Recent of its own", async () => {
    const { api, ids } = await seeded();
    render(<Root api={api} />);
    const todo = await screen.findByRole("region", { name: "Drafts" });
    expect(within(todo).getByText("Write three case studies")).toBeTruthy();
    expect(within(todo).getByText("Website")).toBeTruthy();
    // Only tasks saved for later: the finished one is in the sidebar's Recent tasks, not here.
    expect(within(todo).queryByText("Proposal for Ferraris")).toBeNull();
    const main = within(document.querySelector(".main") as HTMLElement);
    expect(main.queryByText("Recent tasks")).toBeNull();

    await click(within(todo).getByRole("button", { name: "Start: Write three case studies" }));
    expect(await screen.findByText("Who pays the insurance?")).toBeTruthy();
    expect((await api.tasks.get(ids.later))?.status).toBe("needs-you");
  });

  it("opens a task from its row, and shows nothing without tasks saved for later", async () => {
    const api = createMemoryApi(intermediate);
    await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
    await api.tasks.start({ projectId: "p1", brief: "Proposal for Alpi" });
    const { unmount } = render(<Root api={api} />);
    await screen.findAllByText("Proposal for Alpi");
    expect(screen.queryByRole("region", { name: "Drafts" })).toBeNull();
    unmount();

    await api.tasks.saveForLater({ projectId: "p1", brief: "Write three case studies" });
    render(<Root api={api} />);
    const todo = await screen.findByRole("region", { name: "Drafts" });
    await click(within(todo).getByRole("button", { name: /^Write three case studies/ }));
    expect(await screen.findByText("Saved for later. Nothing has run yet.")).toBeTruthy();
  });
});

describe("the message after saving for later", () => {
  it("says where the task went from the home, and Open opens it", async () => {
    const api = createMemoryApi(intermediate);
    await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
    render(<Root api={api} />);
    const box = await screen.findByRole("textbox", { name: "What should get done?" });
    fireEvent.change(box, { target: { value: "Draft the newsletter" } });
    await click(button("Save for later"));
    const status = document.querySelector(".toasts [role=status]") as HTMLElement;
    expect(within(status).getByText("Saved to Drafts")).toBeTruthy();
    await click(within(status).getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Saved for later. Nothing has run yet.")).toBeTruthy();
    expect(within(status).queryByText("Saved to Drafts")).toBeNull();
  });

  it("comes after New on the board too, and Escape closes it", async () => {
    const api = createMemoryApi(intermediate);
    await api.projects.create({ name: "Proposals", folder: "/home/giulia/Proposals" });
    await openBoard(api);
    await click(button("New"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("What should get done"), { target: { value: "Rewrite About" } });
    await click(within(dialog).getByRole("button", { name: "Save for later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Saved to Drafts")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(screen.queryByText("Saved to Drafts")).toBeNull();
  });
});

describe("finished tasks older than a week", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 9, day, 9)).toISOString();
  const done = (id: string, day: number): Task => ({
    id,
    projectId: null,
    title: id,
    brief: id,
    attachments: [],
    workdir: "/tmp",
    model: "m",
    effort: "medium",
    status: "done",
    reviewedAt: at(day),
    steps: [],
    files: [],
    messages: [],
    question: null,
    approval: null,
    review: null,
    error: null,
    createdAt: at(day),
    updatedAt: at(day),
  });

  it("wait behind Show older at the end of Done", async () => {
    const api = createMemoryApi(intermediate);
    render(
      <Board
        api={api}
        tasks={[done("This week", 28), done("Two weeks ago", 15), done("Last month", 2)]}
        projects={[]}
        settings={{ ...DEFAULT_SETTINGS, ...intermediate }}
        onSettings={() => {}}
        allowNoProject
        onOpenTask={() => {}}
        onTaskChanged={() => {}}
        onSavedForLater={() => {}}
        onTaskMenu={() => {}}
        onError={() => {}}
        now={new Date(Date.UTC(2026, 9, 30, 12))}
      />,
    );
    const doneGroup = await group("Done in the last 7 days");
    expect(within(doneGroup).getByRole("button", { name: "This week" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Two weeks ago" })).toBeNull();
    await click(within(doneGroup).getByRole("button", { name: "Show 2 older" }));
    expect(screen.getByRole("button", { name: "Two weeks ago" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Last month" })).toBeTruthy();
    // A date for another day.
    expect(screen.getByText("28 Oct")).toBeTruthy();
    await click(screen.getByRole("button", { name: "Hide older" }));
    expect(screen.queryByRole("button", { name: "Last month" })).toBeNull();
  });

  it("puts Hide older only in the column that had older tasks", async () => {
    const api = createMemoryApi(intermediate);
    render(
      <Board
        api={api}
        tasks={[done("Last month", 2), { ...done("Saved", 29), status: "draft", reviewedAt: undefined }]}
        projects={[]}
        settings={{ ...DEFAULT_SETTINGS, ...intermediate, boardView: "columns" }}
        onSettings={() => {}}
        allowNoProject
        onOpenTask={() => {}}
        onTaskChanged={() => {}}
        onSavedForLater={() => {}}
        onTaskMenu={() => {}}
        onError={() => {}}
        now={new Date(Date.UTC(2026, 9, 30, 12))}
      />,
    );
    await click(await screen.findByRole("button", { name: "Show 1 older" }));
    expect(screen.getAllByRole("button", { name: "Hide older" })).toHaveLength(1);
  });
});

describe("a running task's line", () => {
  const at = new Date(Date.UTC(2026, 9, 26, 9)).toISOString();
  const running = (id: string, steps: Task["steps"]): Task => ({
    id,
    projectId: null,
    title: id,
    brief: id,
    attachments: [],
    workdir: "/tmp",
    model: "m",
    effort: "medium",
    status: "running",
    steps,
    files: [],
    messages: [],
    question: null,
    approval: null,
    review: null,
    error: null,
    createdAt: at,
    updatedAt: at,
  });
  const tasks = [
    running("Quiet one", []),
    running("Planned one", [
      { text: "Read the price list", status: "done" },
      { text: "Write the quote", status: "in_progress" },
      { text: "Check the totals", status: "pending" },
    ]),
  ];
  const board = (boardView: "list" | "columns") =>
    render(
      <Board
        api={createMemoryApi(intermediate)}
        tasks={tasks}
        projects={[]}
        settings={{ ...DEFAULT_SETTINGS, ...intermediate, boardView }}
        onSettings={() => {}}
        allowNoProject
        onOpenTask={() => {}}
        onTaskChanged={() => {}}
        onSavedForLater={() => {}}
        onTaskMenu={() => {}}
        onError={() => {}}
      />,
    );

  it("on a card, doesn't say again what its working tag says", async () => {
    board("columns");
    const column = await group("Running");
    expect(within(column).getByText("working")).toBeTruthy();
    expect(within(column).queryByText("Working on it")).toBeNull();
    expect(within(column).getByText("writing · 2 of 3")).toBeTruthy();
    expect(within(column).getByText("Write the quote")).toBeTruthy();
    expect(within(column).queryByText(/Step 2 of 3/)).toBeNull();
  });

  it("in the list, where the group has no tag, still says it's working and which step", async () => {
    board("list");
    const running = await group("Running");
    expect(within(running).getByText("Working on it")).toBeTruthy();
    expect(within(running).getByText("Step 2 of 3 · Write the quote")).toBeTruthy();
  });
});
