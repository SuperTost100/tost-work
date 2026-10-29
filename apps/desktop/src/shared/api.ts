import type { InstallResult } from "./install";
import type {
  AgentProvider,
  CourseKey,
  Job,
  JobDraft,
  Project,
  Settings,
  Skill,
  SkillDraft,
  SkillVersion,
  Task,
} from "./model";

export interface NewProjectInput {
  name: string;
  description?: string;
  folder: string;
}

export interface ProjectPatch {
  name?: string;
  instructions?: string;
}

export interface NewTaskInput {
  projectId: string | null;
  brief: string;
  attachments?: string[];
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
  | "send"
  | "stop"
  | "rename"
  | "reveal"
  | "toggle-sidebar";

/** A question before something that can't be undone: what will happen, more detail if needed, and the button's word. */
export interface Confirmation {
  message: string;
  detail?: string;
  yes: string;
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
  /**
   * Asks before something that can't be undone, in the system's own dialog with Cancel as the default button, as
   * deleting a task does. Resolves true when the user picks `yes`.
   */
  confirm(question: Confirmation): Promise<boolean>;
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
    taskCounts(): Promise<Record<string, number>>;
    /** Opens the system folder picker, in `defaultPath` when given. Resolves to null when the user cancels. */
    pickFolder(defaultPath?: string): Promise<string | null>;
    /** Shows the project's menu where the pointer is, and resolves with what the user picked, or null. */
    menu(id: string): Promise<ProjectMenuAction | null>;
    /** Saves the fields given, the name or the instructions the AI reads in every task. */
    update(id: string, patch: ProjectPatch): Promise<Project>;
    /** Opens the project's folder. */
    reveal(id: string): Promise<void>;
    /**
     * Asks first, then removes the project with its tasks and jobs from the app, after stopping the ones working.
     * The folder and its files stay. Resolves false when the user changes their mind.
     */
    remove(id: string): Promise<boolean>;
  };
  tasks: {
    /** The 50 most recently updated tasks. */
    list(): Promise<Task[]>;
    /** Every task working or waiting for the user, however old: the recent list stops at 50. */
    listActive(): Promise<Task[]>;
    /** Every task of one project. */
    listForProject(projectId: string): Promise<Task[]>;
    get(id: string): Promise<Task | null>;
    /** Creates the task and starts it right away. */
    start(input: NewTaskInput): Promise<Task>;
    /** One answer per question in the round, in order. */
    answer(id: string, answers: string[]): Promise<Task>;
    /** Allows or refuses the overwrite or delete the task asked for. */
    decide(id: string, allow: boolean): Promise<Task>;
    /** Sends another instruction to a task that finished or stopped, and runs it again. */
    followUp(id: string, text: string): Promise<Task>;
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
    /** Asks first, then removes the task. The files stay. Resolves false when the user changes their mind. */
    remove(id: string): Promise<boolean>;
    /** Called with the full task every time it changes. Returns a function that stops listening. */
    onChange(listener: (task: Task) => void): () => void;
    /** What the agent has written of its answer so far, while it writes it. */
    draft(id: string): Promise<string>;
    /** Called with each piece of an answer as the agent writes it. Returns a function that stops listening. */
    onText(listener: (taskId: string, text: string) => void): () => void;
  };
  files: {
    /** Opens the system file picker. Resolves to the chosen paths, empty when the user cancels. */
    pick(): Promise<string[]>;
    /** Reads a file the task made, used or was given, for a preview. Null when the file isn't there. */
    read(taskId: string, path: string): Promise<FileContent | null>;
    /** Opens the file in its usual app, for example Word. */
    open(taskId: string, path: string): Promise<void>;
    /** Shows the file in Finder or Explorer. */
    reveal(taskId: string, path: string): Promise<void>;
    /** Puts back the copy kept before the file was replaced. Restoring again undoes it. */
    restore(taskId: string, path: string): Promise<Task>;
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
    /** Shows the native skill menu, the same as a task's, and resolves with the pick. */
    menu(id: string): Promise<TaskMenuAction | null>;
  };
}

/** What the task menu offers. The skill menu offers the same. */
export type TaskMenuAction = "rename" | "reveal" | "delete";

/** What the project menu offers. */
export type ProjectMenuAction = "rename" | "instructions" | "reveal" | "remove";

/** Where the panel's buttons take the main window. */
export type PanelTarget = { taskId: string } | { action: "new-task" | "settings" };

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
  panelOpen: "panel:open",
  panelQuit: "panel:quit",
  confirm: "dialog:confirm",
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
  skillsDuplicate: "skills:duplicate",
  skillsImport: "skills:import",
  skillsHistory: "skills:history",
  skillsRestore: "skills:restore",
  keyInfo: "key:info",
  keySave: "key:save",
  keyRemove: "key:remove",
  accountSignInEvent: "account:sign-in-event",
  projectsList: "projects:list",
  projectsCreate: "projects:create",
  projectsTaskCounts: "projects:task-counts",
  projectsPickFolder: "projects:pick-folder",
  projectsMenu: "projects:menu",
  projectsUpdate: "projects:update",
  projectsReveal: "projects:reveal",
  projectsRemove: "projects:remove",
  tasksList: "tasks:list",
  tasksListActive: "tasks:list-active",
  tasksListForProject: "tasks:list-for-project",
  tasksGet: "tasks:get",
  tasksStart: "tasks:start",
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
  filesRead: "files:read",
  filesOpen: "files:open",
  filesReveal: "files:reveal",
  filesRestore: "files:restore",
} as const;
