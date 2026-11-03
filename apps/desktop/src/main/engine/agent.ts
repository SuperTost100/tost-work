import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { ApprovalDecision, ApprovalRequest, Funnel } from "cli-funnel";
import { translate } from "../../shared/i18n";
import type { AgentProvider, AiId, EngineEvent, Job, KeyVendor, Review, Skill } from "../../shared/model";
import { KEY_PROVIDER, PROVIDER_OF } from "../../shared/model";
import {
  type AiModels,
  DEFAULT_PICK,
  type ModelChoices,
  type ModelOption,
  type ModelPick,
  pickOn,
} from "../../shared/modelChoice";
import type { TaskLog } from "../debugLog";
import { freeName, inside } from "../files";
import type { ToolHandler } from "../mcp/server";
import { UserError } from "../userError";
import { activityOf, noteText } from "./activity";
import type { Engine, RunContext } from "./engine";
import { instructionsFor } from "./instructions";

/**
 * What ask_user and request_approval tell the agent. They return at once: Codex hands a tool that runs longer than
 * about 30 seconds back to the model, which then guesses or gives up. So the agent ends its turn, and the user's
 * answer or decision starts the next one.
 */
/** What Codex and Claude Code pass on from their subagents: the text for the activity, the calls for the debug view. */
const SUBAGENTS = { forwardSubagentText: true, forwardSubagentTools: true };

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

/** The parts of cli-funnel the engine uses, so tests can stand in for Codex and Claude Code. */
export type AgentFunnel = Pick<Funnel, "stream" | "models">;

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

/** Claude Code's tools that write one file, and the input field with its path. */
const CLAUDE_WRITES: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

/** A path with its links resolved, for a file that may not exist yet: the nearest existing folder is resolved. */
async function realTarget(path: string): Promise<string> {
  const rest: string[] = [];
  let dir = path;
  while (true) {
    try {
      return join(await realpath(dir), ...rest);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return path;
      rest.unshift(basename(dir));
      dir = parent;
    }
  }
}

/**
 * A Claude Code approval request in the shape Codex sends, so one policy covers both: Bash becomes a command, and a
 * tool that writes a file becomes a file change, an add when the file isn't there yet. Null for a write outside the
 * folder, which Codex's sandbox would have stopped. Links are resolved first, because on a Mac a temporary folder
 * under /var is really under /private/var.
 */
export async function asCodexRequest(request: ApprovalRequest, workdir: string): Promise<ApprovalRequest | null> {
  const input = (request.input ?? {}) as Record<string, unknown>;
  if (request.tool === "Bash") return { ...request, tool: "command", input: { command: input.command } };
  const field = CLAUDE_WRITES[request.tool];
  const target = field ? input[field] : undefined;
  if (typeof target !== "string") return request;
  const path = resolve(workdir, target);
  if (!inside(await realTarget(workdir), await realTarget(path))) return null;
  const exists = await stat(path).then(
    () => true,
    () => false,
  );
  return { ...request, tool: "file_change", input: { changes: [{ path, kind: exists ? "update" : "add" }] } };
}

/**
 * Whether a CLI's error means it couldn't reach its service. Codex says "workspace routing discovery failed" or
 * "stream disconnected", Claude Code names the socket error.
 */
export function isNetworkError(message: string): boolean {
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|ENETUNREACH|EHOSTUNREACH|getaddrinfo|fetch failed|connection refused|network (error|is unreachable)|routing discovery failed|stream disconnected|error sending request/i.test(
    message,
  );
}

/**
 * Runs tasks through cli-funnel on Codex (the ChatGPT sign-in) or Claude Code (the Claude sign-in), at `supervised`:
 * every file change comes here first, and Tost Work's tools carry questions, approvals, files and the review. Shell
 * commands run in each CLI's own sandbox, so they can write only inside the task's folder and temp folders.
 */
export class AgentEngine implements Engine, ToolHandler {
  private live = new Map<string, Live>();
  private waiting = new Map<string, (reply: boolean | null) => void>();
  /** Every approval put on a task, by id, so a decision that comes after the run knows its files. */
  private approvals = new Map<string, { taskId: string; action: "overwrite" | "delete"; paths: string[] }>();
  /** Files the user allowed replacing after the run that asked had ended. The next run may change them. */
  private cleared = new Map<string, Set<string>>();
  private tools: ToolSessions | null = null;

  private documents: DocumentTools | null;
  private user: () => { name: string; work: string; notes: string };
  private ai: () => Promise<AiId>;
  private courseKey: () => { key: string; vendor: KeyVendor } | null;
  private online: () => boolean;
  private usable: () => Promise<AiId[]>;
  private skills: () => Promise<Skill[]>;
  private job: (id: string) => Pick<Job, "title" | "output"> | undefined;
  private taskLog: (taskId: string, secrets: (string | undefined)[]) => TaskLog;
  private verbose: () => boolean;

  constructor(
    private funnel: AgentFunnel,
    private language: () => "en" | "it",
    options: {
      documents?: DocumentTools | null;
      /** The user's profile: their name, which new Office files carry as author, what they do, and notes. */
      user?: () => { name: string; work: string; notes: string };
      /** The account new tasks run on. */
      ai?: () => Promise<AiId>;
      /** The course API key, read for each run so a removed key stops being used. */
      courseKey?: () => { key: string; vendor: KeyVendor } | null;
      /** Whether the computer has a network connection, so a task without one fails at once with a clear reason. */
      online?: () => boolean;
      /** The AIs a task could run on right now: the ones signed in, and the course key when there is one. */
      usable?: () => Promise<AiId[]>;
      /** The user's skills, read for each run so a skill saved a moment ago is there. */
      skills?: () => Promise<Skill[]>;
      /** The job a task is a run of, so the agent knows nobody is watching and where the files go. */
      job?: (id: string) => Pick<Job, "title" | "output"> | undefined;
      /** Whether debug is on, so a run also sends what its CLI prints, for the log. */
      verbose?: () => boolean;
      /** The task's debug log, which writes only while debug is on. `secrets` are masked in every line. */
      taskLog?: (taskId: string, secrets: (string | undefined)[]) => TaskLog;
    } = {},
  ) {
    this.documents = options.documents ?? null;
    this.user = options.user ?? (() => ({ name: "", work: "", notes: "" }));
    this.ai = options.ai ?? (async () => "chatgpt");
    this.courseKey = options.courseKey ?? (() => null);
    this.online = options.online ?? (() => true);
    this.usable = options.usable ?? (async () => []);
    this.skills = options.skills ?? (async () => []);
    this.job = options.job ?? (() => undefined);
    this.verbose = options.verbose ?? (() => false);
    this.taskLog = options.taskLog ?? (() => ({ write: () => {} }));
  }

  /** Why the task can't reach its AI, in the user's language. */
  private offline(provider: AgentProvider): string {
    return translate(this.language(), "task.offline", { ai: provider === "claude" ? "Claude" : "ChatGPT" });
  }

  /** The tool server takes this engine as its handler, so it's attached after both exist. */
  attachTools(tools: ToolSessions): void {
    this.tools = tools;
  }

  /** The agent an AI runs through, and whether it runs on the subscription or the course key. */
  private async target(ai: AiId): Promise<{ provider: AgentProvider; auth: "account" | "key" }> {
    if (ai !== "key") return { provider: PROVIDER_OF[ai], auth: "account" };
    const key = this.courseKey();
    if (!key) throw new UserError("error.courseKeyGone");
    return { provider: KEY_PROVIDER[key.vendor], auth: "key" };
  }

  private async modelsOf(provider: AgentProvider): Promise<ModelOption[]> {
    const models = await this.funnel.models(provider);
    return models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      efforts: m.efforts.map((e) => e.id),
      ...(m.defaultEffort ? { defaultEffort: m.defaultEffort } : {}),
    }));
  }

  /** What a new task runs on, from `pickOn`: a choice of the three on the default AI, or a model from the full list. */
  async defaults(
    pick: ModelPick = DEFAULT_PICK,
  ): Promise<{ provider: AgentProvider; auth: "account" | "key"; model: string; effort: string }> {
    const ai = await this.ai();
    const { provider } = await this.target(ai);
    const elsewhere = "ai" in pick && pick.ai !== ai;
    // A model picked on another AI doesn't need the default AI's list, unless it falls back to the middle choice, so
    // a failed read of that list doesn't stop it. Without the list, pickOn finds no fallback and says so.
    const defaultModels = elsewhere ? await this.modelsOf(provider).catch(() => null) : await this.modelsOf(provider);
    const lists: AiModels[] = defaultModels ? [{ ai, provider, models: defaultModels }] : [];
    if (elsewhere && (await this.usable()).includes(pick.ai)) {
      // A model on an AI that has gone (signed out, or a removed course key) is left out, and the middle choice stands
      // in.
      const target = await this.target(pick.ai).catch(() => null);
      // So is one whose list can't be read just now, as in choices().
      const models = target && (await this.modelsOf(target.provider).catch(() => null));
      if (target && models) lists.push({ ai: pick.ai, provider: target.provider, models });
    }
    const picked = pickOn(pick, { ai, provider, lists });
    if (!picked) throw new UserError("error.noModels", { ai: provider === "claude" ? "Claude Code" : "Codex" });
    return {
      provider: picked.provider,
      auth: picked.ai === "key" ? "key" : "account",
      model: picked.model.id,
      effort: picked.effort,
    };
  }

  /** The default AI, and the models of every AI a task could run on, for the picker under the task box. */
  async choices(): Promise<ModelChoices> {
    const ai = await this.ai();
    const { provider } = await this.target(ai);
    const ais = [ai, ...(await this.usable()).filter((x) => x !== ai)];
    const lists: AiModels[] = [];
    for (const id of ais) {
      const target = await this.target(id).catch(() => null);
      if (!target) continue;
      // A list that can't be read leaves that AI out of the full list rather than failing the picker.
      const models = await this.modelsOf(target.provider).catch(() => null);
      if (models) lists.push({ ai: id, provider: target.provider, models });
    }
    return { ai, provider, lists };
  }

  async *run({ task, project, workdir, followUp, signal }: RunContext): AsyncIterable<EngineEvent> {
    if (!this.tools) throw new Error("The tool server isn't attached");
    // Without a connection Codex retries for minutes before it gives up, so the task fails straight away instead.
    if (!this.online()) throw new Error(this.offline(task.provider ?? "codex"));
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

    // A task started on the course key keeps running on it. Removed or replaced with another vendor's, it can't.
    let apiKey: string | undefined;
    if (task.auth === "key") {
      const key = this.courseKey();
      if (!key || KEY_PROVIDER[key.vendor] !== (task.provider ?? "codex")) {
        this.live.delete(task.id);
        this.tools.close(session.token);
        throw new UserError("error.taskKeyGone");
      }
      apiKey = key.key;
    }

    // The log gets every event as cli-funnel sends it, after a line saying what the run was started with. The run's
    // tool server token and the course key are masked wherever they would appear.
    const log = this.taskLog(task.id, [session.token, apiKey]);
    log.write({
      type: "run",
      provider: task.provider ?? "codex",
      model: task.model,
      effort: task.effort,
      access: "supervised",
      cwd: workdir,
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      followUp: followUp !== null,
    });

    // A skills folder that can't be read leaves the task without skills rather than failing it.
    const skills = await this.skills().catch(() => []);
    // Claude Code can leave a command or a subagent running in the background and end its turn, saying it will look
    // later. Nothing would wake it to look, and the task would show as finished, so here it waits for each one.
    const env =
      task.provider === "claude"
        ? { ...this.documents?.env, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" }
        : this.documents?.env;
    const stream = this.funnel.stream({
      selection: {
        provider: task.provider ?? "codex",
        model: task.model,
        effort: task.effort,
        cwd: workdir,
        access: "supervised",
      },
      prompt: followUp ?? task.brief,
      system: instructionsFor(
        task,
        project,
        this.language(),
        this.documents && { skills: this.documents.skills },
        this.user(),
        skills,
        task.jobId ? (this.job(task.jobId) ?? null) : null,
      ),
      ...(env ? { env } : {}),
      ...(apiKey ? { apiKey } : {}),
      // Web search, without asking before each site. Codex searches OpenAI's web index: its live search needs a looser
      // access level than supervised. Claude Code has its own search tool, which the policy allows. Both pass on what
      // their subagents write, for the activity, and the tool calls they make, for the debug view.
      providerOptions:
        (task.provider ?? "codex") === "codex"
          ? { codex: { webSearch: "cached" as const, ...SUBAGENTS } }
          : { claude: SUBAGENTS },
      // While debug is on, every line the CLI prints, for the log. It costs nothing while off.
      verbose: this.verbose(),
      // Claude Code's file tools are held to the folder by the approval policy, but a shell command could write
      // anywhere: its sandbox stops that. Codex at supervised was sandboxed already. A sandbox that can't start fails
      // the run rather than letting it go unconfined.
      sandbox: true,
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
      onApproval: async (request) => {
        if (task.provider !== "claude") return this.policy(task.id, request);
        const translated = await asCodexRequest(request, workdir);
        if (!translated) return { decision: "deny", message: "Work only inside the task's folder." };
        return this.policy(task.id, translated);
      },
    });

    // What the agent wrote since its last tool call. Words followed by a tool call were a note between steps, such as
    // "the table is nearly done", not the answer: they go into the activity, and only the last words are the answer.
    let said = "";
    const pump = (async () => {
      try {
        for await (const event of stream) {
          log.write(event);
          if (event.type === "session") channel.push({ type: "session", sessionId: event.sessionId });
          else if (event.type === "text.delta") {
            said += event.text;
            channel.push({ type: "text", text: event.text });
          } else if (event.type === "plan") channel.push({ type: "plan", steps: event.steps });
          // A subagent's own calls show in the debug view under the line that handed it off, from the log.
          else if (event.type === "tool.start" && !event.parentId) {
            const note = noteText(said);
            said = "";
            if (note) channel.push({ type: "activity", kind: "note", target: note });
            const line = activityOf(event.name, event.input, this.documents?.skills);
            if (line) channel.push({ type: "activity", ...line, id: event.id });
          } else if (event.type === "subagent.text") {
            const note = noteText(event.text);
            if (note) channel.push({ type: "activity", kind: "note", target: note });
          } else if (event.type === "file.change" && event.status === "done") {
            const path = event.movedTo ?? event.path;
            if (event.kind === "delete") made.delete(path);
            else made.add(path);
            channel.push({ type: "file", change: { path, kind: event.kind, role: "made" } });
          }
        }
        const result = await stream.result;
        log.write({ type: "run.end", finishReason: result.finishReason, deniedActions: result.deniedActions });
        if (result.finishReason === "cancelled") channel.push({ type: "stopped" });
        else {
          if (result.text.trim()) channel.push({ type: "message", text: result.text.trim() });
          channel.push({ type: "done" });
        }
      } catch (err) {
        if (signal.aborted) channel.push({ type: "stopped" });
        else {
          const message = err instanceof Error ? err.message : String(err);
          log.write({ type: "run.failed", message });
          channel.push({
            type: "failed",
            // Only an error that is about the network gets the plain explanation; any other keeps the CLI's words,
            // even when the connection dropped meanwhile.
            error: isNetworkError(message) ? this.offline(task.provider ?? "codex") : message,
          });
        }
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

  async ask(taskId: string, questions: { text: string; options: string[] }[]): Promise<string> {
    const [first, ...more] = questions;
    if (!first) throw new Error("Ask at least one question");
    const question = { id: randomUUID(), ...first, ...(more.length ? { more } : {}) };
    this.mustLive(taskId).channel.push({ type: "question", question });
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
    if (!inside(await realpath(live.workdir), source)) throw new UserError("error.fileOutside");
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
    if (!live || live.signal.aborted) throw new UserError("error.notRunning");
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
    // Claude Code's own question tool can't reach the user from here, so questions go through ask_user.
    if (request.tool === "AskUserQuestion")
      return { decision: "deny", message: "Ask the user with the ask_user tool, then end your turn." };
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
