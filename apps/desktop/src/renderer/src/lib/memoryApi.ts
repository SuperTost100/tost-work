import type { NewProjectInput, NewTaskInput, TostWorkApi } from "../../../shared/api";
import type { EngineEvent, Project, Task } from "../../../shared/model";
import { applyEvent, resume } from "../../../shared/reduce";

/**
 * An in-memory `window.tostWork` for tests: tasks run a short script synchronously, stop at one question,
 * and finish when it's answered.
 */
export function createMemoryApi(): TostWorkApi & { emit(id: string, e: EngineEvent): void } {
  const projects: Project[] = [];
  const tasks = new Map<string, Task>();
  const listeners = new Set<(t: Task) => void>();
  let n = 0;
  const now = () => new Date(Date.UTC(2026, 9, 26, 9, 0, n++)).toISOString();
  const save = (t: Task) => {
    tasks.set(t.id, t);
    for (const l of listeners) l(t);
    return t;
  };
  const emit = (id: string, e: EngineEvent) => {
    const t = tasks.get(id);
    if (t) save(applyEvent(t, e, now()));
  };

  return {
    platform: "linux",
    versions: { app: "0.0.1", electron: "test" },
    emit,
    projects: {
      list: async () => [...projects],
      create: async (input: NewProjectInput) => {
        const p: Project = {
          id: `p${projects.length + 1}`,
          name: input.name,
          description: input.description ?? "",
          folder: input.folder,
          instructions: "",
          createdAt: now(),
        };
        projects.push(p);
        return p;
      },
      taskCounts: async () => {
        const counts: Record<string, number> = {};
        for (const t of tasks.values()) if (t.projectId) counts[t.projectId] = (counts[t.projectId] ?? 0) + 1;
        return counts;
      },
      pickFolder: async () => "/Users/giulia/Documents/Proposals",
    },
    tasks: {
      list: async () => [...tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      listForProject: async (projectId) => [...tasks.values()].filter((t) => t.projectId === projectId),
      get: async (id) => tasks.get(id) ?? null,
      start: async (input: NewTaskInput) => {
        const at = now();
        const t = save({
          id: `t${tasks.size + 1}`,
          projectId: input.projectId,
          title: input.brief.split("\n")[0] ?? "",
          brief: input.brief,
          attachments: input.attachments ?? [],
          workdir: "/tmp/quick",
          model: "gpt-5.5",
          effort: "medium",
          status: "running",
          steps: [
            { text: "Read the notes", status: "in_progress" },
            { text: "Write the proposal", status: "pending" },
          ],
          files: [],
          messages: [{ from: "user", text: input.brief, at }],
          question: null,
          approval: null,
          review: null,
          error: null,
          createdAt: at,
          updatedAt: at,
        });
        emit(t.id, {
          type: "question",
          question: { id: "q1", text: "Who pays the insurance?", options: ["The client", "We do", "Leave it open"] },
        });
        return tasks.get(t.id) ?? t;
      },
      answer: async (id, answer) => {
        const t = tasks.get(id);
        if (!t?.question) throw new Error("This task isn't waiting for an answer");
        save({ ...resume(t, now()), messages: [...t.messages, { from: "user", text: answer, at: now() }] });
        emit(id, { type: "file", change: { path: "/tmp/Proposta.docx", kind: "add", role: "made" } });
        emit(id, {
          type: "review",
          review: { asked: [{ text: "A proposal" }], decided: [{ text: "Travel not included" }], checkYourself: [] },
        });
        emit(id, { type: "done" });
        return tasks.get(id) ?? t;
      },
      decide: async (id, allow) => {
        const t = tasks.get(id);
        if (!t?.approval) throw new Error("This task isn't waiting for a decision");
        const path = t.approval.paths[0] ?? "";
        const kept = allow ? [{ path, copy: `/kept/${id}`, at: now(), reason: "overwrite" as const }] : [];
        save({ ...resume(t, now()), kept: [...(t.kept ?? []), ...kept] });
        emit(id, { type: "file", change: { path, kind: "update", role: "made" } });
        emit(id, { type: "done" });
        return tasks.get(id) ?? t;
      },
      followUp: async (id, text) => {
        const t = tasks.get(id);
        if (!t || t.status === "running" || t.question) throw new Error("This task can't take a follow-up now");
        save({
          ...t,
          status: "running",
          review: null,
          messages: [...t.messages, { from: "user", text, at: now(), followUp: true }],
        });
        emit(id, { type: "plan", steps: [{ text: "Make the change", status: "in_progress" }] });
        emit(id, { type: "message", text: "Done, I made the change." });
        emit(id, { type: "done" });
        return tasks.get(id) ?? t;
      },
      saveCopy: async (id) => {
        const made = tasks.get(id)?.files.filter((f) => f.role === "made") ?? [];
        const folder = "/Users/giulia/Documents";
        return { folder, saved: made.map((f) => `${folder}/${f.path.split("/").pop()}`) };
      },
      stop: async (id) => emit(id, { type: "stopped" }),
      onChange: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    files: {
      pick: async () => ["/Users/giulia/Documents/letter-bank.docx"],
      read: async (_taskId, path) => ({
        name: path.split("/").pop() ?? path,
        ext: "md",
        bytes: new TextEncoder().encode("# Proposta\n\nAlpi Logistica ci ha chiesto di ridurre i tempi."),
      }),
      open: async () => {},
      reveal: async () => {},
      restore: async (taskId, path) => {
        const t = tasks.get(taskId);
        if (!t) throw new Error("That task doesn't exist");
        return save({
          ...t,
          kept: [...(t.kept ?? []), { path, copy: `/kept/${taskId}-2`, at: now(), reason: "restore" }],
        });
      },
    },
  };
}
