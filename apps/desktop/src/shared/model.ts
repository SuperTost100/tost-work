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
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What an engine reports while it works. The task screen is built from these. */
export type EngineEvent =
  | { type: "plan"; steps: Step[] }
  | { type: "message"; text: string }
  | { type: "file"; change: FileChange }
  | { type: "question"; question: Question }
  | { type: "approval"; approval: Approval }
  | { type: "review"; review: Review }
  | { type: "done" }
  | { type: "failed"; error: string }
  | { type: "stopped" };
