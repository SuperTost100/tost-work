import { type EngineEvent, MAX_ACTIVITY, MAX_LINE_IDS, type Task } from "./model";

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
      const msg = task.messages.length;
      // The same thing again, such as three edits to one file, stays one line, unless a message came in between. The
      // line keeps each call's id, so the debug view shows all of them.
      if (last?.kind === event.kind && last.target === event.target && last.msg === msg) {
        const ids = last.ids ?? [];
        if (!event.id || ids.includes(event.id) || ids.length >= MAX_LINE_IDS) return task;
        return { ...next, activity: [...log.slice(0, -1), { ...last, ids: [...ids, event.id] }] };
      }
      const line = {
        kind: event.kind,
        ...(event.target ? { target: event.target } : {}),
        at,
        msg,
        ...(event.id ? { ids: [event.id] } : {}),
      };
      return { ...next, activity: [...log, line].slice(-MAX_ACTIVITY) };
    }
    case "message":
      return { ...next, messages: [...task.messages, { from: "agent", text: event.text, at }] };
    case "text":
      // Live words aren't part of the saved task.
      return task;
    case "file": {
      // A later change to the same path replaces the earlier one, so each file is listed once. A file the task made
      // and then edited still counts as made. A file Tost Work kept a copy of was there before the task, so it stays
      // listed as changed, with its earlier version, whatever the agent reports.
      const { change } = event;
      const others = task.files.filter((f) => f.path !== change.path);
      if (change.kind !== "delete" && task.kept?.some((k) => k.path === change.path))
        return { ...next, files: [...others, { path: change.path, kind: "update", role: "made" }] };
      const before = task.files.find((f) => f.path === change.path);
      const made = before?.kind === "add" && before.role === "made" && change.kind === "update";
      return { ...next, files: [...others, made ? { ...change, kind: "add" as const } : change] };
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
      return {
        ...next,
        status: "failed",
        error: event.error,
        question: null,
        approval: null,
        ...(event.sandboxNotReady ? { sandboxNotReady: event.sandboxNotReady } : {}),
      };
    case "stopped":
      return { ...next, status: "stopped", question: null, approval: null };
  }
}

/** Clears a question or approval once the user has answered, and puts the task back to running. */
export function resume(task: Task, at: string): Task {
  return { ...task, status: "running", question: null, approval: null, updatedAt: at };
}
