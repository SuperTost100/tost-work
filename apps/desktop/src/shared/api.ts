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
    stop(id: string): Promise<void>;
    /** Called with the full task every time it changes. Returns a function that stops listening. */
    onChange(listener: (task: Task) => void): () => void;
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
  taskChanged: "tasks:changed",
} as const;
