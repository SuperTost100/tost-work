/** The data Tost Work keeps about projects and tasks. Shared by the main process and the interface. */

export interface Project {
  id: string;
  name: string;
  description: string;
  /** Absolute path of the folder the AI works in. */
  folder: string;
  /** Text every task in this project reads first. */
  instructions: string;
  createdAt: string;
}

export type TaskStatus = "draft" | "running" | "needs-you" | "done" | "failed" | "stopped";

export interface Step {
  text: string;
  status: "pending" | "in_progress" | "done";
}

export interface FileChange {
  path: string;
  kind: "add" | "update" | "delete";
  /** Files the task read count as "used", the rest as "made by this task". */
  role: "made" | "used";
}

export interface Question {
  id: string;
  text: string;
  options: string[];
}

export interface Approval {
  id: string;
  /** What the agent wants to do, for example overwrite or delete a file. */
  action: "overwrite" | "delete";
  paths: string[];
  /** Paths already handled when an earlier try failed part way, so a retry does only the rest. */
  done?: string[];
}

/** A copy Tost Work kept before a file was replaced, so the user can put it back. */
export interface KeptCopy {
  /** The file in the task's folder. */
  path: string;
  /** Where the copy is kept, in the app's own data folder. */
  copy: string;
  at: string;
  /** "overwrite" when the agent replaced the file, "restore" when the user put an older copy back. */
  reason: "overwrite" | "restore";
}

export interface ReviewItem {
  text: string;
  detail?: string;
}

export interface Review {
  asked: ReviewItem[];
  decided: ReviewItem[];
  checkYourself: ReviewItem[];
}

export interface Message {
  from: "user" | "agent";
  text: string;
  at: string;
  /** True for an instruction sent after the task finished, which starts a new run with its own steps. */
  followUp?: boolean;
}

export interface Task {
  id: string;
  /** null for a quick edit, which has no project. */
  projectId: string | null;
  title: string;
  brief: string;
  attachments: string[];
  /** The folder the agent works in: the project folder, or a temporary folder for a task without a project. */
  workdir: string;
  model: string;
  effort: string;
  status: TaskStatus;
  steps: Step[];
  files: FileChange[];
  messages: Message[];
  question: Question | null;
  approval: Approval | null;
  review: Review | null;
  /** Missing on tasks saved before copies were kept. */
  kept?: KeptCopy[];
  /** The agent's conversation, so a follow-up continues it. Set by the real engine. */
  sessionId?: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What an engine reports while it works. The task screen is built from these. */
export type EngineEvent =
  | { type: "session"; sessionId: string }
  | { type: "plan"; steps: Step[] }
  | { type: "message"; text: string }
  | { type: "file"; change: FileChange }
  | { type: "question"; question: Question }
  /** The agent stopped waiting for this question or approval, so it comes off the task. */
  | { type: "withdrawn"; id: string }
  | { type: "approval"; approval: Approval }
  | { type: "review"; review: Review }
  | { type: "done" }
  | { type: "failed"; error: string }
  | { type: "stopped" };

export type Level = "beginner" | "intermediate" | "advanced" | "expert";

/** The user's choices, kept on this computer. */
export interface Settings {
  /** Shown in the greeting and on the avatar. Empty until setup asks for it. */
  name: string;
  /** What the user does, in their words, from the profile. The agent reads it with every task. */
  work: string;
  /** Anything else the agent should know about them, from the profile. */
  notes: string;
  level: Level;
  /** null follows the system language. */
  language: "en" | "it" | null;
  /** Sections the user turned on or off by hand. A section missing here follows the level. */
  sections: Partial<Record<SectionKey, boolean>>;
  textSize: TextSize;
  theme: Theme;
  setupDone: boolean;
}

export const LEVELS: Level[] = ["beginner", "intermediate", "advanced", "expert"];
export type TextSize = "small" | "normal" | "large";
export const TEXT_SIZES: TextSize[] = ["small", "normal", "large"];
export type Theme = "light" | "dark" | "system";
export const THEMES: Theme[] = ["light", "dark", "system"];

/** The sections a user can turn off, and the lowest level that shows each one. */
export const SECTION_LEVEL = {
  skills: "beginner",
  quickEdit: "beginner",
  jobs: "intermediate",
  board: "intermediate",
} as const satisfies Record<string, Level>;
export type SectionKey = keyof typeof SECTION_LEVEL;

/** Whether a section shows: the user's own choice if they made one, otherwise their level's. */
export const sectionOn = (settings: Pick<Settings, "level" | "sections">, key: SectionKey): boolean =>
  settings.sections[key] ?? LEVELS.indexOf(settings.level) >= LEVELS.indexOf(SECTION_LEVEL[key]);

export const DEFAULT_SETTINGS: Settings = {
  name: "",
  work: "",
  notes: "",
  level: "beginner",
  language: null,
  sections: {},
  textSize: "normal",
  theme: "system",
  setupDone: false,
};
