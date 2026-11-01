import { randomUUID } from "node:crypto";
import type { AgentProvider, Approval, KeptCopy, Project, Task } from "../../shared/model";
import { answersText, BRIEF_MAX, questionItems } from "../../shared/model";
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
  /** For a run of a job: the job, and the title its tasks carry. */
  jobId?: string;
  title?: string;
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
/** What the agent hears when a task resumes after Tost Work closed during its turn. */
/** The task's files with a message's added, each once. */
const joined = (had: string[], more: string[]) => [...new Set([...had, ...more])];

/** The user's message to the agent, with the files they attached to it. */
export function withFiles(text: string, files: string[]): string {
  return files.length ? `${text}\n\nFiles I attached to this message:\n${files.map((p) => `- ${p}`).join("\n")}` : text;
}

export const RESUME_PROMPT =
  "Tost Work closed while you were working on this task, so your last turn was cut short. Check what you had already done in the folder, then carry on where you left off.";

export class TaskRunner {
  private running = new Map<string, AbortController>();
  /** Resolves when a task's run has ended and saved its last state. */
  private ended = new Map<string, Promise<void>>();
  /** Projects being removed, which take no new task. */
  private removing = new Set<string>();
  /** A reply that came while the run that asked was still ending its turn. It starts the next run. */
  private queued = new Map<string, string>();
  /** Tasks whose decision is being carried out, so a double click can't trash or copy twice. */
  private deciding = new Set<string>();
  /** Tasks with a restore under way, so a double click can't record two copies from one snapshot. */
  private restoring = new Set<string>();
  /** The answer each run is writing, so far: a window opened meanwhile picks it up from here. */
  private drafts = new Map<string, string>();
  /** Tasks saved for later that are being started, so a double click can't start one twice. */
  private starting = new Set<string>();

  constructor(
    private store: Store,
    private engine: Engine,
    private onChange: (task: Task) => void,
    private now: () => string = () => new Date().toISOString(),
    private guard: Guard = REFUSE,
    private onText: (taskId: string, text: string, restart?: boolean) => void = () => {},
  ) {}

  /** What the running task's agent has written of its answer so far, or "" between answers. */
  draft(taskId: string): string {
    return this.drafts.get(taskId) ?? "";
  }

  defaults(): Promise<{ provider: AgentProvider; auth?: "account" | "key"; model: string; effort: string }> {
    return this.engine.defaults();
  }

  create(input: NewTask): Task {
    // A start that was on its way while the project was being removed doesn't get to add a task to it.
    if (input.projectId && this.removing.has(input.projectId)) throw new Error("That project doesn't exist");
    const at = this.now();
    const task: Task = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title ?? titleFrom(input.brief),
      brief: input.brief,
      attachments: input.attachments ?? [],
      workdir: input.workdir,
      provider: input.provider ?? "codex",
      ...(input.auth === "key" ? { auth: "key" as const } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      model: input.model ?? "gpt-5.5",
      effort: input.effort ?? "medium",
      status: "draft",
      steps: [],
      files: [],
      messages: [
        {
          from: "user",
          text: input.brief,
          at,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        },
      ],
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
    let release = () => {};
    this.ended.set(taskId, new Promise<void>((resolve) => (release = resolve)));
    try {
      // An interrupted task stays resumable until its run really starts: a resume that fails at once, for example
      // offline, leaves Resume on the task to try again.
      task = this.save({ ...task, status: "running", error: null, updatedAt: this.now() });
      for await (const event of this.engine.run({ task, project, workdir, followUp, signal: controller.signal })) {
        // A reply already waits for the next run, so this run's end isn't the task's: it stays running.
        if (event.type === "done" && this.queued.has(taskId)) continue;
        // Words as they're written go straight to the window: saving the task for each would be a write per word.
        if (event.type === "text") {
          this.drafts.set(taskId, this.draft(taskId) + event.text);
          // The window missing a word can't fail the task: the whole answer still comes as a message.
          try {
            this.onText(taskId, event.text);
          } catch (err) {
            console.error(`Task ${taskId}: couldn't pass on the answer as it's written`, err);
          }
          continue;
        }
        if (event.type === "message") this.drafts.delete(taskId);
        // The words so far were a note between steps: the window starts the next words afresh, as the draft does.
        if (event.type === "activity" && event.kind === "note") {
          this.drafts.delete(taskId);
          try {
            this.onText(taskId, "", true);
          } catch (err) {
            console.error(`Task ${taskId}: couldn't pass on the note`, err);
          }
        }
        // Read the stored task each time, so an answer saved meanwhile isn't overwritten.
        task = this.save(applyEvent({ ...this.mustGet(taskId), interrupted: undefined }, event, this.now()));
      }
      // The stored task, not the last snapshot: a rename may have landed while the engine finished.
      const latest = this.mustGet(taskId);
      task =
        latest.status === "running" && !this.queued.has(taskId)
          ? this.save(applyEvent({ ...latest, interrupted: undefined }, { type: "done" }, this.now()))
          : latest;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const current = this.mustGet(taskId);
      task = current.interrupted
        ? this.save({ ...current, status: "stopped", error: message, updatedAt: this.now() })
        : this.save(applyEvent(current, { type: "failed", error: message }, this.now()));
    } finally {
      this.running.delete(taskId);
      this.drafts.delete(taskId);
      this.ended.delete(taskId);
      release();
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

  /**
   * Starts a task the user saved for later, the way a new task starts: on the engine's defaults as they are now, not
   * as they were when it was saved. `prepare` readies the folder and gives the files the agent works on, such as a
   * quick edit's copies, which are made only now so a task never started leaves nothing behind.
   */
  async startSaved(taskId: string, prepare: (task: Task) => Promise<string[]>): Promise<Task> {
    const saved = this.mustGet(taskId);
    if (saved.status !== "draft") throw new Error("This task has already started");
    if (this.starting.has(taskId)) throw new Error("This task is already starting");
    this.starting.add(taskId);
    try {
      // Before any copying, as for a new task: if the engine can't start, no folder or copies are left behind.
      const { provider, auth, model, effort } = await this.defaults();
      const attachments = await prepare(saved);
      // Read again: the task may have been renamed, or its project removed, while the files were copied.
      const task = this.mustGet(taskId);
      if (task.projectId && this.removing.has(task.projectId)) throw new Error("That project doesn't exist");
      const at = this.now();
      const { auth: _auth, ...rest } = task;
      this.save({
        ...rest,
        provider,
        ...(auth === "key" ? { auth: "key" as const } : {}),
        model,
        effort,
        attachments,
        // The brief is sent now, so that's when the message was written to the agent.
        messages: task.messages.map((m, i) => (i === 0 ? { ...m, at } : m)),
        updatedAt: at,
      });
      this.launch(taskId);
      return this.mustGet(taskId);
    } finally {
      this.starting.delete(taskId);
    }
  }

  /** Marks a finished task's work as looked at, so it's no longer "to review". Its place in Recent stays where it was. */
  markReviewed(taskId: string): Task {
    const task = this.mustGet(taskId);
    if (task.status !== "done") throw new Error("Only a finished task can be marked as reviewed");
    return task.reviewedAt ? task : this.save({ ...task, reviewedAt: this.now() });
  }

  /**
   * Takes one answer per question in the round, and keeps each with its question for the task screen. Files attached
   * to the answers join the task's, so the agent may read them.
   */
  answer(taskId: string, answers: string[], files: string[] = []): Task {
    const task = this.mustGet(taskId);
    if (!task.question) throw new Error("This task isn't waiting for an answer");
    const items = questionItems(task.question);
    if (answers.length !== items.length) throw new Error("Send one answer per question");
    const answer = answersText(task.question, answers);
    if (answer.length > BRIEF_MAX) throw new Error("These answers are too long to send together");
    const at = this.now();
    const answered = items.map((item, i) => ({ question: item.text, answer: answers[i] ?? "" }));
    const next = this.save({
      ...resume(task, at),
      attachments: joined(task.attachments, files),
      messages: [
        ...task.messages,
        { from: "user", text: answer, at, answers: answered, ...(files.length ? { attachments: files } : {}) },
      ],
    });
    if (!this.engine.answer(taskId, task.question.id, withFiles(answer, files)))
      this.continueWith(
        taskId,
        withFiles(
          task.question.more?.length
            ? `My answers to your questions, each under its question:\n\n${answer}`
            : `My answer to your question "${task.question.text}": ${answer}`,
          files,
        ),
      );
    return next;
  }

  /** Sends the user's reply to an agent that ended its turn to wait for it, now or once the turn has ended. */
  private continueWith(taskId: string, prompt: string): void {
    if (this.running.has(taskId)) this.queued.set(taskId, prompt);
    else this.launch(taskId, prompt);
  }

  /**
   * Carries on with a task that stopped when Tost Work closed. With a conversation to go back to, the agent is told why
   * it stopped; without one, the brief runs again from the start.
   */
  resume(taskId: string): Task {
    const task = this.mustGet(taskId);
    if (this.running.has(taskId)) throw new Error("This task is still working");
    if (!task.interrupted) throw new Error("Only a task stopped by closing Tost Work can be resumed");
    // A run started now could write to a file the restore is about to put back.
    if (this.restoring.has(taskId)) throw new Error("Wait for the restore to finish");
    this.launch(taskId, task.sessionId ? RESUME_PROMPT : null);
    return task;
  }

  /**
   * Adds the user's next instruction to a task that isn't working, with any files attached to it. Call `launch` with
   * `withFiles(text, files)` to run it.
   */
  followUp(taskId: string, text: string, files: string[] = []): Task {
    const task = this.mustGet(taskId);
    if (this.running.has(taskId)) throw new Error("This task is still working");
    // A run started now could write to a file the restore is about to put back.
    if (this.restoring.has(taskId)) throw new Error("Wait for the restore to finish");
    if (task.question || task.approval) throw new Error("This task is waiting for an answer");
    if (task.status === "draft") throw new Error("Start this task first");
    const at = this.now();
    // The old review checked the old brief, so it goes until the agent writes a new one. The new run's work hasn't
    // been looked at yet either.
    const { reviewedAt: _reviewed, ...rest } = task;
    return this.save({
      ...rest,
      review: null,
      error: null,
      attachments: joined(task.attachments, files),
      messages: [
        ...task.messages,
        { from: "user", text, at, followUp: true, ...(files.length ? { attachments: files } : {}) },
      ],
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
    // It would save the task again after its project's records are gone.
    if (task.projectId && this.removing.has(task.projectId)) throw new Error("That project is being removed");
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
    if (
      this.running.has(taskId) ||
      this.deciding.has(taskId) ||
      this.restoring.has(taskId) ||
      this.starting.has(taskId)
    )
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

  /**
   * Stops every working or waiting task of a project and waits for their runs to end. A run still ending would save
   * its task again after the project's tasks are deleted.
   */
  async stopProject(projectId: string): Promise<void> {
    this.removing.add(projectId);
    try {
      await this.stopAll(projectId);
    } catch (err) {
      // Removal called off: the project stays, and takes new tasks again.
      this.removing.delete(projectId);
      throw err;
    }
  }

  /** The project's records couldn't be removed after all: it stays, and takes new tasks again. */
  projectStays(projectId: string): void {
    this.removing.delete(projectId);
  }

  private async stopAll(projectId: string): Promise<void> {
    // A task putting files back or acting on a decision saves itself when done, whatever its status: it goes first.
    if (this.store.listProjectTasks(projectId).some((t) => this.deciding.has(t.id) || this.restoring.has(t.id)))
      throw new Error("A task is saving its files. Try again in a moment.");
    const active = () =>
      this.store.listProjectTasks(projectId).filter((t) => t.status === "needs-you" || this.running.has(t.id));
    // More than one round: a job can start a run in the gap while the first ones end.
    for (let round = 0; round < 5 && active().length > 0; round++) {
      const tasks = active();
      for (const task of tasks) {
        if (this.deciding.has(task.id) || this.restoring.has(task.id))
          throw new Error("A task is saving its files. Try again in a moment.");
        this.stop(task.id);
      }
      await Promise.all(tasks.map((task) => this.ended.get(task.id)));
    }
    if (active().length > 0) throw new Error("A task of this project is still working. Try again in a moment.");
  }

  /** How many tasks are working right now, so quitting can ask first. */
  workingCount(): number {
    return this.running.size;
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
