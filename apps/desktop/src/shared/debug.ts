/**
 * The per-task debug log, as the task screen reads it. Each line is one JSON object with the time it was written: the
 * line that opens a run, cli-funnel's events as they came, or the line that says the file reached its size limit.
 */

/** What a run was started with, written before its first event. */
export interface RunLine {
  type: "run";
  at: string;
  provider: string;
  model: string;
  effort: string;
  access: string;
  cwd: string;
  sessionId?: string;
  followUp: boolean;
}

/** Written once when the file reaches its size limit. Nothing is written after it. */
export interface CappedLine {
  type: "log.capped";
  at: string;
  bytes: number;
}

/** A cli-funnel event, kept as it came: its fields depend on its type. */
export interface EventLine {
  type: string;
  at: string;
  [field: string]: unknown;
}

export type LogLine = RunLine | CappedLine | EventLine;

/** The longest output the task screen shows for one tool call. The whole output stays in the log file. */
export const OUTPUT_MAX = 20_000;

/** One tool call, joined from its tool.start and tool.end. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  error?: string;
  /** The output's full length, when it was cut to OUTPUT_MAX. */
  cut?: number;
  /** What the model thought between the previous tool call and this one. */
  reasoning: string;
  /**
   * The subagent call this one ran under. cli-funnel doesn't send it yet: when it does, these calls show under their
   * "Handing off" line.
   */
  parentId?: string;
  /** What the subagent started by this call wrote, when it is one. */
  notes: string[];
}

export interface DebugView {
  calls: Map<string, ToolCall>;
  /** What the model thought after the last tool call of the latest run. */
  finalReasoning: string;
  /** The latest session id the log saw. */
  sessionId?: string;
  /** Every usage event added up. */
  tokens: { input: number; output: number } | null;
  capped: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The tool calls, thinking and token use in a task's log. */
export function debugView(lines: LogLine[]): DebugView {
  const calls = new Map<string, ToolCall>();
  let thinking = "";
  let sessionId: string | undefined;
  let tokens = null as DebugView["tokens"];
  let capped = false;
  for (const line of lines) {
    const l = line as EventLine;
    switch (l.type) {
      case "run":
        // A new run starts afresh: thinking left over from the last one was about its answer, not this run's calls.
        thinking = "";
        sessionId = str(l.sessionId) ?? sessionId;
        break;
      case "session":
        sessionId = str(l.sessionId) ?? sessionId;
        break;
      case "reasoning.delta":
        thinking += str(l.text) ?? "";
        break;
      case "tool.start": {
        const id = str(l.id);
        if (!id) break;
        const parentId = str(l.parentId);
        calls.set(id, {
          id,
          name: str(l.name) ?? "",
          input: l.input,
          reasoning: thinking.trim(),
          ...(parentId ? { parentId } : {}),
          notes: [],
        });
        thinking = "";
        break;
      }
      case "tool.end": {
        const call = calls.get(str(l.id) ?? "");
        if (!call) break;
        const output = str(l.output);
        const error = str(l.error);
        const cut = typeof l.cut === "number" ? l.cut : undefined;
        calls.set(call.id, {
          ...call,
          ...(output !== undefined ? { output } : {}),
          ...(error !== undefined ? { error } : {}),
          ...(cut ? { cut } : {}),
        });
        break;
      }
      case "subagent.text": {
        const call = calls.get(str(l.parentId) ?? "");
        const text = str(l.text)?.trim();
        if (call && text) call.notes.push(text);
        break;
      }
      case "usage": {
        const usage = (l.usage ?? {}) as Record<string, unknown>;
        tokens = {
          input: (tokens?.input ?? 0) + num(usage.inputTokens),
          output: (tokens?.output ?? 0) + num(usage.outputTokens),
        };
        break;
      }
      case "log.capped":
        capped = true;
        break;
    }
  }
  return { calls, finalReasoning: thinking.trim(), sessionId, tokens, capped };
}

/** The calls made under a subagent's call, in the order they started. */
export const childCalls = (view: DebugView, parentId: string): ToolCall[] =>
  [...view.calls.values()].filter((c) => c.parentId === parentId);

/** Input fields that are the whole point of a call when they're its only field. */
const PLAIN_FIELDS = ["file_path", "notebook_path", "path", "query", "url", "pattern"];

/** A tool call's input as a person reads it: the command, the path or the search alone, pretty JSON otherwise. */
export function inputText(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input;
  if (typeof input !== "object") return String(input);
  const fields = input as Record<string, unknown>;
  if (typeof fields.command === "string") return fields.command;
  const keys = Object.keys(fields);
  const only = keys[0];
  if (keys.length === 1 && only && PLAIN_FIELDS.includes(only) && typeof fields[only] === "string")
    return fields[only] as string;
  return JSON.stringify(input, null, 2);
}

/** The output cut to OUTPUT_MAX, with its full length when it was longer. */
export function cutOutput(text: string): { text: string; cut?: number } {
  return text.length > OUTPUT_MAX ? { text: text.slice(0, OUTPUT_MAX), cut: text.length } : { text };
}
