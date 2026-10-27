import { type EngineEvent, MAX_ACTIVITY, type Task } from "./model";

/** Applies one engine event to a task. Pure, so the main process and the tests share it. */
export function applyEvent(task: Task, event: EngineEvent, at: string): Task {
  const next: Task = { ...task, updatedAt: at };
  switch (event.type) {
    case "session":
      return { ...next, sessionId: event.sessionId };
    case "plan":
      return { ...next, steps: event.steps };
    case "activity": {
      const used = task.skillsUsed ?? [];
      // A skill read is kept on the task for good, so the task can say which skills it followed.
      if (event.kind === "skill" && event.target && !used.includes(event.target))
        return applyEvent({ ...task, skillsUsed: [...used, event.target] }, event, at);
      const log = task.activity ?? [];
      const last = log.at(-1);
      // The same thing again, such as three edits to one file, stays one line.
      if (last?.kind === event.kind && last.target === event.target) return task;
      const line = { kind: event.kind, ...(event.target ? { target: event.target } : {}), at };
      return { ...next, activity: [...log, line].slice(-MAX_ACTIVITY) };
    }
    case "message":
      return { ...next, messages: [...task.messages, { from: "agent", text: event.text, at }] };
    case "file": {
      // A later change to the same path replaces the earlier one, so each file is listed once.
      const others = task.files.filter((f) => f.path !== event.change.path);
      return { ...next, files: [...others, event.change] };
    }
    case "question":
      return { ...next, status: "needs-you", question: event.question };
    case "withdrawn":
      // Only the question or approval it names: a newer one may already be on the task.
      if (task.question?.id === event.id || task.approval?.id === event.id) return resume(task, at);
      return task;
    case "approval":
      return { ...next, status: "needs-you", approval: event.approval };
    case "review":
      return { ...next, review: event.review };
    case "done":
      // A run that ends with a question or approval still open is waiting for the user, not finished.
      if (task.question || task.approval) return { ...next, status: "needs-you" };
      return {
        ...next,
        status: "done",
        question: null,
        approval: null,
        steps: task.steps.map((s) => ({ ...s, status: "done" })),
      };
    case "failed":
      return { ...next, status: "failed", error: event.error, question: null, approval: null };
    case "stopped":
      return { ...next, status: "stopped", question: null, approval: null };
  }
}

/** Clears a question or approval once the user has answered, and puts the task back to running. */
export function resume(task: Task, at: string): Task {
  return { ...task, status: "running", question: null, approval: null, updatedAt: at };
}
