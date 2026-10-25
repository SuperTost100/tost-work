import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { EngineEvent, Review } from "../../shared/model";
import { freeName } from "../files";
import type { Engine, RunContext } from "./engine";

/** A scripted run, for building the interface before the real engine is wired. */
export interface FakeScript {
  steps: string[];
  /** Asked before this step index starts. */
  question?: { beforeStep: number; text: string; options: string[] };
  files: { path: string; kind: "add" | "update"; afterStep: number }[];
  /** Reports files that already exist as changed: the copies a quick edit was given, or the last file made. */
  touches?: { which: "attachments" | "last-made"; afterStep: number };
  /** Asks to delete this file, relative to the task's folder, after the step. */
  remove?: { path: string; afterStep: number };
  review?: Review;
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

/** A quick edit on files the user attached: the engine reports their copies as changed. */
export const EDIT_SCRIPT: FakeScript = {
  steps: ["Read your file", "Make the changes", "Check the result"],
  files: [],
  touches: { which: "attachments", afterStep: 1 },
  review: {
    asked: [{ text: "The changes in your message" }],
    decided: [{ text: "Kept your layout and fonts" }],
    checkYourself: [],
  },
  summary: "Done. Your original file stays as it is until you save a copy.",
};

/** One more instruction on a finished task. */
export const FOLLOW_UP_SCRIPT: FakeScript = {
  steps: ["Make the change"],
  files: [],
  touches: { which: "last-made", afterStep: 0 },
  summary: "Done, I made the change.",
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
/** Replays a script with a delay between steps, and waits for real answers to its questions and approvals. */
export class FakeEngine implements Engine {
  private waiting = new Map<string, (reply: string | boolean) => void>();

  constructor(
    private script: FakeScript = PROPOSAL_SCRIPT,
    private stepMs = 900,
    /** Folder with sample files to copy into the task's folder, so previews have something real to show. */
    private samples?: string,
  ) {}

  /** Resolves with the user's reply, or null when the task is stopped first. */
  private reply(id: string, signal: AbortSignal): Promise<string | boolean | null> {
    const replied = new Promise<string | boolean>((resolve) => this.waiting.set(id, resolve));
    const stopped = new Promise<null>((r) => signal.addEventListener("abort", () => r(null), { once: true }));
    return Promise.race([replied, stopped]).finally(() => this.waiting.delete(id));
  }

  async *run({ task, workdir, followUp, signal }: RunContext): AsyncIterable<EngineEvent> {
    const quickEdit = task.projectId === null && task.attachments.length > 0;
    const s = followUp ? FOLLOW_UP_SCRIPT : quickEdit ? EDIT_SCRIPT : this.script;
    const steps = s.steps.map((text) => ({ text, status: "pending" as const }));
    for (let i = 0; i < steps.length; i++) {
      if (signal.aborted) return yield { type: "stopped" };
      if (s.question && s.question.beforeStep === i) {
        const id = `${task.id}-q`;
        const answer = this.reply(id, signal);
        yield { type: "question", question: { id, text: s.question.text, options: s.question.options } };
        const reply = await answer;
        if (reply === null) return yield { type: "stopped" };
        yield { type: "message", text: `Noted: ${reply}.` };
      }
      yield {
        type: "plan",
        steps: steps.map((st, j) => ({ ...st, status: j < i ? "done" : j === i ? "in_progress" : "pending" })),
      };
      await sleep(this.stepMs, signal);
      for (const f of s.files.filter((f) => f.afterStep === i)) {
        // Stop can land during the sleep above, and a stopped task writes nothing more.
        if (signal.aborted) return yield { type: "stopped" };
        let path = join(workdir, f.path);
        if (this.samples) {
          await mkdir(workdir, { recursive: true });
          // A file already in the folder (or a link left at its name) is replaced only when the user allows it,
          // as the real agent must; otherwise the sample goes under a free name with an exclusive copy.
          const free = await freeName(workdir, f.path);
          let replace = false;
          if (free !== path) {
            const id = `${task.id}-o${i}`;
            const decision = this.reply(id, signal);
            yield { type: "approval", approval: { id, action: "overwrite", paths: [path] } };
            const allowed = await decision;
            if (allowed === null) return yield { type: "stopped" };
            replace = allowed === true;
          }
          if (!replace) path = free;
          await copyFile(join(this.samples, f.path), path, replace ? 0 : constants.COPYFILE_EXCL);
        }
        yield { type: "file", change: { path, kind: f.kind, role: "made" } };
      }
      if (s.touches?.afterStep === i) {
        const lastMade = task.files.filter((f) => f.role === "made" && f.kind !== "delete").at(-1)?.path;
        const paths = s.touches.which === "attachments" ? task.attachments : lastMade ? [lastMade] : [];
        for (const path of paths) yield { type: "file", change: { path, kind: "update", role: "made" } };
      }
      if (s.remove?.afterStep === i) {
        const path = join(workdir, s.remove.path);
        const id = `${task.id}-d${i}`;
        const decision = this.reply(id, signal);
        yield { type: "approval", approval: { id, action: "delete", paths: [path] } };
        const allowed = await decision;
        if (allowed === null) return yield { type: "stopped" };
        // Tost Work moved the file to the Trash before passing the decision on, so the engine only reports it.
        if (allowed) yield { type: "file", change: { path, kind: "delete", role: "made" } };
      }
    }
    if (signal.aborted) return yield { type: "stopped" };
    if (s.review) yield { type: "review", review: s.review };
    yield { type: "message", text: s.summary };
    yield { type: "done" };
  }

  answer(_taskId: string, questionId: string, answer: string): void {
    this.waiting.get(questionId)?.(answer);
  }

  decide(_taskId: string, approvalId: string, allow: boolean): void {
    this.waiting.get(approvalId)?.(allow);
  }
}
