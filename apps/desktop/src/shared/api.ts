import type { LogLine } from "./debug";
import type { InstallResult } from "./install";
import type {
  AgentProvider,
  CourseKey,
  Decision,
  Job,
  JobDraft,
  Project,
  ProjectOverview,
  Settings,
  Skill,
  SkillDraft,
  SkillVersion,
  Task,
} from "./model";
import type { ModelChoices, ModelPick } from "./modelChoice";

export interface NewProjectInput {
  name: string;
  description?: string;
  folder: string;
}

export interface ProjectPatch {
  name?: string;
  description?: string;
  instructions?: string;
}

export interface NewTaskInput {
  projectId: string | null;
  brief: string;
  attachments?: string[];
  /** What the task runs on. Missing means the last pick, as Settings remembers it. */
  pick?: ModelPick;
}

export interface FileContent {
  name: string;
  /** Lower-case extension without the dot, for example "docx". */
  ext: string;
  bytes: Uint8Array;
}

export interface SaveResult {
  folder: string;
  /** Paths written. Fewer than the task's files when the user cancelled at a name clash. */
  saved: string[];
}

/** An agent CLI and the subscription signed in to it: Codex for ChatGPT, Claude Code for Claude. */
export interface AgentAccount {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  account?: string;
  plan?: string;
}

/** Progress of a sign-in, pushed to the interface while it runs. */
export type SignInEvent =
  | { type: "link"; url: string }
  | { type: "code"; message: string }
  | { type: "done"; account: AgentAccount }
  | { type: "error"; message: string };

/** What a menu bar item asks the window to do. */
/** What the Task menu acts on: whether a task is open, and whether it's working and can be stopped. */
export interface MenuState {
  task: boolean;
  running: boolean;
}

export type MenuAction =
  | "new-task"
  | "new-project"
  | "quick-edit"
  | "settings"
  | "about"
  | "send"
  | "stop"
  | "rename"
  | "reveal"
  | "toggle-sidebar";

/** What the confirmation says before a project is removed: the question, and what goes with it. */
export interface RemovalText {
  message: string;
  detail: string;
}

/** What the preload exposes to the interface as `window.tostWork`. */
export type JobChange = Job | { id: string; removed: true };

export interface TostWorkApi {
  platform: "darwin" | "win32" | "linux";
  versions: { app: string; electron: string };
  settings: {
    get(): Promise<Settings>;
    /** Saves the fields given and returns all settings. */
    update(patch: Partial<Settings>): Promise<Settings>;
    /** Settings changed from outside the window, such as the text size from the View menu. */
    onChange(listener: (settings: Settings) => void): () => void;
  };
  /** The menu bar's items, which the window carries out. */
  onMenu(listener: (action: MenuAction) => void): () => void;
  /** A click on a notification, or in the menu bar's icon, asks the window to show this task. */
  onOpenTask(listener: (taskId: string) => void): () => void;
  /** A question from the main process for the app's own card, such as quitting while tasks work. */
  onQuestion(listener: (question: WindowQuestion) => void): () => void;
  answerQuestion(id: number, answer: QuestionAnswer): void;
  /** The menu-bar panel's buttons. */
  panel: {
    /** Opens the main window, on a task or on a new task or Settings when asked, and closes the panel. */
    open(target?: PanelTarget): void;
    quit(): void;
    /** Makes the panel as tall as its content. */
    fit(height: number): void;
  };
  /** Tells the menu bar whether a task is open and working, so its Task items turn on and off with it. */
  menuState(state: MenuState): void;
  /** Opens the file with the licences of everything the app ships, in the app that opens text files. */
  openLicenses(): Promise<void>;
  /** The subscriptions, one per agent CLI. */
  account: {
    status(provider: AgentProvider): Promise<AgentAccount>;
    /** Opens the sign-in page through the CLI. Progress arrives through `onSignIn`. */
    signIn(provider: AgentProvider): Promise<void>;
    sendCode(provider: AgentProvider, code: string): Promise<void>;
    cancel(provider: AgentProvider): Promise<void>;
    /** Signs out in the CLI and resolves with the new state. */
    signOut(provider: AgentProvider): Promise<AgentAccount>;
    /** Installs the CLI with the vendor's official installer. Resolves when it's done, never rejects. */
    install(provider: AgentProvider): Promise<InstallResult>;
    onSignIn(listener: (provider: AgentProvider, event: SignInEvent) => void): () => void;
  };
  /** The AIs and models a new task can run on, for the picker under the task box. */
  models: {
    choices(): Promise<ModelChoices>;
  };
  /** The course API key. The interface never reads it back, only whose it is and how it ends. */
  key: {
    info(): Promise<CourseKey | null>;
    /** Encrypts and saves the key. Rejects what isn't an OpenAI or Anthropic key. */
    save(key: string): Promise<CourseKey>;
    remove(): Promise<void>;
  };
  projects: {
    list(): Promise<Project[]>;
    create(input: NewProjectInput): Promise<Project>;
    /** How many tasks each project has, by project id. */
    /** Each project's task numbers and newest file, by project id. */
    overviews(): Promise<Record<string, ProjectOverview>>;
    /** Opens the system folder picker, in `defaultPath` when given. Resolves to null when the user cancels. */
    pickFolder(defaultPath?: string): Promise<string | null>;
    /** Shows the project's menu where the pointer is, and resolves with what the user picked, or null. */
    menu(id: string): Promise<ProjectMenuAction | null>;
    /** Saves the fields given, the name or the instructions the AI reads in every task. */
    update(id: string, patch: ProjectPatch): Promise<Project>;
    /** Opens the project's folder. */
    reveal(id: string): Promise<void>;
    /** What to say before removing the project: the question, and what goes with it and what stays. */
    removalText(id: string): Promise<RemovalText>;
    /**
     * Removes the project with its tasks and jobs from the app, after stopping the ones working. The folder and its
     * files stay. The window asks the user first.
     */
    remove(id: string): Promise<void>;
  };
  tasks: {
    /** The 50 most recently updated tasks. */
    list(): Promise<Task[]>;
    /** Every task working or waiting for the user, however old: the recent list stops at 50. */
    listActive(): Promise<Task[]>;
    /** Every task of one project. */
    listForProject(projectId: string): Promise<Task[]>;
    /** Every task of every project, newest first, for the board. */
    listAll(): Promise<Task[]>;
    /** Tasks whose title or brief holds every word of the query, newest first, at most 20. */
    search(query: string): Promise<Task[]>;
    get(id: string): Promise<Task | null>;
    /** Creates the task and starts it right away. */
    start(input: NewTaskInput): Promise<Task>;
    /** Creates the task without starting it: it waits in the board's Drafts until `startSaved`. */
    saveForLater(input: NewTaskInput): Promise<Task>;
    /** Starts a task saved for later, as `start` starts a new one. `pick` is what it runs on, as for `start`. */
    startSaved(id: string, pick?: ModelPick): Promise<Task>;
    /**
     * Changes a task saved for later before it starts: its brief, project and files. The files are copied only when it
     * starts, as for a new one.
     */
    updateDraft(id: string, input: NewTaskInput): Promise<Task>;
    /** Marks a finished task as checked, so it's no longer "to check". */
    markReviewed(id: string): Promise<Task>;
    /** Puts a finished task back among the ones to check. */
    markUnreviewed(id: string): Promise<Task>;
    /** One answer per question in the round, in order, with any files the user attached to them. */
    answer(id: string, answers: string[], attachments?: string[]): Promise<Task>;
    /** The user's decision on the overwrite or delete the task asked for. */
    decide(id: string, decision: Decision): Promise<Task>;
    /** Sends another instruction to a task that finished or stopped, and runs it again. */
    followUp(id: string, text: string, attachments?: string[]): Promise<Task>;
    /** Asks for a folder, every time, and copies the files the task made into it. Null when the user cancels. */
    saveCopy(id: string): Promise<SaveResult | null>;
    stop(id: string): Promise<void>;
    /** Carries on with a task that stopped when Tost Work closed, in the same conversation. */
    resume(id: string): Promise<Task>;
    /** Shows the task's menu where the pointer is, and resolves with what the user picked, or null. */
    menu(id: string): Promise<TaskMenuAction | null>;
    rename(id: string, title: string): Promise<Task>;
    /** Opens the folder the task works in. */
    reveal(id: string): Promise<void>;
    /** Removes the task. The files stay. The window asks the user first. */
    remove(id: string): Promise<void>;
    /** Called with the full task every time it changes. Returns a function that stops listening. */
    onChange(listener: (task: Task) => void): () => void;
    /** What the agent has written of its answer so far, while it writes it. */
    draft(id: string): Promise<string>;
    /**
     * Called with each piece of an answer as the agent writes it, and with `restart` when the words so far became a
     * note in the activity, so the next piece starts a new draft. Returns a function that stops listening.
     */
    onText(listener: (taskId: string, text: string, restart?: boolean) => void): () => void;
  };
  files: {
    /** Opens the system file picker. Resolves to the chosen paths, empty when the user cancels. */
    pick(): Promise<string[]>;
    /**
     * The paths to attach for files dropped or pasted into a message. A pasted file with no place on disk, such as a
     * screenshot, is saved first. Fails on a folder.
     */
    take(files: File[]): Promise<string[]>;
    /** Reads a file the task made, used or was given, for a preview. Null when the file isn't there. */
    read(taskId: string, path: string): Promise<FileContent | null>;
    /** Opens the file in its usual app, for example Word. */
    open(taskId: string, path: string): Promise<void>;
    /** Shows the file in Finder or Explorer. */
    reveal(taskId: string, path: string): Promise<void>;
    /** Puts back the copy kept before the file was replaced. Restoring again undoes it. */
    restore(taskId: string, path: string): Promise<Task>;
  };
  /** The debug logs, kept on this computer only while Settings' debug switch is on. */
  debug: {
    /** The task's log, a line per event, with long output cut. Null when the task has no log. */
    taskLog(id: string): Promise<LogLine[] | null>;
    /** Shows the task's log file in Finder or Explorer. */
    revealTaskLog(id: string): Promise<void>;
    /** Copies the task's whole log to the clipboard. */
    copyTaskLog(id: string): Promise<void>;
    /** Shows the app's own log file in Finder or Explorer. */
    revealAppLog(): Promise<void>;
    /** Asks where to save, then writes a zip with the app log, the task logs and info.json. Nothing if the user cancels. */
    exportLogs(): Promise<void>;
    /** Tells the app log which screen opened, while debug is on: its name and ids, never a title or a file. */
    screen(route: Record<string, string>): void;
  };
  /** Work that runs by itself on a schedule, a new task each time. */
  jobs: {
    list(): Promise<Job[]>;
    create(draft: JobDraft): Promise<Job>;
    update(id: string, draft: JobDraft): Promise<Job>;
    setOn(id: string, on: boolean): Promise<Job>;
    /** Leaves out the next run, or puts it back. */
    skipOnce(id: string): Promise<Job>;
    remove(id: string): Promise<void>;
    /** Runs it now, as Try it does, and gives the task it started. */
    runNow(id: string): Promise<string>;
    /** A job changed or went, including when one of its runs started. */
    onChange(listener: (change: JobChange) => void): () => void;
  };
  /** The user's skills, SKILL.md folders in Documents/Tost Work/Skills. */
  skills: {
    /** The user's skills, then the guides Tost Work comes with (`builtIn`). */
    list(): Promise<Skill[]>;
    /** Makes a skill with this title and an empty text, ready to edit. */
    create(title: string): Promise<Skill>;
    /** Saves the editor's fields. A new title renames the skill's folder too. */
    save(id: string, draft: SkillDraft, note?: string): Promise<Skill>;
    /** Copies a built-in guide among the user's skills, to change. */
    duplicate(id: string): Promise<Skill>;
    /**
     * Brings in a SKILL.md folder or a .zip of one: the one dropped on Skills, or with none, one the user picks. Null
     * when the user cancels.
     */
    import(dropped?: File): Promise<Skill | null>;
    /** The versions Tost Work kept, newest first. */
    history(id: string): Promise<SkillVersion[]>;
    /** Puts an earlier version back. */
    restore(id: string, n: number): Promise<Skill>;
    /** Asks for files, such as a template, and copies them into the skill. */
    addFiles(id: string): Promise<Skill>;
    /** Shows the skill's folder in Finder or Explorer. */
    reveal(id: string): Promise<void>;
    /** Moves the skill's folder to the Trash. */
    remove(id: string): Promise<void>;
    /** Asks where to save the skill as a .zip, writes it and shows it in Finder. Does nothing if the user cancels. */
    exportZip(id: string): Promise<void>;
    /** Shows the native skill menu, the same as a task's plus Export, and resolves with the pick. */
    menu(id: string): Promise<SkillMenuAction | null>;
  };
}

/** What the task menu offers. Start, and the two for checking, show only when the task's state allows them. */
export type TaskMenuAction =
  | "rename"
  | "reveal"
  | "start"
  | "review"
  | "unreview"
  | "delete"
  /** Shows the task's debug log in its folder, or copies its text, while debug is on. */
  | "log-open"
  | "log-copy";

/** What the skill menu offers: Rename, Show in folder and Delete, as a task's, and Export as .zip. */
export type SkillMenuAction = "rename" | "reveal" | "delete" | "export";

/** What the project menu offers. */
export type ProjectMenuAction = "rename" | "describe" | "instructions" | "reveal" | "remove";

/** Where the panel's buttons take the main window. */
export type PanelTarget = { taskId: string } | { action: "new-task" | "settings" };

/**
 * A question the main process asks in the window's card instead of a system dialog: quitting while tasks work, or a
 * name that's already taken where a copy is saved.
 */
export interface WindowQuestion {
  id: number;
  message: string;
  detail?: string;
  /** The word on the button that goes ahead. */
  yes: string;
  /** The button is red when going ahead destroys or discards something. */
  danger?: boolean;
  /** A second way forward, such as "Keep both", shown as the main button. */
  alt?: string;
}

/** Which button was pressed: `yes`, the `alt` one, or Cancel (also Esc, a closed window, or another card open). */
export type QuestionAnswer = "yes" | "alt" | "no";
export const QUESTION_ANSWERS: readonly QuestionAnswer[] = ["yes", "alt", "no"];

/** IPC channel names, kept in one place so main and preload can't drift apart. */
export const IPC = {
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  accountStatus: "account:status",
  accountSignIn: "account:sign-in",
  accountSendCode: "account:send-code",
  accountCancel: "account:cancel",
  accountSignOut: "account:sign-out",
  accountInstall: "account:install",
  settingsChanged: "settings:changed",
  menuAction: "menu:action",
  menuState: "menu:state",
  openTask: "window:open-task",
  takePendingTask: "window:take-pending-task",
  takePendingMenu: "window:take-pending-menu",
  question: "window:question",
  takeQuestions: "window:take-questions",
  answerQuestion: "window:answer-question",
  panelOpen: "panel:open",
  panelQuit: "panel:quit",
  panelFit: "panel:fit",
  fullScreen: "window:full-screen",
  jobsList: "jobs:list",
  jobsCreate: "jobs:create",
  jobsUpdate: "jobs:update",
  jobsSetOn: "jobs:set-on",
  jobsSkipOnce: "jobs:skip-once",
  jobsRemove: "jobs:remove",
  jobsRunNow: "jobs:run-now",
  jobChanged: "jobs:changed",
  skillsList: "skills:list",
  skillsCreate: "skills:create",
  skillsSave: "skills:save",
  skillsAddFiles: "skills:add-files",
  skillsReveal: "skills:reveal",
  skillsRemove: "skills:remove",
  skillsMenu: "skills:menu",
  skillsExport: "skills:export",
  skillsDuplicate: "skills:duplicate",
  skillsImport: "skills:import",
  skillsHistory: "skills:history",
  skillsRestore: "skills:restore",
  modelsChoices: "models:choices",
  keyInfo: "key:info",
  keySave: "key:save",
  keyRemove: "key:remove",
  accountSignInEvent: "account:sign-in-event",
  projectsList: "projects:list",
  projectsCreate: "projects:create",
  projectsOverviews: "projects:overviews",
  projectsPickFolder: "projects:pick-folder",
  projectsMenu: "projects:menu",
  projectsUpdate: "projects:update",
  projectsReveal: "projects:reveal",
  projectsRemovalText: "projects:removal-text",
  projectsRemove: "projects:remove",
  tasksList: "tasks:list",
  tasksListActive: "tasks:list-active",
  tasksListForProject: "tasks:list-for-project",
  tasksListAll: "tasks:list-all",
  tasksSearch: "tasks:search",
  tasksGet: "tasks:get",
  tasksStart: "tasks:start",
  tasksSaveForLater: "tasks:save-for-later",
  tasksStartSaved: "tasks:start-saved",
  tasksUpdateDraft: "tasks:update-draft",
  tasksMarkReviewed: "tasks:mark-reviewed",
  tasksMarkUnreviewed: "tasks:mark-unreviewed",
  tasksAnswer: "tasks:answer",
  tasksStop: "tasks:stop",
  tasksResume: "tasks:resume",
  tasksDecide: "tasks:decide",
  tasksFollowUp: "tasks:follow-up",
  tasksSaveCopy: "tasks:save-copy",
  tasksMenu: "tasks:menu",
  tasksRename: "tasks:rename",
  tasksReveal: "tasks:reveal",
  tasksRemove: "tasks:remove",
  taskChanged: "tasks:changed",
  taskText: "tasks:text",
  tasksDraft: "tasks:draft",
  filesPick: "files:pick",
  filesTake: "files:take",
  filesRead: "files:read",
  filesOpen: "files:open",
  filesReveal: "files:reveal",
  filesRestore: "files:restore",
  debugTaskLog: "debug:task-log",
  debugRevealTaskLog: "debug:reveal-task-log",
  debugCopyTaskLog: "debug:copy-task-log",
  debugRevealAppLog: "debug:reveal-app-log",
  debugExportLogs: "debug:export-logs",
  debugScreen: "debug:screen",
  licensesOpen: "licenses:open",
} as const;
