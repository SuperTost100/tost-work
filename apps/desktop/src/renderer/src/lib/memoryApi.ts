import type {
  AgentAccount,
  JobChange,
  MenuAction,
  MenuState,
  NewProjectInput,
  NewTaskInput,
  PanelTarget,
  ProjectMenuAction,
  QuestionAnswer,
  SignInEvent,
  SkillMenuAction,
  TaskMenuAction,
  TostWorkApi,
  WindowQuestion,
} from "../../../shared/api";
import type { LogLine } from "../../../shared/debug";
import { guideText, translate } from "../../../shared/i18n";
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
  lastMade,
  mergeSettings,
  type Project,
  type ProjectOverview,
  questionItems,
  type Settings,
  type Skill,
  type SkillDraft,
  type SkillVersion,
  type Task,
} from "../../../shared/model";
import { choiceOf, type ModelPick, pickOn, SAMPLE_CHOICES } from "../../../shared/modelChoice";
import { removalText } from "../../../shared/projectText";
import { applyEvent, resume } from "../../../shared/reduce";
import { nextRun } from "../../../shared/schedule";
import { matchesWords, SEARCH_LIMIT, searchWords } from "../../../shared/search";
import { taskMenuItems } from "../../../shared/taskMenu";

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
  /** What the next task or skill menu returns, as if the user had picked it. */
  pickInMenu(action: SkillMenuAction | TaskMenuAction | null): void;
  /** What the next project menu returns, as if the user had picked it. */
  pickInProjectMenu(action: ProjectMenuAction | null): void;
  /** Picks an item in the menu bar, as the user would. */
  pressMenu(action: MenuAction): void;
  /** As a click on a notification does. */
  openFromOutside(taskId: string): void;
  /** Asks a question as the main process does, in the window's card, and resolves with the button pressed. */
  askFromMain(question: Omit<WindowQuestion, "id">): Promise<QuestionAnswer>;
  /** What the window last told the menu bar about the open task. */
  menuStateNow(): MenuState;
  /** Changes settings from outside the window, as the View menu does. */
  changeSettings(patch: Partial<Settings>): void;
  /** What the panel's buttons asked for, in order, and the height it last asked for. */
  panelCalls: { open: (PanelTarget | undefined)[]; quit: number; height: number };
  /** Adds a line to the task's debug log, as the engine does while debug is on. */
  log(taskId: string, line: LogLine): void;
  /** How many times the window asked to open the file with the licences. */
  licensesOpened: number;
  /** What the debug log buttons and menu items asked for, in order. */
  debugCalls: {
    revealed: string[];
    copied: string[];
    appLog: number;
    exported: number;
    screens: Record<string, string>[];
  };
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
  // A user who has seen this stage's welcome card, unless a test asks for one who hasn't.
  let settings: Settings = { ...DEFAULT_SETTINGS, welcomed: __APP_VERSION__, ...initial };
  // The guide as the real app lists it: with its title, description and steps in the settings' language.
  const wordGuide = (): Skill => ({ ...WORD_GUIDE, ...guideText(settings.language ?? "en", "word") });
  const accounts: Record<AgentProvider, AgentAccount> = {
    codex: { installed: true, version: "0.164.0", loggedIn: false },
    claude: { installed: true, version: "2.1.310", loggedIn: false },
  };
  let courseKey: CourseKey | null = null;
  const settingsListeners = new Set<(s: Settings) => void>();
  const menuListeners = new Set<(a: MenuAction) => void>();
  const openListeners = new Set<(id: string) => void>();
  const questionListeners = new Set<(question: WindowQuestion) => void>();
  const questionAnswers = new Map<number, (answer: QuestionAnswer) => void>();
  let questionId = 0;
  const signInListeners = new Set<(provider: AgentProvider, e: SignInEvent) => void>();
  let n = 0;
  const now = () => new Date(Date.UTC(2026, 9, 26, 9, 0, n++)).toISOString();
  const save = (t: Task) => {
    tasks.set(t.id, t);
    for (const l of listeners) l(t);
    return t;
  };
  const textListeners = new Set<(taskId: string, text: string, restart?: boolean) => void>();
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
    // As the runner does: the words so far became a note, so the next ones start a new draft.
    if (e.type === "activity" && e.kind === "note") {
      drafts.delete(id);
      for (const l of textListeners) l(id, "", true);
    }
    save(applyEvent(t, e, now()));
  };

  // What the next task menu returns, as if the user had picked it.
  let menuPick: SkillMenuAction | TaskMenuAction | null = null;
  let menuState: MenuState = { task: false, running: false };
  let projectMenuPick: ProjectMenuAction | null = null;

  // Ids never come back, even after a task is removed.
  let taskCount = 0;
  // The agent, model and level a task starts on, as the main process works them out from a pick.
  const running = (pick: ModelPick = settings.modelPick) => {
    const picked = pickOn(pick, SAMPLE_CHOICES);
    if (!picked) throw new Error("No models");
    return {
      provider: picked.provider,
      model: picked.model.id,
      effort: picked.effort,
      choice: choiceOf(pick, {
        provider: picked.provider,
        auth: picked.ai === "key" ? "key" : "account",
        model: picked.model.id,
      }),
    };
  };
  // A task as the runner makes it, not started yet: saved for later until `run` starts it.
  const created = (input: NewTaskInput): Task => {
    const at = now();
    return save({
      id: `t${++taskCount}`,
      projectId: input.projectId,
      title: input.brief.split("\n")[0] || (input.attachments?.[0]?.split("/").pop() ?? ""),
      brief: input.brief,
      attachments: input.attachments ?? [],
      workdir: "/tmp/quick",
      ...running(input.pick),
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
    });
  };
  // The short script every task runs: two steps, then one question that `answer` finishes.
  const run = (id: string, at = now()): Task => {
    const t = tasks.get(id);
    if (!t) throw new Error("That task doesn't exist");
    save({
      ...t,
      status: "running",
      steps: [
        { text: "Read the notes", status: "in_progress" },
        { text: "Write the proposal", status: "pending" },
      ],
      updatedAt: at,
    });
    emit(id, {
      type: "question",
      question: { id: "q1", text: "Who pays the insurance?", options: ["The client", "We do", "Leave it open"] },
    });
    return tasks.get(id) ?? t;
  };
  const panelCalls: MemoryApi["panelCalls"] = { open: [], quit: 0, height: 0 };
  // Each task's debug log, as the main process keeps it in its file.
  const logs = new Map<string, LogLine[]>();
  const debugCalls: MemoryApi["debugCalls"] = { revealed: [], copied: [], appLog: 0, exported: 0, screens: [] };
  const mustLog = (id: string) => {
    if (!tasks.has(id)) throw new Error("That task doesn't exist");
    const log = logs.get(id);
    if (!log) throw new Error("This task has no log yet");
    return log;
  };
  const api: MemoryApi = {
    platform: "linux",
    pickInMenu: (action) => {
      menuPick = action;
    },
    pickInProjectMenu: (action) => {
      projectMenuPick = action;
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
    licensesOpened: 0,
    openLicenses: async () => {
      api.licensesOpened++;
    },
    onOpenTask: (l) => {
      openListeners.add(l);
      return () => openListeners.delete(l);
    },
    openFromOutside: (id) => {
      for (const l of openListeners) l(id);
    },
    onQuestion: (l) => {
      questionListeners.add(l);
      return () => questionListeners.delete(l);
    },
    answerQuestion: (id, answer) => {
      questionAnswers.get(id)?.(answer);
      questionAnswers.delete(id);
    },
    askFromMain: (question) =>
      new Promise((resolve) => {
        const id = ++questionId;
        questionAnswers.set(id, resolve);
        for (const l of questionListeners) l({ ...question, id });
      }),
    pressMenu: (action) => {
      for (const l of menuListeners) l(action);
    },
    changeSettings: (patch) => {
      settings = { ...settings, ...patch };
      for (const l of settingsListeners) l(settings);
    },
    panelCalls,
    debugCalls,
    log: (taskId, line) => {
      // As the main process: written only while debug is on.
      if (settings.debug) logs.set(taskId, [...(logs.get(taskId) ?? []), line]);
    },
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
        // Merged as in the main process.
        settings = mergeSettings(settings, patch);
        return settings;
      },
    },
    models: { choices: async () => SAMPLE_CHOICES },
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
      overviews: async () => {
        const overviews: Record<string, ProjectOverview> = {};
        const newestFirst = [...tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        for (const t of newestFirst) {
          if (!t.projectId) continue;
          const o = overviews[t.projectId] ?? { tasks: 0, working: 0, needsYou: 0, lastResult: null };
          overviews[t.projectId] = o;
          o.tasks++;
          if (t.status === "running") o.working++;
          if (t.status === "needs-you") o.needsYou++;
          o.lastResult ??= lastMade(t);
        }
        return overviews;
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
      removalText: async (id) => {
        const project = projects.find((p) => p.id === id);
        if (!project) throw new Error("That project doesn't exist");
        // The same text as the app's, in the language the settings choose.
        return removalText(settings.language ?? "en", project.name, {
          tasks: [...tasks.values()].filter((t) => t.projectId === id).length,
          jobs: [...jobs.values()].filter((j) => j.projectId === id).length,
        });
      },
      remove: async (id) => {
        if (!projects.some((p) => p.id === id)) throw new Error("That project doesn't exist");
        projects = projects.filter((p) => p.id !== id);
        for (const t of [...tasks.values()])
          if (t.projectId === id) {
            tasks.delete(t.id);
            logs.delete(t.id);
          }
        for (const j of [...jobs.values()]) {
          if (j.projectId !== id) continue;
          jobs.delete(j.id);
          for (const l of jobListeners) l({ id: j.id, removed: true });
        }
      },
    },
    tasks: {
      list: async () => [...tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      listActive: async () => [...tasks.values()].filter((t) => busyStatus(t.status)),
      listForProject: async (projectId) => [...tasks.values()].filter((t) => t.projectId === projectId),
      search: async (query) => {
        const words = searchWords(query);
        return [...tasks.values()]
          .filter((t) => matchesWords(`${t.title}\n${t.brief}`, words))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, SEARCH_LIMIT);
      },
      listAll: async () => [...tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      get: async (id) => tasks.get(id) ?? null,
      start: async (input: NewTaskInput) => {
        const t = created(input);
        return run(t.id, t.updatedAt);
      },
      saveForLater: async (input: NewTaskInput) => {
        // The same checks as the main process, so the screen tests meet the real rules.
        if (!input.brief.trim() && !input.attachments?.length) throw new Error("A task needs a brief");
        if (input.projectId && !projects.some((p) => p.id === input.projectId))
          throw new Error("That project doesn't exist");
        return created(input);
      },
      startSaved: async (id, pick) => {
        const saved = tasks.get(id);
        if (saved?.status !== "draft") throw new Error("This task has already started");
        save({ ...saved, ...running(pick) });
        return run(id);
      },
      updateDraft: async (id, input) => {
        // The same checks as the main process and the runner, so the screen tests meet the real rules.
        const t = tasks.get(id);
        if (!t) throw new Error("That task doesn't exist");
        if (t.status !== "draft") throw new Error("This task has already started");
        const brief = input.brief.trim();
        if (!brief && !input.attachments?.length) throw new Error("A task needs a brief");
        if (input.projectId && !projects.some((p) => p.id === input.projectId))
          throw new Error("That project doesn't exist");
        const title = (text: string) => text.split("\n")[0] ?? "";
        const attachments = input.attachments ?? [];
        return save({
          ...t,
          title: t.title === title(t.brief) ? title(brief) : t.title,
          brief,
          projectId: input.projectId,
          // As in the main process: a project's task works in its folder, and one without keeps its own.
          workdir: projects.find((p) => p.id === input.projectId)?.folder ?? (t.projectId ? "/tmp/quick" : t.workdir),
          attachments,
          messages: [{ from: "user", text: brief, at: now(), ...(attachments.length ? { attachments } : {}) }],
          updatedAt: now(),
        });
      },
      markReviewed: async (id) => {
        const t = tasks.get(id);
        if (t?.status !== "done") throw new Error("Only a finished task can be marked as checked");
        return t.reviewedAt ? t : save({ ...t, reviewedAt: now() });
      },
      markUnreviewed: async (id) => {
        const t = tasks.get(id);
        if (t?.status !== "done") throw new Error("Only a finished task can be marked to check");
        const { reviewedAt: _reviewed, ...rest } = t;
        return t.reviewedAt ? save(rest) : t;
      },
      answer: async (id, answers, files = []) => {
        const t = tasks.get(id);
        if (!t?.question) throw new Error("This task isn't waiting for an answer");
        const items = questionItems(t.question);
        // The same checks as the runner, so the screen tests meet the real rules.
        if (answers.length !== items.length) throw new Error("Send one answer per question");
        const text = answersText(t.question, answers);
        if (text.length > BRIEF_MAX) throw new Error("These answers are too long to send together");
        const answered = items.map((item, i) => ({ question: item.text, answer: answers[i] ?? "" }));
        save({
          ...resume(t, now()),
          attachments: [...new Set([...t.attachments, ...files])],
          messages: [
            ...t.messages,
            { from: "user", text, at: now(), answers: answered, ...(files.length ? { attachments: files } : {}) },
          ],
        });
        emit(id, { type: "file", change: { path: "/tmp/Proposta.docx", kind: "add", role: "made" } });
        emit(id, {
          type: "review",
          review: { asked: [{ text: "A proposal" }], decided: [{ text: "Travel not included" }], checkYourself: [] },
        });
        emit(id, { type: "done" });
        return tasks.get(id) ?? t;
      },
      decide: async (id, decision) => {
        const t = tasks.get(id);
        if (!t?.approval) throw new Error("This task isn't waiting for a decision");
        const path = t.approval.paths[0] ?? "";
        const allow = decision === "allow";
        const kept = allow ? [{ path, copy: `/kept/${id}`, at: now(), reason: "overwrite" as const }] : [];
        save({ ...resume(t, now()), kept: [...(t.kept ?? []), ...kept] });
        // Turned down altogether, the task saves nothing in its place.
        if (decision !== "discard") emit(id, { type: "file", change: { path, kind: "update", role: "made" } });
        emit(id, { type: "done" });
        return tasks.get(id) ?? t;
      },
      followUp: async (id, text, files = []) => {
        const t = tasks.get(id);
        if (!t || t.status === "running" || t.status === "draft" || t.question)
          throw new Error("This task can't take a follow-up now");
        const { reviewedAt: _reviewed, ...rest } = t;
        save({
          ...rest,
          status: "running",
          review: null,
          attachments: [...new Set([...t.attachments, ...files])],
          messages: [
            ...t.messages,
            { from: "user", text, at: now(), followUp: true, ...(files.length ? { attachments: files } : {}) },
          ],
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
      // Only what the real menu offers the task as it is now: a pick it wouldn't show comes back as nothing.
      menu: async (id) => {
        const t = tasks.get(id);
        if (!t) throw new Error("That task doesn't exist");
        const offered = taskMenuItems(t, t.status !== "running", () => "", settings.debug && logs.has(id));
        const pick = offered.find((item) => item !== "separator" && item.action === menuPick);
        return pick && pick !== "separator" && pick.enabled !== false ? pick.action : null;
      },
      rename: async (id, title) => {
        const t = tasks.get(id);
        if (!t) throw new Error("That task doesn't exist");
        return save({ ...t, title: title.trim() });
      },
      reveal: async () => {},
      remove: async (id) => {
        tasks.delete(id);
        logs.delete(id);
      },
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
      list: async () => [...[...skills].sort((a, b) => a.title.localeCompare(b.title)), wordGuide()],
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
        // As the app: a blank skill isn't a version yet, so its first save is version 1.
        skills = [...skills, skill];
        return skill;
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
      exportZip: async (id) => {
        mustSkill(id);
      },
      // Only what the skill menu offers.
      menu: async () =>
        menuPick === "rename" || menuPick === "reveal" || menuPick === "delete" || menuPick === "export"
          ? menuPick
          : null,
      duplicate: async (id) => {
        if (id !== WORD_GUIDE.id) throw new Error("That isn't one of Tost Work's guides");
        const { builtIn: _b, ...guide } = wordGuide();
        // Named and written in the app's language, as the real Duplicate does.
        const title = translate(settings.language ?? "en", "skills.copyOf", { title: guide.title });
        const copy = keep({ ...guide, id: skillId(title), name: skillId(title), title });
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
    debug: {
      taskLog: async (id) => {
        if (!tasks.has(id)) throw new Error("That task doesn't exist");
        return logs.get(id) ?? null;
      },
      revealTaskLog: async (id) => {
        mustLog(id);
        debugCalls.revealed.push(id);
      },
      copyTaskLog: async (id) => {
        mustLog(id);
        debugCalls.copied.push(id);
      },
      revealAppLog: async () => {
        debugCalls.appLog++;
      },
      exportLogs: async () => {
        debugCalls.exported++;
      },
      screen: (route) => {
        debugCalls.screens.push(route);
      },
    },
    files: {
      pick: async () => ["/Users/giulia/Documents/letter-bank.docx"],
      take: async (files) => files.map((f) => `/Users/giulia/Downloads/${f.name}`),
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
