import type { AgentProvider, EngineEvent, Project, Task } from "../../shared/model";

export interface RunContext {
  task: Task;
  project: Project | null;
  /** Folder the agent works in: the project folder, or the quick edit's temporary folder. */
  workdir: string;
  /** The user's new message when this run continues a finished task, null on the first run. */
  followUp: string | null;
  signal: AbortSignal;
}

/** Something that does the work of a task: the real one wraps cli-funnel, the fake one replays a script. */
export interface Engine {
  /** The agent, model and effort a new task starts with. */
  defaults(): Promise<{ provider: AgentProvider; model: string; effort: string }>;
  run(ctx: RunContext): AsyncIterable<EngineEvent>;
  /**
   * The user picked an answer, or wrote one, for the question the engine asked. Returns false when no run is waiting
   * for it, because the agent ended its turn to wait: then the runner sends the answer as the next message.
   */
  answer(taskId: string, questionId: string, answer: string): boolean;
  /** The user allowed or refused an overwrite or delete. Returns false, like `answer`, when no run is waiting. */
  decide(taskId: string, approvalId: string, allow: boolean): boolean;
}
