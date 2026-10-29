/** The data Tost Work keeps about projects and tasks. Shared by the main process and the interface. */

import type { JobSchedule } from "./schedule";

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

/** One round of questions. The first is `text` and `options`, so tasks saved before rounds still read; the rest are in `more`. */
export interface Question {
  id: string;
  text: string;
  options: string[];
  more?: QuestionItem[];
}

export interface QuestionItem {
  text: string;
  options: string[];
}

/** The most questions the agent may ask in one round. It can ask another round after reading the answers. */
export const MAX_QUESTIONS = 16;

/** Every question in the round, in order. */
export const questionItems = (q: Question): QuestionItem[] => [{ text: q.text, options: q.options }, ...(q.more ?? [])];

export interface AnsweredQuestion {
  question: string;
  answer: string;
}

/** The answers to a round as one message: just the answer for one question, each question and its answer for several. */
export function answersText(q: Question, answers: string[]): string {
  const items = questionItems(q);
  if (items.length === 1) return answers[0] ?? "";
  return items.map((item, i) => `${item.text}\n→ ${answers[i] ?? ""}`).join("\n\n");
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
  /** For the answers to a round of questions: each question with its answer, shown as one line that opens. */
  answers?: AnsweredQuestion[];
  /** True for an instruction sent after the task finished, which starts a new run with its own steps. */
  followUp?: boolean;
}

/** What the agent did, in kinds the task screen words: "Reading note.txt", "Searching the web: …". */
export type ActivityKind =
  | "read"
  | "write"
  | "edit"
  | "folder"
  | "search-files"
  | "web"
  | "page"
  | "command"
  | "work"
  | "skill"
  | "pdf"
  /** A few words the agent wrote to the user between its steps, such as "the table is nearly done". */
  | "note";

export interface Activity {
  kind: ActivityKind;
  /** The file, search or site, when there is one. */
  target?: string;
  at: string;
  /**
   * How many messages the task had when it happened, so the line shows where it happened, between those messages and
   * the next. Missing on tasks from before, whose lines all show at the end.
   */
  msg?: number;
}

/** The most activity lines a task keeps; older ones drop off. */
export const MAX_ACTIVITY = 300;

export interface Task {
  id: string;
  /** null for a quick edit, which has no project. */
  projectId: string | null;
  title: string;
  brief: string;
  attachments: string[];
  /** The folder the agent works in: the project folder, or a temporary folder for a task without a project. */
  workdir: string;
  /** The agent the task runs on. Missing on tasks from before Claude, which all ran on Codex. */
  provider?: AgentProvider;
  /** "key" when the task runs on the course key rather than the subscription signed in to the agent. */
  auth?: "account" | "key";
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
  /** Stopped because Tost Work closed while the task was working, not by the user. Resume carries on. */
  interrupted?: boolean;
  /** The skills the agent read, by folder name, in any run. Built-in guides count too. */
  skillsUsed?: string[];
  /** What the agent did, a line per tool call, across every run. Missing on tasks from before. */
  activity?: Activity[];
  /** Set on a run of a job. */
  jobId?: string;
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
  | { type: "activity"; kind: ActivityKind; target?: string }
  | { type: "message"; text: string }
  /** Words of the agent's answer as it writes them, shown live and never saved: the whole answer comes as a message. */
  | { type: "text"; text: string }
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

export type LoginOpens = "menuBar" | "window";
export const LOGIN_OPENS: LoginOpens[] = ["menuBar", "window"];

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
  /** The account new tasks run on. null picks the first one signed in. */
  defaultAi: AiId | null;
  /** All notifications on or off: the one question setup asks. */
  notifications: boolean;
  /** How each kind of notification shows, while `notifications` is on. */
  notify: Record<NotifyKind, NotifyLevel>;
  /** Tost Work starts when the user logs in to the computer, so jobs run on time. */
  openAtLogin: boolean;
  /** What a start at login shows: only the menu-bar icon, or the window too. */
  loginOpens: LoginOpens;
  /** Closing the window leaves Tost Work running in the menu bar (or the tray). */
  stayInMenuBar: boolean;
  /** The sidebar is hidden, so the main area has the whole window. */
  sidebarHidden: boolean;
  setupDone: boolean;
}

/** What a notification is about: a task or job that needs the user, failed, or finished. */
export type NotifyKind = "needsYou" | "failed" | "done";
export const NOTIFY_KINDS: NotifyKind[] = ["needsYou", "failed", "done"];
/** "quiet" shows without a sound. */
export type NotifyLevel = "off" | "quiet" | "normal";
export const NOTIFY_LEVELS: NotifyLevel[] = ["off", "quiet", "normal"];

/** The subscriptions, each signed in through its agent CLI. */
export type Subscription = "chatgpt" | "claude";
export const SUBSCRIPTIONS: Subscription[] = ["chatgpt", "claude"];
/** The ways to connect an AI: a subscription, or the API key from a course. */
export type AiId = Subscription | "key";
export const AIS: AiId[] = ["chatgpt", "claude", "key"];
/** The agent CLI each subscription runs through. */
export type AgentProvider = "codex" | "claude";
export const PROVIDER_OF: Record<Subscription, AgentProvider> = { chatgpt: "codex", claude: "claude" };

/** Whose API key it is: OpenAI's runs through Codex, Anthropic's through Claude Code. */
export type KeyVendor = "openai" | "anthropic";
export const KEY_PROVIDER: Record<KeyVendor, AgentProvider> = { openai: "codex", anthropic: "claude" };
/** The saved course key as the interface sees it: never the key, only whose it is and how it ends. */
export interface CourseKey {
  vendor: KeyVendor;
  last4: string;
  /** Kept in memory only, until the app closes, because this computer has no secure storage. */
  untilClosed?: boolean;
}
/** Whose key this is, from how it starts, or null for something that isn't an API key. */
export const keyVendor = (key: string): KeyVendor | null => {
  if (!/^sk-[\w-]{16,}$/.test(key)) return null;
  return key.startsWith("sk-ant-") ? "anthropic" : "openai";
};

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
  defaultAi: null,
  notifications: true,
  // Finished work shows in the app; only what needs the user, or went wrong, interrupts them.
  notify: { needsYou: "normal", failed: "normal", done: "off" },
  openAtLogin: false,
  loginOpens: "menuBar",
  stayInMenuBar: true,
  sidebarHidden: false,
  setupDone: false,
};

/** The longest "what else to know" note the AI gets with every task. */
export const NOTES_MAX = 4000;

/** The longest message a task takes, about 25 pages: a longer text goes in as an attached file. */
/** The longest project description, as created and as edited. */
export const DESCRIPTION_MAX = 2000;

export const BRIEF_MAX = 100_000;

/** One of the user's skills: a SKILL.md folder in Documents/Tost Work/Skills. */
export interface Skill {
  /** The folder's name, which is also the skill's `name` for skills made here. */
  id: string;
  name: string;
  /** What people see: the SKILL.md's first heading. */
  title: string;
  /** When to use it: the frontmatter description, which the agent reads to pick a skill. */
  description: string;
  /** What to do: the SKILL.md's text after its heading. */
  steps: string;
  /** The other files in the folder, such as a template, by name. */
  files: string[];
  folder: string;
  updatedAt: string;
  /** One of the guides Tost Work comes with, such as Word's: read-only, and copied to change it. Its id starts with @. */
  builtIn?: boolean;
  /** The latest version Tost Work kept, 0 for a skill never saved here. */
  version?: number;
}

/** A version of a skill Tost Work kept when it was saved. */
export interface SkillVersion {
  n: number;
  at: string;
  /** What changed, in the user's words. */
  note?: string;
  /** Set on versions kept by Restore before 0.0.7, which added a copy of the old version. */
  restoredFrom?: number;
}

/** What the editor saves. */
export interface SkillDraft {
  title: string;
  description: string;
  steps: string;
}

/** Work that runs by itself on a schedule, as a new task each time, in one project. */
export interface Job {
  id: string;
  projectId: string;
  /** What it does, in a few words: the name on its card and on each run's task. */
  title: string;
  /** What each run is asked to do. */
  brief: string;
  schedule: JobSchedule;
  /** A run missed while the computer was off or asleep: run once when it's back, or wait for the next one. */
  missed: "run" | "skip";
  /** The subfolder of the project where each run saves its files, or "" to let the agent choose. */
  output: string;
  on: boolean;
  /** The run Skip once leaves out, as an ISO time, until it has passed. */
  skip: string | null;
  /** The latest run time dealt with, run or not, so a run never happens twice. */
  handled: string | null;
  /** How the latest run time went: the task it started, or why none started. */
  last: JobLast | null;
  createdAt: string;
  updatedAt: string;
}

export type JobLast =
  | { at: string; taskId: string }
  /** Not run because the run before it was still waiting for the user, or still working. */
  | { at: string; skipped: "waiting" }
  /** Not run because the computer was off at the time and the job waits for the next one. */
  | { at: string; skipped: "missed" }
  /** Couldn't start, for example with no AI signed in. */
  | { at: string; error: string };

export type JobDraft = Pick<Job, "projectId" | "title" | "brief" | "schedule" | "missed" | "output">;

/** A job runs again only if the run before it is over: one that needs the user waits for them. */
export const busyStatus = (status: TaskStatus | undefined): boolean => status === "running" || status === "needs-you";

/** What a project's card says about its tasks: how many, which need the user or are working, and the last file made. */
export interface ProjectOverview {
  tasks: number;
  working: number;
  needsYou: number;
  /** The newest file a task made, by its name, and when that task last changed. */
  lastResult: { name: string; at: string } | null;
}

/** The newest file a task made and still has, or null. */
export function lastMade(task: Pick<Task, "files" | "updatedAt">): { name: string; at: string } | null {
  const file = task.files.findLast((f) => f.role === "made" && f.kind !== "delete");
  const name = file?.path.split(/[\\/]/).filter(Boolean).pop();
  return name ? { name, at: task.updatedAt } : null;
}
