import type { InstallResult } from "./install";
import type { AgentProvider, CourseKey, Project, Settings, Task } from "./model";

export interface NewProjectInput {
  name: string;
  description?: string;
  folder: string;
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

export type MenuAction = "new-task" | "new-project" | "quick-edit" | "settings" | "send" | "stop" | "rename" | "reveal";

/** What the preload exposes to the interface as `window.tostWork`. */
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
  /** Tells the menu bar whether a task is open and working, so its Task items turn on and off with it. */
  menuState(state: MenuState): void;
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
    /** Opens the system folder picker. Resolves to null when the user cancels. */
    pickFolder(): Promise<string | null>;
  };
  tasks: {
    /** The 50 most recently updated tasks. */
    list(): Promise<Task[]>;
    /** Every task of one project. */
    listForProject(projectId: string): Promise<Task[]>;
    get(id: string): Promise<Task | null>;
    /** Creates the task and starts it right away. */
    start(input: NewTaskInput): Promise<Task>;
    answer(id: string, answer: string): Promise<Task>;
    /** Allows or refuses the overwrite or delete the task asked for. */
    decide(id: string, allow: boolean): Promise<Task>;
    /** Sends another instruction to a task that finished or stopped, and runs it again. */
    followUp(id: string, text: string): Promise<Task>;
    /** Asks for a folder, every time, and copies the files the task made into it. Null when the user cancels. */
    saveCopy(id: string): Promise<SaveResult | null>;
    stop(id: string): Promise<void>;
    /** Shows the task's menu where the pointer is, and resolves with what the user picked, or null. */
    menu(id: string): Promise<TaskMenuAction | null>;
    rename(id: string, title: string): Promise<Task>;
    /** Opens the folder the task works in. */
    reveal(id: string): Promise<void>;
    /** Asks first, then removes the task. The files stay. Resolves false when the user changes their mind. */
    remove(id: string): Promise<boolean>;
    /** Called with the full task every time it changes. Returns a function that stops listening. */
    onChange(listener: (task: Task) => void): () => void;
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
}

/** What the task menu offers. */
export type TaskMenuAction = "rename" | "reveal" | "delete";

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
  keyInfo: "key:info",
  keySave: "key:save",
  keyRemove: "key:remove",
  accountSignInEvent: "account:sign-in-event",
  projectsList: "projects:list",
  projectsCreate: "projects:create",
  projectsTaskCounts: "projects:task-counts",
  projectsPickFolder: "projects:pick-folder",
  tasksList: "tasks:list",
  tasksListForProject: "tasks:list-for-project",
  tasksGet: "tasks:get",
  tasksStart: "tasks:start",
  tasksAnswer: "tasks:answer",
  tasksStop: "tasks:stop",
  tasksDecide: "tasks:decide",
  tasksFollowUp: "tasks:follow-up",
  tasksSaveCopy: "tasks:save-copy",
  tasksMenu: "tasks:menu",
  tasksRename: "tasks:rename",
  tasksReveal: "tasks:reveal",
  tasksRemove: "tasks:remove",
  taskChanged: "tasks:changed",
  filesPick: "files:pick",
  filesRead: "files:read",
  filesOpen: "files:open",
  filesReveal: "files:reveal",
  filesRestore: "files:restore",
} as const;
