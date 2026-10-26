import type { Project, Settings, Task } from "./model";

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

/** Codex, which the ChatGPT subscription runs through. */
export interface CodexAccount {
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
  | { type: "done"; account: CodexAccount }
  | { type: "error"; message: string };

/** What the preload exposes to the interface as `window.tostWork`. */
export interface TostWorkApi {
  platform: "darwin" | "win32" | "linux";
  versions: { app: string; electron: string };
  settings: {
    get(): Promise<Settings>;
    /** Saves the fields given and returns all settings. */
    update(patch: Partial<Settings>): Promise<Settings>;
  };
  account: {
    status(): Promise<CodexAccount>;
    /** Opens the ChatGPT sign-in page through Codex. Progress arrives through `onSignIn`. */
    signIn(): Promise<void>;
    sendCode(code: string): Promise<void>;
    cancel(): Promise<void>;
    onSignIn(listener: (event: SignInEvent) => void): () => void;
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
