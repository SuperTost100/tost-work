import { randomUUID } from "node:crypto";
import type { Project, Task } from "../../shared/model";
import { applyEvent, resume } from "../../shared/reduce";
import type { Store } from "../store/store";
import type { Engine } from "./engine";

export interface NewTask {
  projectId: string | null;
  brief: string;
  workdir: string;
  attachments?: string[];
  model?: string;
  effort?: string;
}

/** The first line of the brief, cut at a word, as the task's title until the agent names it. */
export function titleFrom(brief: string, max = 60): string {
  const line = brief.trim().split("\n")[0] ?? "";
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > 20 ? cut.slice(0, space) : cut}…`;
}

/** Starts tasks on an engine, keeps each task's state in the store and reports every change. */
export class TaskRunner {
  private running = new Map<string, AbortController>();

  constructor(
    private store: Store,
    private engine: Engine,
    private onChange: (task: Task) => void,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  create(input: NewTask): Task {
    const at = this.now();
    const task: Task = {
      id: randomUUID(),
      projectId: input.projectId,
      title: titleFrom(input.brief),
      brief: input.brief,
      attachments: input.attachments ?? [],
      workdir: input.workdir,
      model: input.model ?? "gpt-5.5",
      effort: input.effort ?? "medium",
      status: "draft",
      steps: [],
      files: [],
      messages: [{ from: "user", text: input.brief, at }],
      question: null,
      approval: null,
      review: null,
      error: null,
      createdAt: at,
      updatedAt: at,
    };
    this.save(task);
    return task;
  }

  /**
   * Runs the task to the end. Resolves with the final task; questions pause it until `answer` is called.
   * Pass the user's message as `followUp` to continue a task that already finished.
   */
  async start(taskId: string, followUp: string | null = null): Promise<Task> {
    let task = this.mustGet(taskId);
    const workdir = task.workdir;
    if (this.running.has(taskId)) throw new Error("This task is already running");
    const project: Project | null = task.projectId ? (this.store.getProject(task.projectId) ?? null) : null;
    const controller = new AbortController();
    this.running.set(taskId, controller);
    try {
      task = this.save({ ...task, status: "running", error: null, updatedAt: this.now() });
      for await (const event of this.engine.run({ task, project, workdir, followUp, signal: controller.signal })) {
        // Read the stored task each time, so an answer saved meanwhile isn't overwritten.
        task = this.save(applyEvent(this.mustGet(taskId), event, this.now()));
      }
      if (task.status === "running") task = this.save(applyEvent(task, { type: "done" }, this.now()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      task = this.save(applyEvent(this.mustGet(taskId), { type: "failed", error: message }, this.now()));
    } finally {
      this.running.delete(taskId);
    }
    return task;
  }

  /** Starts the task without waiting for it. A failure the task couldn't record itself is logged, so it can't crash the app. */
  launch(taskId: string, followUp: string | null = null): void {
    this.start(taskId, followUp).catch((err: unknown) => {
      console.error(`Task ${taskId} failed and its state couldn't be saved`, err);
    });
  }

  answer(taskId: string, answer: string): Task {
    const task = this.mustGet(taskId);
    if (!task.question) throw new Error("This task isn't waiting for an answer");
    const at = this.now();
    const next = this.save({ ...resume(task, at), messages: [...task.messages, { from: "user", text: answer, at }] });
    this.engine.answer(taskId, task.question.id, answer);
    return next;
  }

  /** Adds the user's next instruction to a task that isn't working. Call `launch` with the same text to run it. */
  followUp(taskId: string, text: string): Task {
    const task = this.mustGet(taskId);
    if (this.running.has(taskId)) throw new Error("This task is still working");
    if (task.question || task.approval) throw new Error("This task is waiting for an answer");
    const at = this.now();
    // The old review checked the old brief, so it goes until the agent writes a new one.
    return this.save({
      ...task,
      review: null,
      error: null,
      messages: [...task.messages, { from: "user", text, at, followUp: true }],
      updatedAt: at,
    });
  }

  stop(taskId: string): void {
    this.running.get(taskId)?.abort();
  }

  isRunning(taskId: string): boolean {
    return this.running.has(taskId);
  }

  private mustGet(id: string): Task {
    const task = this.store.getTask(id);
    if (!task) throw new Error(`No task with id ${id}`);
    return task;
  }

  private save(task: Task): Task {
    this.store.saveTask(task);
    try {
      this.onChange(task);
    } catch {
      // A failed notification must not fail the task: the task is saved, and the window reloads it from the store.
    }
    return task;
  }
}
