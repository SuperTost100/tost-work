import { randomUUID } from "node:crypto";
import type { KeptCopy, Project, Task } from "../../shared/model";
import { applyEvent, resume } from "../../shared/reduce";
import type { Guard } from "../guard";
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

const REFUSE: Guard = {
  keep: () => Promise.reject(new Error("No guard is set up to keep copies")),
  trash: () => Promise.reject(new Error("No guard is set up to move files to the Trash")),
  restore: () => Promise.reject(new Error("No guard is set up to restore copies")),
};

/** Starts tasks on an engine, keeps each task's state in the store and reports every change. */
export class TaskRunner {
  private running = new Map<string, AbortController>();
  /** Tasks whose decision is being carried out, so a double click can't trash or copy twice. */
  private deciding = new Set<string>();
  /** Tasks with a restore under way, so a double click can't record two copies from one snapshot. */
  private restoring = new Set<string>();

  constructor(
    private store: Store,
    private engine: Engine,
    private onChange: (task: Task) => void,
    private now: () => string = () => new Date().toISOString(),
    private guard: Guard = REFUSE,
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
    // A run started now could write to a file the restore is about to put back.
    if (this.restoring.has(taskId)) throw new Error("Wait for the restore to finish");
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

  /**
   * Carries out the user's decision on an overwrite or delete, then tells the engine. Allowed overwrites keep a copy
   * first and allowed deletions go to the Trash, both done here so they don't depend on the agent.
   */
  async decide(taskId: string, allow: boolean): Promise<Task> {
    const task = this.mustGet(taskId);
    const approval = task.approval;
    if (!approval) throw new Error("This task isn't waiting for a decision");
    if (this.deciding.has(taskId)) throw new Error("This decision is already being carried out");
    this.deciding.add(taskId);
    try {
      const kept: KeptCopy[] = [];
      if (allow) {
        for (const path of approval.paths) {
          if (approval.action === "delete") await this.guard.trash(task, path);
          else kept.push(await this.guard.keep(task, path, "overwrite"));
        }
      }
      let current = this.mustGet(taskId);
      // Files in the Trash are gone from the task too, whatever the engine reports next, and even after a Stop.
      if (allow && approval.action === "delete")
        for (const path of approval.paths)
          current = applyEvent(current, { type: "file", change: { path, kind: "delete", role: "made" } }, this.now());
      const allKept = [...(current.kept ?? []), ...kept];
      // Stop can land while the copies or the Trash are being done. Then the task stays as it is, with the copies
      // recorded, rather than going back to running with nothing running it.
      if (current.status !== "needs-you" || current.approval?.id !== approval.id)
        return allow ? this.save({ ...current, kept: allKept, updatedAt: this.now() }) : current;
      const next = this.save({ ...resume(current, this.now()), kept: allKept });
      this.engine.decide(taskId, approval.id, allow);
      return next;
    } finally {
      this.deciding.delete(taskId);
    }
  }

  /** Puts back the newest kept copy of a file. The version it replaces is kept too, so restoring can be undone. */
  async restore(taskId: string, path: string): Promise<Task> {
    const task = this.mustGet(taskId);
    if (this.running.has(taskId)) throw new Error("Wait for the task to finish before restoring");
    if (this.restoring.has(taskId)) throw new Error("A restore is already in progress");
    const latest = (task.kept ?? []).filter((k) => k.path === path).at(-1);
    if (!latest) throw new Error("There's no kept copy of that file");
    this.restoring.add(taskId);
    try {
      const current = await this.guard.keep(task, path, "restore");
      await this.guard.restore(task, latest);
      // Read the task again: it may have changed while the files were copied.
      const fresh = this.mustGet(taskId);
      return this.save({ ...fresh, kept: [...(fresh.kept ?? []), current], updatedAt: this.now() });
    } finally {
      this.restoring.delete(taskId);
    }
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
