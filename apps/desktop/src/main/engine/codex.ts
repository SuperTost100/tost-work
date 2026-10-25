import { randomUUID } from "node:crypto";
import type { ApprovalDecision, ApprovalRequest, Funnel, QuestionAnswers, QuestionRequest } from "cli-funnel";
import type { EngineEvent, Review } from "../../shared/model";
import type { ToolHandler } from "../mcp/server";
import type { Engine, RunContext } from "./engine";
import { instructionsFor } from "./instructions";

/** How long a Tost Work tool may wait for the user before the agent gives up: an hour. */
const TOOL_TIMEOUT_SEC = 3600;

/**
 * Commands that delete files. They are refused, so deletions go through the approval card and the Trash.
 * shortcut: a script that deletes in another way still deletes; snapshot the folder before each run to close the gap.
 */
const DELETES =
  /(^|[\s;&|(`])(rm|rmdir|del|erase|rd|unlink|shred|trash)(\s|$)|os\.(remove|unlink|rmdir)|shutil\.rmtree|Remove-Item|\.unlink\(|fs\.rm/i;

/** The parts of cli-funnel the engine uses, so tests can stand in for Codex. */
export type CodexFunnel = Pick<Funnel, "stream" | "models">;

/** The tool server's session calls, so the engine can open one per run. */
export interface ToolSessions {
  open(taskId: string): { url: string; token: string };
  close(token: string): void;
}

/** Events from three sources (the run, the tools, the callbacks) merged into one stream for the runner. */
class Channel<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const item = this.items.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }
}

interface Live {
  channel: Channel<EngineEvent>;
  signal: AbortSignal;
  workdir: string;
  /** Files this task made, which the agent may change again without asking. */
  made: Set<string>;
}

/** The paths and kinds of a Codex file change, from the item cli-funnel passes with the approval. */
function changesOf(input: unknown): { path: string; kind: string }[] {
  const changes = (input as { changes?: { changes?: unknown } } | undefined)?.changes;
  const list = Array.isArray(changes) ? changes : (changes as { changes?: unknown } | undefined)?.changes;
  if (!Array.isArray(list)) return [];
  return list.flatMap((c: { path?: unknown; kind?: unknown }) => {
    if (typeof c?.path !== "string") return [];
    const kind = typeof c.kind === "string" ? c.kind : (c.kind as { type?: string } | undefined)?.type;
    return [{ path: c.path, kind: kind ?? "update" }];
  });
}

/**
 * Runs tasks on Codex through cli-funnel, with the ChatGPT sign-in. Codex works at `supervised`: its sandbox keeps
 * writes inside the folder, every file change comes here first, and Tost Work's tools carry questions, approvals,
 * files and the review.
 */
export class CodexEngine implements Engine, ToolHandler {
  private live = new Map<string, Live>();
  private waiting = new Map<string, (reply: string | boolean | null) => void>();
  private tools: ToolSessions | null = null;

  constructor(
    private funnel: CodexFunnel,
    private language: () => "en" | "it",
  ) {}

  /** The tool server takes this engine as its handler, so it's attached after both exist. */
  attachTools(tools: ToolSessions): void {
    this.tools = tools;
  }

  async defaults(): Promise<{ model: string; effort: string }> {
    // Codex lists its recommended model first.
    const [first] = await this.funnel.models("codex");
    if (!first) throw new Error("Codex lists no models. Check that it's installed and signed in.");
    return { model: first.id, effort: first.defaultEffort ?? first.efforts[0]?.id ?? "medium" };
  }

  async *run({ task, project, workdir, followUp, signal }: RunContext): AsyncIterable<EngineEvent> {
    if (!this.tools) throw new Error("The tool server isn't attached");
    const channel = new Channel<EngineEvent>();
    const made = new Set(task.files.filter((f) => f.role === "made" && f.kind !== "delete").map((f) => f.path));
    this.live.set(task.id, { channel, signal, workdir, made });
    const session = this.tools.open(task.id);
    const tools = this.tools;

    const stream = this.funnel.stream({
      selection: { provider: "codex", model: task.model, effort: task.effort, cwd: workdir, access: "supervised" },
      prompt: followUp ?? task.brief,
      system: instructionsFor(task, project, this.language()),
      sessionId: task.sessionId,
      signal,
      planTool: true,
      mcpServers: {
        tost_work: {
          type: "http",
          url: session.url,
          headers: { Authorization: `Bearer ${session.token}` },
          toolTimeoutSec: TOOL_TIMEOUT_SEC,
          autoApprove: true,
        },
      },
      onApproval: (request) => this.policy(task.id, request),
      onQuestion: (request) => this.questions(task.id, request),
    });

    const pump = (async () => {
      try {
        for await (const event of stream) {
          if (event.type === "session") channel.push({ type: "session", sessionId: event.sessionId });
          else if (event.type === "plan") channel.push({ type: "plan", steps: event.steps });
          else if (event.type === "file.change" && event.status === "done") {
            const path = event.movedTo ?? event.path;
            if (event.kind === "delete") made.delete(path);
            else made.add(path);
            channel.push({ type: "file", change: { path, kind: event.kind, role: "made" } });
          }
        }
        const result = await stream.result;
        if (result.finishReason === "cancelled") channel.push({ type: "stopped" });
        else {
          if (result.text.trim()) channel.push({ type: "message", text: result.text.trim() });
          channel.push({ type: "done" });
        }
      } catch (err) {
        if (signal.aborted) channel.push({ type: "stopped" });
        else channel.push({ type: "failed", error: err instanceof Error ? err.message : String(err) });
      } finally {
        tools.close(session.token);
        this.live.delete(task.id);
        channel.close();
      }
    })();

    yield* channel;
    await pump;
  }

  answer(_taskId: string, questionId: string, answer: string): void {
    this.waiting.get(questionId)?.(answer);
  }

  decide(_taskId: string, approvalId: string, allow: boolean): void {
    this.waiting.get(approvalId)?.(allow);
  }

  // Tost Work's tools, called by the agent through the MCP server.

  async ask(taskId: string, question: { text: string; options: string[] }): Promise<string> {
    const reply = await this.wait(taskId, (id) => ({ type: "question", question: { id, ...question } }));
    if (typeof reply !== "string") throw new Error("The task was stopped before the user answered");
    return reply;
  }

  approve(taskId: string, action: "overwrite" | "delete", paths: string[]): Promise<boolean> {
    return this.askApproval(taskId, action, paths);
  }

  async reportFile(taskId: string, change: { path: string; kind: "add" | "update" | "delete" }): Promise<void> {
    const live = this.live.get(taskId);
    if (!live) throw new Error("That task isn't running");
    live.channel.push({ type: "file", change: { ...change, role: "made" } });
  }

  async review(taskId: string, review: Review): Promise<void> {
    const live = this.live.get(taskId);
    if (!live) throw new Error("That task isn't running");
    live.channel.push({ type: "review", review });
  }

  /**
   * What Codex may do without the user: new files, changes to files this task made, and commands other than
   * deletions. Changing a file that was already there, or deleting one, goes through the approval card, and Tost Work
   * keeps the copy or moves the file to the Trash before Codex hears back.
   */
  private async policy(taskId: string, request: ApprovalRequest): Promise<ApprovalDecision> {
    const live = this.live.get(taskId);
    if (!live) return { decision: "deny", message: "This task isn't running any more." };
    if (request.tool.startsWith("mcp:")) return "allow";
    if (request.tool === "command") {
      const command = String((request.input as { command?: unknown } | undefined)?.command ?? "");
      if (DELETES.test(command))
        return {
          decision: "deny",
          message:
            "Don't delete files with commands. Call request_approval with action delete, and Tost Work moves them to the Trash.",
        };
      return "allow";
    }
    if (request.tool !== "file_change") return "allow";

    const changes = changesOf(request.input);
    const deletes = changes.filter((c) => c.kind === "delete").map((c) => c.path);
    const overwrites = changes
      .filter((c) => c.kind !== "delete" && c.kind !== "add" && !live.made.has(c.path))
      .map((c) => c.path);
    if (deletes.length) {
      const allowed = await this.askApproval(taskId, "delete", deletes);
      return {
        decision: "deny",
        message: allowed
          ? "The user allowed it, and Tost Work moved the files to the Trash. Don't delete them again."
          : "The user wants to keep these files. Leave them as they are.",
      };
    }
    if (overwrites.length && !(await this.askApproval(taskId, "overwrite", overwrites)))
      return {
        decision: "deny",
        message: "The user wants to keep the file as it is. Save your version under a new name.",
      };
    return "allow";
  }

  private async askApproval(taskId: string, action: "overwrite" | "delete", paths: string[]): Promise<boolean> {
    const reply = await this.wait(taskId, (id) => ({ type: "approval", approval: { id, action, paths } }));
    return reply === true;
  }

  private async questions(taskId: string, request: QuestionRequest): Promise<QuestionAnswers | null> {
    const answers: QuestionAnswers = {};
    for (const q of request.questions) {
      // A secret, such as a password, is never shown or stored in a task.
      if (q.secret) return null;
      const reply = await this.wait(taskId, (id) => ({
        type: "question",
        question: { id, text: q.question, options: q.options.map((o) => o.label) },
      }));
      if (typeof reply !== "string") return null;
      answers[q.id] = [reply];
    }
    return answers;
  }

  /** Shows a question or approval on the task and waits for the user, or for the task to stop. */
  private wait(taskId: string, event: (id: string) => EngineEvent): Promise<string | boolean | null> {
    const live = this.live.get(taskId);
    if (!live) return Promise.resolve(null);
    const id = randomUUID();
    return new Promise((resolve) => {
      const done = (reply: string | boolean | null) => {
        this.waiting.delete(id);
        live.signal.removeEventListener("abort", stop);
        resolve(reply);
      };
      const stop = () => done(null);
      this.waiting.set(id, done);
      live.signal.addEventListener("abort", stop, { once: true });
      live.channel.push(event(id));
    });
  }
}
