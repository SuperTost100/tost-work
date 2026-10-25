import type { EngineEvent, Review } from "../../shared/model";
import type { Engine, RunContext } from "./engine";

/** A scripted run, for building the interface before the real engine is wired. */
export interface FakeScript {
  steps: string[];
  /** Asked before this step index starts. */
  question?: { beforeStep: number; text: string; options: string[] };
  files: { path: string; kind: "add" | "update"; afterStep: number }[];
  review: Review;
  summary: string;
}

export const PROPOSAL_SCRIPT: FakeScript = {
  steps: [
    "Read the call notes",
    "Open the proposal template",
    "Draft scope and timeline",
    "Build the price table",
    "Save the Word file",
  ],
  question: {
    beforeStep: 3,
    text: "The notes don't say who pays the transport insurance. What should the proposal say?",
    options: ["The client pays it", "Include it in our price", "Leave it out and mark it as open"],
  },
  files: [
    { path: "Proposta.docx", kind: "add", afterStep: 2 },
    { path: "prezzi.xlsx", kind: "add", afterStep: 3 },
  ],
  review: {
    asked: [{ text: "A proposal from the call notes" }, { text: "Our template, all sections filled" }],
    decided: [{ text: "Travel costs are not included", detail: "The notes don't mention them" }],
    checkYourself: [{ text: "The client's VAT number", detail: "Copied from handwritten notes" }],
  },
  summary: "Done. The proposal and the price table are in the project folder.",
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

/** Replays a script with a delay between steps, and waits for real answers to its question. */
export class FakeEngine implements Engine {
  private waiting = new Map<string, (answer: string) => void>();

  constructor(
    private script: FakeScript = PROPOSAL_SCRIPT,
    private stepMs = 900,
  ) {}

  async *run({ task, workdir, signal }: RunContext): AsyncIterable<EngineEvent> {
    const s = this.script;
    const steps = s.steps.map((text) => ({ text, status: "pending" as const }));
    for (let i = 0; i < steps.length; i++) {
      if (signal.aborted) return yield { type: "stopped" };
      if (s.question && s.question.beforeStep === i) {
        const id = `${task.id}-q`;
        const answered = new Promise<string>((resolve) => this.waiting.set(id, resolve));
        yield { type: "question", question: { id, text: s.question.text, options: s.question.options } };
        const answer = await Promise.race([
          answered,
          new Promise<null>((r) => signal.addEventListener("abort", () => r(null), { once: true })),
        ]);
        this.waiting.delete(id);
        if (answer === null) return yield { type: "stopped" };
        yield { type: "message", text: `Noted: ${answer}.` };
      }
      yield {
        type: "plan",
        steps: steps.map((st, j) => ({ ...st, status: j < i ? "done" : j === i ? "in_progress" : "pending" })),
      };
      await sleep(this.stepMs, signal);
      for (const f of s.files.filter((f) => f.afterStep === i)) {
        yield { type: "file", change: { path: `${workdir}/${f.path}`, kind: f.kind, role: "made" } };
      }
    }
    if (signal.aborted) return yield { type: "stopped" };
    yield { type: "review", review: s.review };
    yield { type: "message", text: s.summary };
    yield { type: "done" };
  }

  answer(_taskId: string, questionId: string, answer: string): void {
    this.waiting.get(questionId)?.(answer);
  }

  decide(): void {
    // The script asks no approvals.
  }
}
