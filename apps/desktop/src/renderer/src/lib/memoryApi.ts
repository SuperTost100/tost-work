import type {
  AgentAccount,
  JobChange,
  MenuAction,
  MenuState,
  NewProjectInput,
  NewTaskInput,
  PanelTarget,
  ProjectMenuAction,
  SignInEvent,
  TaskMenuAction,
  TostWorkApi,
} from "../../../shared/api";
import {
  type AgentProvider,
  answersText,
  BRIEF_MAX,
  busyStatus,
  type CourseKey,
  DEFAULT_SETTINGS,
  type EngineEvent,
  type Job,
  keyVendor,
  type Project,
  questionItems,
  type Settings,
  type Skill,
  type SkillDraft,
  type SkillVersion,
  type Task,
} from "../../../shared/model";

import { applyEvent, resume } from "../../../shared/reduce";
import { nextRun } from "../../../shared/schedule";

/** The built-in guide the memory API lists, as Tost Work lists its Word, Excel, PowerPoint and PDF guides. */
const WORD_GUIDE: Skill = {
  id: "@word",
  name: "word",
  title: "Word documents",
  description: "Make or edit a Word document.",
  steps: "Make it with officecli.",
  files: [],
  folder: "/Applications/Tost Work.app/Contents/Resources/skills/word",
  updatedAt: "",
  builtIn: true,
};

/**
 * An in-memory `window.tostWork` for tests: tasks run a short script synchronously, stop at one question,
 * and finish when it's answered.
 */
export type MemoryApi = TostWorkApi & {
  emit(id: string, e: EngineEvent): void;
  pickInMenu(action: TaskMenuAction | null): void;
  /** What the next project menu returns, as if the user had picked it. */
  pickInProjectMenu(action: ProjectMenuAction | null): void;
  /** Whether the next "Remove from Tost Work" is confirmed. It is, unless told otherwise. */
  confirmRemoval(yes: boolean): void;
  /** Picks an item in the menu bar, as the user would. */
  pressMenu(action: MenuAction): void;
  /** As a click on a notification does. */
  openFromOutside(taskId: string): void;
  /** What the window last told the menu bar about the open task. */
  menuStateNow(): MenuState;
  /** Changes settings from outside the window, as the View menu does. */
  changeSettings(patch: Partial<Settings>): void;
  /** What the panel's buttons asked for, in order, and the height it last asked for. */
  panelCalls: { open: (PanelTarget | undefined)[]; quit: number; height: number };
};

export function createMemoryApi(initial: Partial<Settings> = { name: "Giulia", setupDone: true }): MemoryApi {
  let projects: Project[] = [];
  // Ids never come back after a removal, as the app's random ones don't.
  let projectCount = 0;
  const jobs = new Map<string, Job>();
  // Ids never come back after a removal, as the app's random ones don't.
  let jobCount = 0;
  const jobListeners = new Set<(change: JobChange) => void>();
  const saveJob = (job: Job): Job => {
    jobs.set(job.id, job);
    for (const l of jobListeners) l(job);
    return job;
  };
  const mustJob = (id: string): Job => {
    const job = jobs.get(id);
    if (!job) throw new Error("That job isn't there any more");
    return job;
  };
  let skills: Skill[] = [];
  const skillId = (title: string) =>
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "skill";
  // Each kept version holds the editor's fields, as SKILL.md text would.
  const versions = new Map<string, (SkillVersion & { draft: SkillDraft })[]>();
  // As the app: fields that match a kept version make it current again rather than adding one.
  const keep = (skill: Skill, more: { note?: string } = {}): Skill => {
    const list = versions.get(skill.id) ?? [];
    const draft = { title: skill.title, description: skill.description, steps: skill.steps };
    const same = list.findLast((v) => JSON.stringify(v.draft) === JSON.stringify(draft));
    if (same) return { ...skill, version: same.n };
    const n = (list.at(-1)?.n ?? 0) + 1;
    const note = more.note?.trim();
    list.push({ n, at: now(), ...(note ? { note } : {}), draft });
    versions.set(skill.id, list);
    return { ...skill, version: n };
  };
  const mustSkill = (id: string) => {
    const s = skills.find((x) => x.id === id);
    if (!s) throw new Error("That skill isn't there any more");
    return s;
  };
  const tasks = new Map<string, Task>();
  const listeners = new Set<(t: Task) => void>();
  let settings: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const accounts: Record<AgentProvider, AgentAccount> = {
    codex: { installed: true, version: "0.164.0", loggedIn: false },
    claude: { installed: true, version: "2.1.310", loggedIn: false },
  };
  let courseKey: CourseKey | null = null;
  const settingsListeners = new Set<(s: Settings) => void>();
  const menuListeners = new Set<(a: MenuAction) => void>();
  const openListeners = new Set<(id: string) => void>();
  const signInListeners = new Set<(provider: AgentProvider, e: SignInEvent) => void>();
  let n = 0;
  const now = () => new Date(Date.UTC(2026, 9, 26, 9, 0, n++)).toISOString();
  const save = (t: Task) => {
    tasks.set(t.id, t);
    for (const l of listeners) l(t);
    return t;
  };
  const textListeners = new Set<(taskId: string, text: string) => void>();
  // As the runner does: words go to the window and add up to the draft, and the message ends it.
  const drafts = new Map<string, string>();
  const emit = (id: string, e: EngineEvent) => {
    const t = tasks.get(id);
    if (!t) return;
    if (e.type === "text") {
      drafts.set(id, (drafts.get(id) ?? "") + e.text);
      for (const l of textListeners) l(id, e.text);
      return;
    }
    if (e.type === "message" || e.type === "done" || e.type === "failed" || e.type === "stopped") drafts.delete(id);
    save(applyEvent(t, e, now()));
  };

  // What the next task menu returns, as if the user had picked it.
  let menuPick: TaskMenuAction | null = null;
  let menuState: MenuState = { task: false, running: false };
  let projectMenuPick: ProjectMenuAction | null = null;
  let removalConfirmed = true;

  // Ids never come back, even after a task is removed.
  let taskCount = 0;
  const panelCalls: MemoryApi["panelCalls"] = { open: [], quit: 0, height: 0 };
  const api: MemoryApi = {
    platform: "linux",
    pickInMenu: (action) => {
      menuPick = action;
    },
    pickInProjectMenu: (action) => {
      projectMenuPick = action;
    },
    confirmRemoval: (yes) => {
      removalConfirmed = yes;
    },
    versions: { app: "0.0.1", electron: "test" },
    onMenu: (l) => {
      menuListeners.add(l);
      return () => menuListeners.delete(l);
    },
    menuState: (state) => {
      menuState = state;
    },
    menuStateNow: () => menuState,
    onOpenTask: (l) => {
      openListeners.add(l);
      return () => openListeners.delete(l);
    },
    openFromOutside: (id) => {
      for (const l of openListeners) l(id);
    },
    pressMenu: (action) => {
      for (const l of menuListeners) l(action);
    },
    changeSettings: (patch) => {
      settings = { ...settings, ...patch };
      for (const l of settingsListeners) l(settings);
    },
    panelCalls,
    panel: {
      open: (target) => {
        panelCalls.open.push(target);
      },
      quit: () => {
        panelCalls.quit++;
      },
      fit: (height) => {
        panelCalls.height = height;
      },
    },
    emit,
    settings: {
      get: async () => settings,
      onChange: (l) => {
        settingsListeners.add(l);
        return () => settingsListeners.delete(l);
      },
      update: async (patch) => {
        // Sections are merged as in the main process: a patch names only the switches it changes.
        settings = {
          ...settings,
          ...patch,
          sections: { ...settings.sections, ...patch.sections },
          notify: { ...settings.notify, ...patch.notify },
        };
        return settings;
      },
    },
    account: {
      status: async (provider) => accounts[provider],
      signIn: async (provider) => {
        const account = { ...accounts[provider], loggedIn: true, account: "giulia@example.com" };
        accounts[provider] = account;
        for (const l of signInListeners) l(provider, { type: "done", account });
      },
      sendCode: async () => {},
      cancel: async () => {},
      install: async (provider) => {
        accounts[provider] = { ...accounts[provider], installed: true };
        return { ok: true };
      },
      signOut: async (provider) => {
        accounts[provider] = { ...accounts[provider], loggedIn: false, account: undefined };
        return accounts[provider];
      },
      onSignIn: (l) => {
        signInListeners.add(l);
        return () => signInListeners.delete(l);
      },
    },
    key: {
      info: async () => courseKey,
      save: async (key) => {
        const vendor = keyVendor(key);
        if (!vendor) throw new Error("This isn't an OpenAI or Anthropic API key");
        courseKey = { vendor, last4: key.slice(-4) };
        return courseKey;
      },
      remove: async () => {
        courseKey = null;
      },
    },
    projects: {
      list: async () => [...projects],
      create: async (input: NewProjectInput) => {
        const p: Project = {
          id: `p${++projectCount}`,
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
      menu: async () => projectMenuPick,
      update: async (id, patch) => {
        const project = projects.find((p) => p.id === id);
        if (!project) throw new Error("That project doesn't exist");
        const name = patch.name?.trim();
        if (patch.name !== undefined && !name) throw new Error("A project needs a name");
        const next = { ...project, ...patch, ...(name ? { name } : {}) };
        projects = projects.map((p) => (p.id === id ? next : p));
        return next;
      },
      reveal: async () => {},
      remove: async (id) => {
        if (!projects.some((p) => p.id === id)) throw new Error("That project doesn't exist");
        if (!removalConfirmed) return false;
        projects = projects.filter((p) => p.id !== id);
        for (const t of [...tasks.values()]) if (t.projectId === id) tasks.delete(t.id);
        for (const j of [...jobs.values()]) {
          if (j.projectId !== id) continue;
          jobs.delete(j.id);
          for (const l of jobListeners) l({ id: j.id, removed: true });
        }
        return true;
      },
    },
    tasks: {
      list: async () => [...tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      listActive: async () => [...tasks.values()].filter((t) => busyStatus(t.status)),
      listForProject: async (projectId) => [...tasks.values()].filter((t) => t.projectId === projectId),
      get: async (id) => tasks.get(id) ?? null,
      start: async (input: NewTaskInput) => {
        const at = now();
        const t = save({
          id: `t${++taskCount}`,
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
      answer: async (id, answers) => {
        const t = tasks.get(id);
        if (!t?.question) throw new Error("This task isn't waiting for an answer");
        const items = questionItems(t.question);
        // The same checks as the runner, so the screen tests meet the real rules.
        if (answers.length !== items.length) throw new Error("Send one answer per question");
        const text = answersText(t.question, answers);
        if (text.length > BRIEF_MAX) throw new Error("These answers are too long to send together");
        const answered = items.map((item, i) => ({ question: item.text, answer: answers[i] ?? "" }));
        save({ ...resume(t, now()), messages: [...t.messages, { from: "user", text, at: now(), answers: answered }] });
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
      resume: async (id) => {
        const t = tasks.get(id);
        if (!t?.interrupted) throw new Error("Only a task stopped by closing Tost Work can be resumed");
        return save({ ...t, status: "running", interrupted: undefined });
      },
      menu: async () => menuPick,
      rename: async (id, title) => {
        const t = tasks.get(id);
        if (!t) throw new Error("That task doesn't exist");
        return save({ ...t, title: title.trim() });
      },
      reveal: async () => {},
      remove: async (id) => tasks.delete(id),
      onChange: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      draft: async (id) => drafts.get(id) ?? "",
      onText: (l) => {
        textListeners.add(l);
        return () => textListeners.delete(l);
      },
    },
    jobs: {
      list: async () => [...jobs.values()],
      create: async (draft) => {
        if (!projects.some((p) => p.id === draft.projectId)) throw new Error("That project doesn't exist");
        const at = now();
        return saveJob({
          id: `j${++jobCount}`,
          ...draft,
          on: true,
          skip: null,
          handled: at,
          last: null,
          createdAt: at,
          updatedAt: at,
        });
      },
      update: async (id, draft) => {
        const job = mustJob(id);
        const sameTimes = JSON.stringify(job.schedule) === JSON.stringify(draft.schedule);
        return saveJob({ ...job, ...draft, skip: sameTimes ? job.skip : null, updatedAt: now() });
      },
      setOn: async (id, on) => saveJob({ ...mustJob(id), on, updatedAt: now() }),
      skipOnce: async (id) => {
        const job = mustJob(id);
        const next = nextRun(job.schedule, new Date(now()))?.toISOString() ?? null;
        return saveJob({ ...job, skip: job.skip === next ? null : next, updatedAt: now() });
      },
      remove: async (id) => {
        jobs.delete(id);
        for (const l of jobListeners) l({ id, removed: true });
      },
      runNow: async (id) => {
        const job = mustJob(id);
        const task = await api.tasks.start({ projectId: job.projectId, brief: job.brief, attachments: [] });
        save({ ...(tasks.get(task.id) ?? task), title: job.title, jobId: job.id });
        // As the app: removed or changed while the run started, the job as it is now is kept, or stays gone.
        const fresh = jobs.get(id);
        if (fresh) saveJob({ ...fresh, last: { at: now(), taskId: task.id } });
        return task.id;
      },
      onChange: (l) => {
        jobListeners.add(l);
        return () => jobListeners.delete(l);
      },
    },
    skills: {
      list: async () => [...[...skills].sort((a, b) => a.title.localeCompare(b.title)), WORD_GUIDE],
      create: async (title) => {
        let id = skillId(title);
        for (let n = 2; skills.some((s) => s.id === id); n++) id = `${skillId(title)}-${n}`;
        const skill: Skill = {
          id,
          name: id,
          title,
          description: "",
          steps: "",
          files: [],
          folder: `/Users/giulia/Documents/Tost Work/Skills/${id}`,
          updatedAt: now(),
        };
        const kept = keep(skill);
        skills = [...skills, kept];
        return kept;
      },
      save: async (id, draft, note) => {
        const current = mustSkill(id);
        const next = { ...current, ...draft, id: skillId(draft.title), name: skillId(draft.title), updatedAt: now() };
        if (next.id !== id) {
          versions.set(next.id, versions.get(id) ?? []);
          versions.delete(id);
        }
        const kept = keep(next, { note });
        skills = skills.map((s) => (s.id === id ? kept : s));
        return kept;
      },
      addFiles: async (id) => {
        const current = mustSkill(id);
        const next = { ...current, files: [...current.files, "template.docx"].sort() };
        skills = skills.map((s) => (s.id === id ? next : s));
        return next;
      },
      reveal: async (id) => {
        if (id !== WORD_GUIDE.id) mustSkill(id);
      },
      remove: async (id) => {
        mustSkill(id);
        skills = skills.filter((s) => s.id !== id);
      },
      menu: async () => menuPick,
      duplicate: async (id) => {
        if (id !== WORD_GUIDE.id) throw new Error("That isn't one of Tost Work's guides");
        const { builtIn: _b, ...guide } = WORD_GUIDE;
        const copy = keep({
          ...guide,
          id: "word-documents-copy",
          name: "word-documents-copy",
          title: "Word documents (copy)",
        });
        skills = [...skills, copy];
        return copy;
      },
      import: async (dropped) => {
        const { builtIn: _b, ...guide } = WORD_GUIDE;
        const name = dropped ? dropped.name.replace(/\.zip$/i, "") : "meeting-notes";
        const title = dropped ? name : "Meeting notes";
        // A free folder name, as the real import picks one.
        let id = name;
        for (let n = 2; id === WORD_GUIDE.id || skills.some((s) => s.id === id); n++) id = `${name}-${n}`;
        const skill = keep({ ...guide, id, name: id, title });
        skills = [...skills, skill];
        return skill;
      },
      history: async (id) => [...(versions.get(mustSkill(id).id) ?? [])].reverse().map(({ draft: _d, ...v }) => v),
      restore: async (id, n) => {
        const old = versions.get(id)?.find((v) => v.n === n);
        if (!old) throw new Error("That version isn't kept any more");
        const next = keep({ ...mustSkill(id), ...old.draft, updatedAt: now() });
        skills = skills.map((s) => (s.id === id ? next : s));
        return next;
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
  return api;
}
