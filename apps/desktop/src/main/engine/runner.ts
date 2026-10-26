import { randomUUID } from "node:crypto";
import type { AgentProvider, Approval, KeptCopy, Project, Task } from "../../shared/model";
import { applyEvent, resume } from "../../shared/reduce";
import type { Guard } from "../guard";
import type { Store } from "../store/store";
import type { Engine } from "./engine";

export interface NewTask {
  projectId: string | null;
  brief: string;
  workdir: string;
  attachments?: string[];
  provider?: AgentProvider;
  auth?: "account" | "key";
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

/** What the agent hears when the user decides on an approval after its turn ended. */
export function decisionNote(approval: Approval, allow: boolean): string {
  const files = approval.paths.join(", ");
  if (approval.action === "delete")
    return allow
      ? `The user allowed deleting ${files}, and Tost Work moved them to the Trash. Don't delete them again. Carry on.`
      : `The user wants to keep ${files}. Leave them as they are and carry on.`;
  return allow
    ? `The user allowed replacing ${files}. Tost Work kept a copy of the current version, so go ahead and replace it.`
    : `The user wants to keep ${files} as it is. Save your version under a new name.`;
}

/** Starts tasks on an engine, keeps each task's state in the store and reports every change. */
export class TaskRunner {
  private running = new Map<string, AbortController>();
  /** A reply that came while the run that asked was still ending its turn. It starts the next run. */
  private queued = new Map<string, string>();
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

  defaults(): Promise<{ provider: AgentProvider; auth?: "account" | "key"; model: string; effort: string }> {
    return this.engine.defaults();
  }

  create(input: NewTask): Task {
    const at = this.now();
    const task: Task = {
      id: randomUUID(),
      projectId: input.projectId,
      title: titleFrom(input.brief),
      brief: input.brief,
      attachments: input.attachments ?? [],
      workdir: input.workdir,
      provider: input.provider ?? "codex",
      ...(input.auth === "key" ? { auth: "key" as const } : {}),
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
        // A reply already waits for the next run, so this run's end isn't the task's: it stays running.
        if (event.type === "done" && this.queued.has(taskId)) continue;
        // Read the stored task each time, so an answer saved meanwhile isn't overwritten.
        task = this.save(applyEvent(this.mustGet(taskId), event, this.now()));
      }
      // The stored task, not the last snapshot: a rename may have landed while the engine finished.
      const latest = this.mustGet(taskId);
      task =
        latest.status === "running" && !this.queued.has(taskId)
          ? this.save(applyEvent(latest, { type: "done" }, this.now()))
          : latest;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      task = this.save(applyEvent(this.mustGet(taskId), { type: "failed", error: message }, this.now()));
    } finally {
      this.running.delete(taskId);
    }
    const next = this.queued.get(taskId);
    this.queued.delete(taskId);
    if (next !== undefined && task.status !== "stopped" && task.status !== "failed") this.launch(taskId, next);
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
    if (!this.engine.answer(taskId, task.question.id, answer))
      this.continueWith(taskId, `My answer to your question "${task.question.text}": ${answer}`);
    return next;
  }

  /** Sends the user's reply to an agent that ended its turn to wait for it, now or once the turn has ended. */
  private continueWith(taskId: string, prompt: string): void {
    if (this.running.has(taskId)) this.queued.set(taskId, prompt);
    else this.launch(taskId, prompt);
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
    if (this.restoring.has(taskId)) throw new Error("Wait for the restore to finish");
    this.deciding.add(taskId);
    try {
      const kept: KeptCopy[] = [];
      const trashed: string[] = [];
      // Files in the Trash are gone from the task too, whatever the engine reports next, and even after a Stop.
      const record = (t: Task) => {
        let next = t;
        for (const path of trashed)
          next = applyEvent(next, { type: "file", change: { path, kind: "delete", role: "made" } }, this.now());
        return { ...next, kept: [...(next.kept ?? []), ...kept] };
      };
      if (allow) {
        try {
          for (const path of approval.paths) {
            if (approval.done?.includes(path)) continue;
            if (approval.action === "delete") {
              await this.guard.trash(task, path);
              trashed.push(path);
            } else kept.push(await this.guard.keep(task, path, "overwrite"));
          }
        } catch (err) {
          // What was done before the failure stays recorded: a file already in the Trash, a copy already kept.
          if (trashed.length || kept.length) {
            const latest = record(this.mustGet(taskId));
            const handled = [...(approval.done ?? []), ...trashed, ...kept.map((k) => k.path)];
            // A retry of the same approval skips what's done; a file already in the Trash can't be trashed again.
            const pending = latest.approval?.id === approval.id ? { ...approval, done: handled } : latest.approval;
            this.save({ ...latest, approval: pending, updatedAt: this.now() });
          }
          throw err;
        }
      }
      const current = record(this.mustGet(taskId));
      // Stop can land while the copies or the Trash are being done. Then the task stays as it is, with the copies
      // recorded, rather than going back to running with nothing running it.
      if (current.status !== "needs-you" || current.approval?.id !== approval.id)
        return allow ? this.save({ ...current, updatedAt: this.now() }) : current;
      const next = this.save(resume(current, this.now()));
      if (!this.engine.decide(taskId, approval.id, allow)) this.continueWith(taskId, decisionNote(approval, allow));
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
    // Stop can end the run while a decision still copies or trashes files; the restore waits for it.
    if (this.deciding.has(taskId)) throw new Error("Wait for the decision to finish");
    const latest = (task.kept ?? []).filter((k) => k.path === path).at(-1);
    if (!latest) throw new Error("There's no kept copy of that file");
    this.restoring.add(taskId);
    try {
      // The version being replaced is kept so Undo can bring it back. A file removed since has nothing to keep.
      const current = await this.guard.keep(task, path, "restore").catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return null;
        throw err;
      });
      await this.guard.restore(task, latest);
      // Read the task again: it may have changed while the files were copied.
      const fresh = this.mustGet(taskId);
      const kept = current ? [...(fresh.kept ?? []), current] : (fresh.kept ?? []);
      return this.save({ ...fresh, kept, updatedAt: this.now() });
    } finally {
      this.restoring.delete(taskId);
    }
  }

  /** Gives the task a name of the user's choosing. Its place in Recent stays where it was. */
  rename(taskId: string, title: string): Task {
    const name = title.trim();
    if (!name) throw new Error("A task needs a name");
    return this.save({ ...this.mustGet(taskId), title: name });
  }

  /** Removes the task from Tost Work. The files it made or used stay where they are. */
  remove(taskId: string): void {
    this.mustGet(taskId);
    if (this.running.has(taskId) || this.deciding.has(taskId) || this.restoring.has(taskId))
      throw new Error("Stop the task before deleting it");
    this.queued.delete(taskId);
    this.store.deleteTask(taskId);
  }

  stop(taskId: string): void {
    this.queued.delete(taskId);
    const run = this.running.get(taskId);
    if (run) {
      run.abort();
      return;
    }
    // A task waiting for the user may have no run left: its agent ended the turn to wait.
    const task = this.store.getTask(taskId);
    if (task?.status === "needs-you") this.save(applyEvent(task, { type: "stopped" }, this.now()));
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
