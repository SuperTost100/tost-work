import type { Project, Task } from "./model";

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

/** What the preload exposes to the interface as `window.tostWork`. */
export interface TostWorkApi {
  platform: "darwin" | "win32" | "linux";
  versions: { app: string; electron: string };
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
    /** Sends another instruction to a task that finished or stopped, and runs it again. */
    followUp(id: string, text: string): Promise<Task>;
    /** Asks for a folder, every time, and copies the files the task made into it. Null when the user cancels. */
    saveCopy(id: string): Promise<SaveResult | null>;
    stop(id: string): Promise<void>;
    /** Called with the full task every time it changes. Returns a function that stops listening. */
    onChange(listener: (task: Task) => void): () => void;
  };
  files: {
    /** Opens the system file picker. Resolves to the chosen paths, empty when the user cancels. */
    pick(): Promise<string[]>;
    /** Reads a file the task made, used or was given, for a preview. */
    read(taskId: string, path: string): Promise<FileContent>;
    /** Opens the file in its usual app, for example Word. */
    open(taskId: string, path: string): Promise<void>;
    /** Shows the file in Finder or Explorer. */
    reveal(taskId: string, path: string): Promise<void>;
  };
}

/** IPC channel names, kept in one place so main and preload can't drift apart. */
export const IPC = {
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
  tasksFollowUp: "tasks:follow-up",
  tasksSaveCopy: "tasks:save-copy",
  taskChanged: "tasks:changed",
  filesPick: "files:pick",
  filesRead: "files:read",
  filesOpen: "files:open",
  filesReveal: "files:reveal",
} as const;
