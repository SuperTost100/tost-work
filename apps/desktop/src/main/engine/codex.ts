import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import type { ApprovalDecision, ApprovalRequest, Funnel } from "cli-funnel";
import type { EngineEvent, Review } from "../../shared/model";
import { freeName, inside } from "../files";
import type { ToolHandler } from "../mcp/server";
import type { Engine, RunContext } from "./engine";
import { instructionsFor } from "./instructions";

/**
 * What ask_user and request_approval tell the agent. They return at once: Codex hands a tool that runs longer than
 * about 30 seconds back to the model, which then guesses or gives up. So the agent ends its turn, and the user's
 * answer or decision starts the next one.
 */
const END_TURN =
  "It's in front of the user now. End your turn here: don't do anything else and don't repeat it. Their reply arrives as your next message.";

/**
 * Shell words that delete. Any standalone one counts, whatever comes before it (sudo, env, options, then, xargs), so
 * the check runs only on what the shell runs: shellText takes out the text a command writes.
 */
const SHELL_DELETES = /(^|[\s;&|(`{!])(rm|rmdir|del|erase|rd|unlink|shred|trash)(\s|$)|(^|\s)find\s[^\n]*\s-delete\b/im;
/** Deletions in code a command runs, such as a Python, Node or PowerShell script. Looked for in the whole command. */
const CODE_DELETES =
  /os\.(remove|unlink|rmdir)\(|shutil\.rmtree\(|\.(unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync)\(|Remove-Item/i;
/** A shell where a command starts, by name or path: bash and /bin/sh, but not a file named cleanup.sh. */
const SHELL = String.raw`(^|[\s;&|(])(\S*\/)?((ba|z|da|k)?sh|fish)`;
/** A shell's flag for running the string that follows: that string is a command, not text. */
const PAYLOAD = new RegExp(
  String.raw`${SHELL}\s+(-\w+\s+)*-c\s*$|\bcmd(\.exe)?\s+\/[ck]\s*$|\b(powershell|pwsh)(\.exe)?\s+(-\w+\s+)*-c(ommand)?\s*$`,
  "i",
);
/** A line that hands a heredoc to a shell, whose body is then commands. */
const SHELL_READS = new RegExp(String.raw`${SHELL}(\s|<|$)`);
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g;
const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g;
const SUBSTITUTION = /\$\(([^()]*)\)|`([^`]*)`/g;

/** The text before `offset` on its line. */
const lineBefore = (text: string, offset: number) => text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);

/** The $(…) and `…` in a piece of text, which the shell runs even inside double quotes or an unquoted heredoc. */
const substitutions = (text: string) =>
  [...text.matchAll(SUBSTITUTION)].map((m) => `; ${shellText(m[1] ?? m[2] ?? "")} ;`).join(" ");

/**
 * A command with the text it only writes taken out: heredoc bodies and quoted strings. What still runs stays: a
 * quoted command given to a shell with -c, a heredoc a shell reads, and $(…) or `…` inside double quotes or an
 * unquoted heredoc.
 */
function shellText(command: string): string {
  return command
    .replace(HEREDOC, (body: string, quote: string, _tag: string, offset: number) => {
      if (SHELL_READS.test(lineBefore(command, offset))) return body;
      return quote ? "" : substitutions(body);
    })
    .replace(QUOTED, (quoted: string, offset: number, whole: string) => {
      const inner = quoted.slice(1, -1);
      if (PAYLOAD.test(lineBefore(whole, offset))) return `; ${shellText(inner)} ;`;
      if (quoted.startsWith("'")) return "''";
      return substitutions(inner) || '""';
    });
}

/**
 * Whether a command deletes files. Those are refused, so deletions go through the approval card and the Trash.
 * Shell words are looked for only in what runs, so an Italian document saying "del corso" is not a `del` command.
 * shortcut: a script that deletes in another way still deletes; snapshot the folder before each run to close the gap.
 */
export function deletesFiles(command: string): boolean {
  return CODE_DELETES.test(command) || SHELL_DELETES.test(shellText(command));
}

/** OfficeCLI and the document skills, which the agent uses for Word, Excel, PowerPoint and PDF files. */
export interface DocumentTools {
  /** The folder with the skills, one folder per kind of file, each with a SKILL.md. */
  skills: string;
  /** What the agent's commands need: OfficeCLI on the PATH, and its update check and background process off. */
  env: Record<string, string>;
  makePdf(source: string, target: string): Promise<void>;
}

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
  /** Approvals Codex itself is holding a file change for, by id. */
  pending: Set<string>;
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
  private waiting = new Map<string, (reply: boolean | null) => void>();
  /** Every approval put on a task, by id, so a decision that comes after the run knows its files. */
  private approvals = new Map<string, { taskId: string; action: "overwrite" | "delete"; paths: string[] }>();
  /** Files the user allowed replacing after the run that asked had ended. The next run may change them. */
  private cleared = new Map<string, Set<string>>();
  private tools: ToolSessions | null = null;

  constructor(
    private funnel: CodexFunnel,
    private language: () => "en" | "it",
    private documents: DocumentTools | null = null,
    /** The user's name, which new Office files carry as their author. */
    private author: () => string = () => "",
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
    // Files the task created. A file with a kept copy existed before the task (it was overwritten with approval, or
    // restored since), so changing it again always asks.
    const kept = new Set((task.kept ?? []).map((k) => k.path));
    const made = new Set(
      task.files.filter((f) => f.role === "made" && f.kind !== "delete" && !kept.has(f.path)).map((f) => f.path),
    );
    for (const path of this.cleared.get(task.id) ?? []) made.add(path);
    this.cleared.delete(task.id);
    const live: Live = { channel, signal, workdir, made, pending: new Set() };
    this.live.set(task.id, live);
    const session = this.tools.open(task.id);
    const tools = this.tools;

    const stream = this.funnel.stream({
      selection: { provider: "codex", model: task.model, effort: task.effort, cwd: workdir, access: "supervised" },
      prompt: followUp ?? task.brief,
      system: instructionsFor(
        task,
        project,
        this.language(),
        this.documents && { skills: this.documents.skills, author: this.author() },
      ),
      ...(this.documents ? { env: this.documents.env } : {}),
      sessionId: task.sessionId,
      signal,
      planTool: true,
      mcpServers: {
        tost_work: {
          type: "http",
          url: session.url,
          headers: { Authorization: `Bearer ${session.token}` },
          autoApprove: true,
        },
      },
      onApproval: (request) => this.policy(task.id, request),
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
        // A file change Codex still holds ends with the turn. Its card stays, and the decision starts the next run.
        for (const id of [...live.pending]) this.waiting.get(id)?.(null);
        // Stop takes the cards off the task, so no decision will come for them.
        if (signal.aborted)
          for (const [id, asked] of this.approvals) if (asked.taskId === task.id) this.approvals.delete(id);
        tools.close(session.token);
        this.live.delete(task.id);
        channel.close();
      }
    })();

    yield* channel;
    await pump;
  }

  /** Questions never hold a run: the agent ended its turn, so the runner sends the answer as the next message. */
  answer(_taskId: string, _questionId: string, _answer: string): boolean {
    return false;
  }

  decide(taskId: string, approvalId: string, allow: boolean): boolean {
    const asked = this.approvals.get(approvalId);
    this.approvals.delete(approvalId);
    const waiter = this.waiting.get(approvalId);
    if (waiter) {
      waiter(allow);
      return true;
    }
    // The run that asked is over, and the next one makes the change: it may, without asking a second time.
    if (allow && asked?.action === "overwrite") {
      const cleared = this.cleared.get(taskId) ?? new Set<string>();
      for (const path of asked.paths) cleared.add(path);
      this.cleared.set(taskId, cleared);
    }
    return false;
  }

  // Tost Work's tools, called by the agent through the MCP server.

  async ask(taskId: string, question: { text: string; options: string[] }): Promise<string> {
    this.mustLive(taskId).channel.push({ type: "question", question: { id: randomUUID(), ...question } });
    return END_TURN;
  }

  async approve(taskId: string, action: "overwrite" | "delete", paths: string[]): Promise<string> {
    const live = this.mustLive(taskId);
    const id = randomUUID();
    this.approvals.set(id, { taskId, action, paths });
    live.channel.push({ type: "approval", approval: { id, action, paths } });
    return END_TURN;
  }

  async reportFile(taskId: string, change: { path: string; kind: "add" | "update" | "delete" }): Promise<void> {
    this.mustLive(taskId).channel.push({ type: "file", change: { ...change, role: "made" } });
  }

  /** Makes a PDF next to an Office file in the task's folder, under a free name, and adds it to the task. */
  async makePdf(taskId: string, path: string): Promise<string> {
    const live = this.mustLive(taskId);
    if (!this.documents) throw new Error("This build of Tost Work can't make PDFs");
    const source = await realpath(path);
    if (!inside(await realpath(live.workdir), source)) throw new Error("That file is outside the task's folder");
    const target = await freeName(dirname(source), `${basename(source, extname(source))}.pdf`);
    await this.documents.makePdf(source, target);
    live.made.add(target);
    live.channel.push({ type: "file", change: { path: target, kind: "add", role: "made" } });
    return `Made ${target}. Tell the user where it is.`;
  }

  async review(taskId: string, review: Review): Promise<void> {
    this.mustLive(taskId).channel.push({ type: "review", review });
  }

  /** The task's run, unless it ended or was stopped: after Stop nothing new goes on the task. */
  private mustLive(taskId: string): Live {
    const live = this.live.get(taskId);
    if (!live || live.signal.aborted) throw new Error("That task isn't running");
    return live;
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
      if (deletesFiles(command))
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

  /** Shows an approval for a file change Codex is holding, and waits for the user or for the run to end. */
  private askApproval(taskId: string, action: "overwrite" | "delete", paths: string[]): Promise<boolean> {
    const live = this.live.get(taskId);
    // After Stop nothing new goes on the task: an abort that already happened never fires its listener.
    if (!live || live.signal.aborted) return Promise.resolve(false);
    const id = randomUUID();
    this.approvals.set(id, { taskId, action, paths });
    return new Promise((resolve) => {
      const done = (reply: boolean | null) => {
        this.waiting.delete(id);
        live.pending.delete(id);
        live.signal.removeEventListener("abort", stop);
        resolve(reply === true);
      };
      const stop = () => done(null);
      this.waiting.set(id, done);
      live.pending.add(id);
      live.signal.addEventListener("abort", stop, { once: true });
      live.channel.push({ type: "approval", approval: { id, action, paths } });
    });
  }
}
