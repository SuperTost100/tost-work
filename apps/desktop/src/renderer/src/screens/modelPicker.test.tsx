import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "@/lib/memoryApi";
import { Root } from "@/Root";
import type { Settings } from "../../../shared/model";

// Find first, then act: waiting inside act holds back the updates the wait is for.
const click = async (target: HTMLElement | Promise<HTMLElement>) => {
  const el = await target;
  await act(async () => {
    fireEvent.click(el);
  });
};
const picker = (name: string | RegExp) => screen.findByRole("button", { name });
const choice = (name: string | RegExp) => screen.findByRole("menuitemradio", { name });

const open = async (settings: Partial<Settings> = {}) => {
  const api = createMemoryApi({ name: "Giulia", setupDone: true, ...settings });
  render(<Root api={api} />);
  await click(picker(/AI for this task|AI per questa attività/));
  return api;
};

const start = async (brief: string) => {
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: brief } });
  await click(screen.getByRole("button", { name: "Start task" }));
};

describe("the model picker under the task box", () => {
  it("offers the three choices at Beginner, with the middle one picked and no model named", async () => {
    await open();
    const fast = await choice(/Fast/);
    expect(fast.textContent).toContain("Answers quickly. For simple jobs: an email, a summary, a correction.");
    expect((await choice(/Balanced/)).getAttribute("aria-checked")).toBe("true");
    expect(fast.getAttribute("aria-checked")).toBe("false");
    const thorough = await choice(/Thorough/);
    expect(thorough.textContent).toContain("It uses up your subscription's limits sooner.");
    // Beginner sees choices, not model names.
    expect(screen.queryByText(/GPT-6/)).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Choose the model…" })).toBeTruthy();
  });

  it("names the model and level behind each choice from Advanced up", async () => {
    await open({ level: "advanced" });
    expect((await choice(/Fast/)).textContent).toContain("GPT-6 Luna · medium");
    expect((await choice(/Balanced/)).textContent).toContain("GPT-6.1 Terra · medium");
    expect((await choice(/Thorough/)).textContent).toContain("GPT-6.1 Sol · high");
  });

  it("does not name models at Intermediate", async () => {
    await open({ level: "intermediate" });
    await choice(/Fast/);
    expect(screen.queryByText(/GPT-6/)).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Choose the model…" })).toBeTruthy();
  });

  it("starts the task on the choice made, and remembers it for the next one", async () => {
    const api = await open();
    await click(choice(/Thorough/));
    expect((await picker(/AI for this task/)).textContent).toContain("Thorough");
    await waitFor(async () => expect((await api.settings.get()).modelPick).toEqual({ preset: "thorough" }));
    await start("Write a proposal for Alpi Logistica");
    const [task] = await api.tasks.list();
    expect(task).toMatchObject({ provider: "codex", model: "gpt-6.1-sol", effort: "high" });
  });

  it("starts on the middle choice when nothing was picked", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    render(<Root api={api} />);
    await screen.findByRole("button", { name: /AI for this task: Balanced/ });
    await start("Write a proposal for Alpi Logistica");
    const [task] = await api.tasks.list();
    expect(task).toMatchObject({ model: "gpt-6.1-terra", effort: "medium" });
  });

  it("offers the last pick again in the next session", async () => {
    await open({ modelPick: { preset: "fast" } });
    expect((await choice(/Fast/)).getAttribute("aria-checked")).toBe("true");
  });

  it("opens the full list at Beginner, and a model from it can switch the AI for the task", async () => {
    const api = await open();
    await click(screen.getByRole("menuitem", { name: "Choose the model…" }));
    // The signed-in AIs are sections, each with its models.
    expect(await screen.findByText("ChatGPT")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "GPT-6.1 Terra" }).getAttribute("aria-checked")).toBe("true");
    await click(screen.getByRole("menuitemradio", { name: "Claude Sonnet 5.5" }));
    // The reasoning level offers the five usual levels, and leaves out exotic ones.
    const efforts = screen.getAllByRole("menuitemradio").map((r) => r.textContent);
    expect(efforts.slice(-5)).toEqual(["Low", "Medium", "High", "Very high", "Maximum"]);
    await click(screen.getByRole("menuitemradio", { name: "Maximum" }));
    await waitFor(async () =>
      expect((await api.settings.get()).modelPick).toEqual({
        ai: "claude",
        model: "claude-sonnet-5-5",
        effort: "max",
      }),
    );
    // Esc closes the menu; the button shows the model and level.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect((await picker(/AI for this task/)).textContent).toBe("Claude Sonnet 5.5 · Maximum");
    await start("Write a proposal for Alpi Logistica");
    const [task] = await api.tasks.list();
    expect(task).toMatchObject({ provider: "claude", model: "claude-sonnet-5-5", effort: "max" });
  });

  it("lists only the newest model of each family, and keeps the one picked even when it's older", async () => {
    const model = (id: string, name: string) => ({ id, name, efforts: ["low", "medium", "high"] });
    const choices = {
      ai: "chatgpt" as const,
      provider: "codex" as const,
      lists: [
        {
          ai: "chatgpt" as const,
          provider: "codex" as const,
          models: [
            model("gpt-6.1-sol", "GPT-6.1-Sol"),
            model("gpt-6-sol", "GPT-6-Sol"),
            model("gpt-5.6-sol", "GPT-5.6-Sol"),
            model("gpt-6.1-terra", "GPT-6.1-Terra"),
          ],
        },
      ],
    };
    const api = createMemoryApi({
      name: "Giulia",
      setupDone: true,
      modelPick: { ai: "chatgpt", model: "gpt-6-sol", effort: "medium" },
    });
    api.models.choices = async () => choices;
    render(<Root api={api} />);
    await click(picker(/AI for this task|AI per questa attività/));
    await click(screen.getByRole("menuitem", { name: "Choose the model…" }));
    await screen.findByText("ChatGPT");
    const names = screen.getAllByRole("menuitemradio").map((r) => r.textContent);
    // GPT-6 Sol is older than GPT-6.1 Sol but it's the pick, so it stays; GPT-5.6 Sol goes.
    expect(names.slice(0, 3)).toEqual(["GPT-6.1 Sol", "GPT-6 Sol", "GPT-6.1 Terra"]);
    expect(screen.queryByRole("menuitemradio", { name: "GPT-5.6 Sol" })).toBeNull();
  });

  it("goes back from the full list to the three choices", async () => {
    await open();
    await click(screen.getByRole("menuitem", { name: "Choose the model…" }));
    await click(await screen.findByRole("menuitem", { name: "Back to the three choices" }));
    expect(await choice(/Fast/)).toBeTruthy();
  });

  it("is on a project's page too, and starts the project's task on the choice", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    const project = await api.projects.create({ name: "Preventivi", folder: "/p" });
    render(<Root api={api} />);
    await click(await screen.findByRole("button", { name: "Projects" }));
    await click(await screen.findByText(project.name));
    await click(picker(/AI for this task/));
    await click(choice(/Fast/));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Check the totals" } });
    await click(screen.getByRole("button", { name: "Start task" }));
    const [task] = await api.tasks.list();
    expect(task).toMatchObject({ projectId: project.id, model: "gpt-6-luna", effort: "medium" });
  });

  it("is in the editor of a task saved for later, and starts that task on the choice", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    const saved = await api.tasks.saveForLater({ projectId: null, brief: "Sort the invoices" });
    render(<Root api={api} />);
    // The sidebar lists the task too; the home's To do row opens it.
    await click(await screen.findByRole("button", { name: /Sort the invoices\s*Quick edit/ }));
    await click(picker(/AI for this task/));
    await click(choice(/Thorough/));
    await click(await screen.findByRole("button", { name: "Start" }));
    // The sample task stops at its first question.
    await waitFor(async () => expect((await api.tasks.get(saved.id))?.status).toBe("needs-you"));
    expect(await api.tasks.get(saved.id)).toMatchObject({ model: "gpt-6.1-sol", effort: "high" });
  });

  it("does not show up on a task that is running", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    render(<Root api={api} />);
    await start("Write a proposal for Alpi Logistica");
    await screen.findByText("Who pays the insurance?");
    expect(screen.queryByRole("button", { name: /AI for this task/ })).toBeNull();
  });

  it("speaks Italian", async () => {
    await open({ language: "it" });
    expect((await choice(/Veloce/)).textContent).toContain("Risponde in fretta.");
    expect((await choice(/Approfondito/)).textContent).toContain("Consuma prima i limiti del tuo abbonamento.");
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Scegli il modello…" })).toBeTruthy();
  });

  it("keeps the latest pick when an earlier save answers after it", async () => {
    const api = createMemoryApi({ name: "Giulia", setupDone: true });
    const update = api.settings.update.bind(api.settings);
    let first: (() => void) | undefined;
    let calls = 0;
    api.settings.update = (patch) => {
      calls += 1;
      if (calls > 1) return update(patch);
      // The first save answers only once the second has.
      return new Promise((resolve) => {
        first = () => void update(patch).then(resolve);
      });
    };
    render(<Root api={api} />);
    await click(picker(/AI for this task/));
    await click(choice(/Fast/));
    await click(picker(/AI for this task/));
    await click(choice(/Thorough/));
    await act(async () => {
      first?.();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /AI for this task/ }).textContent).toContain("Thorough"),
    );
  });

  it("says the middle choice, not an old model, when a remembered pick can no longer run", async () => {
    // A model on an AI that isn't on offer any more: the task would start on the default AI's middle choice.
    const api = createMemoryApi({
      name: "Giulia",
      setupDone: true,
      modelPick: { ai: "claude", model: "claude-opus-4-1", effort: "max" },
    });
    render(<Root api={api} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /AI for this task/ }).textContent).toBe("Balanced"));
  });
});
