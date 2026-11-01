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
    expect(within(await group("To do")).getByText("Brief written, not started")).toBeTruthy();
    const done = await group("Done in the last 7 days");
    expect(within(done).getByText("to review")).toBeTruthy();
    expect(within(done).getByText("Proposta.docx")).toBeTruthy();
    // Each row names its project.
    expect(within(done).getByText("Proposals")).toBeTruthy();

    const filters = screen.getByRole("radiogroup", { name: "Show" });
    expect(within(filters).getByRole("radio", { name: "Needs you 2" })).toBeTruthy();
    await click(within(filters).getByRole("radio", { name: "To review 1" }));
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
    expect(inBoard().getByRole("button", { name: "Proposal for Ferraris" })).toBeTruthy();
    await click(within(filters).getByRole("radio", { name: "Needs you 2" }));
    expect(inBoard().queryByRole("button", { name: "Proposal for Ferraris" })).toBeNull();
    expect(inBoard().getByRole("button", { name: "Supplier contracts summary" })).toBeTruthy();
  });

  it("saves a brief for later from the home's task box, and it waits in To do", async () => {
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
    expect(within(await group("To do")).getByRole("button", { name: "Draft the newsletter" })).toBeTruthy();
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
    expect(within(await group("To do")).getByText("Website")).toBeTruthy();
  });

  it("starts a task saved for later from its row and goes to it", async () => {
    const { api, ids } = await seeded();
    await openBoard(api);
    const todo = await group("To do");
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
    expect(decide).toHaveBeenCalledWith(ids.approving, false);
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Needs you" })).queryByText(/Supplier/)).toBeNull(),
    );
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

  it("marks finished work reviewed from the side panel, which clears its to-review tag", async () => {
    const { api, ids } = await seeded();
    await openBoard(api);
    await click(row("Proposal for Ferraris"));
    const panel = await screen.findByRole("complementary", { name: "Proposal for Ferraris" });
    await click(within(panel).getByRole("button", { name: "Mark reviewed" }));
    expect((await api.tasks.get(ids.finished))?.reviewedAt).toBeTruthy();
    await waitFor(() => expect(inBoard().queryByText("to review")).toBeNull());
    const filters = screen.getByRole("radiogroup", { name: "Show" });
    expect(within(filters).getByRole("radio", { name: "To review" })).toBeTruthy();
    // Nothing left to mark.
    expect(within(panel).queryByRole("button", { name: "Mark reviewed" })).toBeNull();
  });

  it("groups by project from the display menu, and remembers it", async () => {
    const { api } = await seeded();
    await openBoard(api);
    await click(button("Display options"));
    await click(await screen.findByRole("menuitemradio", { name: "Project" }));
    await waitFor(async () => expect((await api.settings.get()).boardGroup).toBe("project"));
    expect(await group("Proposals")).toBeTruthy();
    expect(within(await group("Website")).getByRole("button", { name: "Write three case studies" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "To do" })).toBeNull();
  });

  it("in columns, starts a To do card dropped on Running, and does nothing with other drops", async () => {
    const { api, ids } = await seeded();
    const startSaved = vi.spyOn(api.tasks, "startSaved");
    const review = vi.spyOn(api.tasks, "markReviewed");
    await openBoard(api);
    await click(button("Columns"));
    await waitFor(async () => expect((await api.settings.get()).boardView).toBe("columns"));
    const todo = await group("To do");
    const card = within(todo).getByRole("button", { name: "Write three case studies" });
    expect(card.getAttribute("draggable")).toBe("true");
    // A card that's working can't be picked up.
    expect(inBoard().getByRole("button", { name: "Proposal for Alpi" }).getAttribute("draggable")).toBe("false");

    // Dropped on Done, a To do card stays where it was.
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
    // The board stays open; the card has left To do.
    expect(screen.getByRole("heading", { level: 1, name: "Board" })).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "To do" })).queryByRole("button")).toBeNull());
  });

  it("in columns, marks a card to review dropped on Done", async () => {
    const { api, ids } = await seeded();
    await api.settings.update({ boardView: "columns" });
    await openBoard(api);
    const card = within(await group("To review")).getByRole("button", { name: "Proposal for Ferraris" });
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
  it("marks the work reviewed near its check, and opening it alone doesn't", async () => {
    const { api, ids } = await seeded();
    render(<Root api={api} />);
    await openRecent(/Proposal for Ferraris/);
    expect(await screen.findByText("Check it against your brief")).toBeTruthy();
    expect((await api.tasks.get(ids.finished))?.reviewedAt).toBeUndefined();
    const top = document.querySelector(".main .top") as HTMLElement;
    expect(within(top).getByText("to review")).toBeTruthy();
    await click(button("Mark reviewed"));
    await waitFor(() => expect(within(top).queryByText("to review")).toBeNull());
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
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
        onError={() => {}}
        now={new Date(Date.UTC(2026, 9, 30, 12))}
      />,
    );
    await click(await screen.findByRole("button", { name: "Show 1 older" }));
    expect(screen.getAllByRole("button", { name: "Hide older" })).toHaveLength(1);
  });
});
