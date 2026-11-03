import { existsSync } from "node:fs";
import { appendFile, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { redact } from "cli-funnel";
import { cutOutput, type LogLine } from "../shared/debug";
import type { Settings } from "../shared/model";

const MASK = "[redacted]";
/** The names of fields whose value is a credential, whatever it looks like. */
const SECRET_NAMES =
  "api[-_]?key|x-api-key|authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client[-_]?secret|token|(?:access|refresh|id|auth|session|bearer)[-_]?token|course[-_]?key";
const SECRET_FIELD = new RegExp(`^(?:${SECRET_NAMES})$`, "i");
/** The same field written as JSON inside a line of text, such as a CLI's stderr: `"password":"…"`. */
const SECRET_JSON_FIELD = new RegExp(`("(?:${SECRET_NAMES})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "gi");
/** Fields holding a set of named values, such as a process's environment, where any value may be a credential. */
const NAMED_VALUES = /^(env|headers)$/i;
/** An environment variable named like a credential, as `env` or a script prints it: OPENAI_API_KEY=… */
const ENV_SECRET =
  /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g;
/** A credential header written out as text, with or without its scheme. */
const AUTH_HEADER =
  /\b(authorization|proxy-authorization|x-api-key)(["']?\s*[:=]\s*["']?)(?:(?:bearer|basic|token)\s+)?[^\s"',;}]+/gi;

/**
 * Text with credentials masked: the secrets given, and what cli-funnel's redact finds (keys shaped like sk-…,
 * Bearer values, credentials and query strings in URLs), plus credential-named variables and headers.
 */
export function redactText(text: string, secrets: (string | undefined)[] = []): string {
  return (
    redact(text, secrets)
      // JSON fields first: the patterns for environment values and headers stop at a space or an escaped quote, and
      // run first they would mask a field's start and leave its end.
      .replace(SECRET_JSON_FIELD, `$1"${MASK}"`)
      .replace(ENV_SECRET, `$1=${MASK}`)
      .replace(AUTH_HEADER, `$1$2${MASK}`)
  );
}

/** A value with every credential masked, in its strings and in fields named like one. */
export function redactValue(value: unknown, secrets: (string | undefined)[] = []): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (value instanceof Error)
    return redactValue({ name: value.name, message: value.message, stack: value.stack }, secrets);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) out[key] = MASK;
    else if (NAMED_VALUES.test(key) && typeof v === "object" && v !== null)
      out[key] = Object.fromEntries(Object.keys(v).map((name) => [name, MASK]));
    else out[key] = redactValue(v, secrets);
  }
  return out;
}

/** Settings the user types in. A change to one is logged, but what it says is not: it's about the user, not the app. */
const FREE_TEXT: (keyof Settings)[] = ["name", "work", "notes"];

/**
 * The settings that differ between two versions, each with its new value. Free text such as the user's name is marked
 * as changed without its value.
 */
export function settingChanges(before: Settings, after: Settings): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof Settings)[]) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    changes[key] = FREE_TEXT.includes(key) ? "(text changed)" : after[key];
  }
  return changes;
}

/** One file of the export: its name in the zip and its content. */
export interface LogFile {
  name: string;
  data: Buffer;
}

/** The app log and the ones it rotated to: app.log, app.1.log. */
const APP_LOG = /^app(\.\d+)?\.log$/;
/** A task's events, and next to them what its CLI printed: t1.jsonl, t1.raw.jsonl. */
const TASK_LOG = /^[\w-]{1,100}(\.raw)?\.jsonl$/;

/** Task ids are UUIDs: anything else could reach outside the logs folder. */
const SAFE_ID = /^[\w-]{1,100}$/;
/** A cap line is short, so the end of a capped file holds it whole. */
const TAIL = 300;

export interface TaskLog {
  /** Adds a line with the time, masked, while debug is on. Never throws: a log that can't be written leaves the run alone. */
  write<L extends { type: string }>(line: L): void;
}

export interface LogLimits {
  /** Past this, a task's log gets one line saying so and nothing more. */
  task: number;
  /** Past this, app.log moves to app.1.log and starts again. */
  app: number;
}

const LIMITS: LogLimits = { task: 20 * 1024 * 1024, app: 5 * 1024 * 1024 };
/** The most log data one export reads: the app logs and about the ten newest task logs at their largest. */
const EXPORT_BUDGET = 200 * 1024 * 1024;

/**
 * The debug logs: one JSONL file per task in `<dir>/tasks`, and the app's own log, `<dir>/app.log`. They're written
 * only while `on()` says debug is on, they stay on this computer, and every line is masked first.
 */
export class DebugLogs {
  readonly appFile: string;
  private queue: Promise<void> = Promise.resolve();
  /** Each file's size, read once from disk, then counted. */
  private sizes = new Map<string, number>();
  private capped = new Set<string>();
  private reported = false;

  constructor(
    private dir: string,
    private on: () => boolean,
    /** Secrets to mask in every line, such as the course key, read each time so a new key is covered. */
    private secrets: () => (string | undefined)[] = () => [],
    private now: () => string = () => new Date().toISOString(),
    private limits: LogLimits = LIMITS,
  ) {
    this.appFile = join(dir, "app.log");
  }

  taskFile(taskId: string): string {
    if (!SAFE_ID.test(taskId)) throw new Error("That isn't a task id");
    return join(this.dir, "tasks", `${taskId}.jsonl`);
  }

  /**
   * What the task's CLI printed, line by line, which cli-funnel sends as `raw` events in verbose mode. It has a file and
   * a cap of its own, so a chatty CLI can't stop the events, which the task screen reads, at their cap.
   */
  rawFile(taskId: string): string {
    if (!SAFE_ID.test(taskId)) throw new Error("That isn't a task id");
    return join(this.dir, "tasks", `${taskId}.raw.jsonl`);
  }

  /** A writer for one run of a task. `secrets` are the run's own, such as its tool server token. */
  forTask(taskId: string, secrets: (string | undefined)[] = []): TaskLog {
    // Read once per run rather than per line: reading the course key decrypts it.
    let all: (string | undefined)[] | null = null;
    return {
      write: (line) => {
        if (!this.on()) return;
        const at = this.now();
        this.enqueue(async () => {
          const file = line.type === "raw" ? this.rawFile(taskId) : this.taskFile(taskId);
          all ??= [...secrets, ...this.secrets()];
          const masked = redactValue({ ...line, at }, all);
          await this.appendCapped(file, `${JSON.stringify(masked)}\n`, at);
        });
      },
    };
  }

  /** A line in app.log, with what went wrong or what happened in `detail`. */
  app(level: "info" | "warn" | "error", message: string, detail?: unknown): void {
    if (!this.on()) return;
    const at = this.now();
    this.enqueue(async () => {
      const secrets = this.secrets();
      const extra = detail === undefined ? "" : ` ${JSON.stringify(redactValue(detail, secrets))}`;
      const line = `${at} [${level}] ${redactText(message, secrets)}${extra}\n`;
      await mkdir(this.dir, { recursive: true });
      const size = await this.sizeOf(this.appFile);
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > this.limits.app) {
        await rename(this.appFile, join(this.dir, "app.1.log"));
        this.sizes.set(this.appFile, 0);
      }
      await appendFile(this.appFile, line, { mode: 0o600 });
      this.sizes.set(this.appFile, (this.sizes.get(this.appFile) ?? 0) + bytes);
    });
  }

  /**
   * A line for each setting that changed, and one for a new model pick. Nothing while debug is off. The caller says
   * where it came from, since settings change from the Settings screen, the model picker and the View menu.
   */
  settingsChanged(before: Settings, after: Settings): void {
    const { modelPick, ...changes } = settingChanges(before, after);
    if (modelPick !== undefined) this.app("info", "Model pick changed", modelPick);
    if (Object.keys(changes).length > 0) this.app("info", "Settings changed", changes);
  }

  /**
   * The log files for the export, as they are on disk: the app logs, then the task logs newest first, up to `budget`
   * bytes in all, since each is read into memory and zipped there. `leftOut` counts the older task logs past it.
   */
  async snapshot(budget = EXPORT_BUDGET): Promise<{ files: LogFile[]; leftOut: number }> {
    await this.flush();
    const list = async (dir: string, pattern: RegExp, prefix: string) => {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const found: { name: string; path: string; size: number; at: number }[] = [];
      for (const name of names.filter((n) => pattern.test(n)).sort()) {
        try {
          const info = await stat(join(dir, name));
          found.push({ name: `${prefix}${name}`, path: join(dir, name), size: info.size, at: info.mtimeMs });
        } catch (err) {
          // A task deleted since the listing has no log to export.
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
      return found;
    };
    const apps = await list(this.dir, APP_LOG, "");
    const tasks = (await list(join(this.dir, "tasks"), TASK_LOG, "tasks/")).sort((a, b) => b.at - a.at);
    const files: LogFile[] = [];
    let total = 0;
    let leftOut = 0;
    for (const file of [...apps, ...tasks]) {
      if (total + file.size > budget) {
        leftOut++;
        continue;
      }
      try {
        const data = await readFile(file.path);
        total += data.length;
        files.push({ name: file.name, data });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    return { files, leftOut };
  }

  /** Makes sure app.log exists, so it can be shown in its folder. */
  async touchApp(): Promise<string> {
    await this.flush();
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.appFile, "", { mode: 0o600 });
    return this.appFile;
  }

  hasTask(taskId: string): boolean {
    return SAFE_ID.test(taskId) && existsSync(this.taskFile(taskId));
  }

  /** The task's log as written, or null when it has none. */
  async taskText(taskId: string): Promise<string | null> {
    await this.flush();
    try {
      return await readFile(this.taskFile(taskId), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * The task's log, a line per event, for the task screen. Long tool output is cut, with its length, since the
   * screen shows only the start of it. A line that isn't JSON, such as the end of one cut by a crash, is left out.
   */
  async readTask(taskId: string): Promise<LogLine[] | null> {
    const text = await this.taskText(taskId);
    if (text === null) return null;
    return text.split("\n").flatMap((raw): LogLine[] => {
      if (!raw.trim()) return [];
      let line: LogLine;
      try {
        line = JSON.parse(raw) as LogLine;
      } catch {
        return [];
      }
      if (line.type !== "tool.end") return [line];
      const out = line as { output?: unknown; error?: unknown };
      const cutField = (v: unknown) => (typeof v === "string" ? cutOutput(v) : null);
      const output = cutField(out.output);
      const error = cutField(out.error);
      const cut = output?.cut ?? error?.cut;
      return [
        {
          ...line,
          ...(output ? { output: output.text } : {}),
          ...(error ? { error: error.text } : {}),
          ...(cut ? { cut } : {}),
        },
      ];
    });
  }

  /** Deletes the task's logs, with the task. */
  async removeTask(taskId: string): Promise<void> {
    await this.flush();
    for (const file of [this.taskFile(taskId), this.rawFile(taskId)]) {
      this.sizes.delete(file);
      this.capped.delete(file);
      await rm(file, { force: true });
    }
  }

  /** Resolves once every line asked for so far is written. */
  flush(): Promise<void> {
    return this.queue;
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch((err: unknown) => {
      // Once is enough: a disk that is full or read-only would fail every line.
      if (this.reported) return;
      this.reported = true;
      console.error("Couldn't write the debug log", err);
    });
  }

  private async sizeOf(file: string): Promise<number> {
    const known = this.sizes.get(file);
    if (known !== undefined) return known;
    const size = await stat(file).then(
      (s) => s.size,
      (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return 0;
        throw err;
      },
    );
    this.sizes.set(file, size);
    return size;
  }

  /** Whether a file from an earlier start of the app already ends with the cap line. */
  private async endsCapped(file: string, size: number): Promise<boolean> {
    if (size === 0) return false;
    const handle = await open(file, "r");
    try {
      const length = Math.min(TAIL, size);
      const { buffer } = await handle.read(Buffer.alloc(length), 0, length, size - length);
      return buffer.toString("utf8").includes('"type":"log.capped"');
    } finally {
      await handle.close();
    }
  }

  private async appendCapped(file: string, line: string, at: string): Promise<void> {
    if (this.capped.has(file)) return;
    const fresh = !this.sizes.has(file);
    const size = await this.sizeOf(file);
    if (fresh && (await this.endsCapped(file, size))) {
      this.capped.add(file);
      return;
    }
    const bytes = Buffer.byteLength(line);
    await mkdir(dirname(file), { recursive: true });
    if (size + bytes > this.limits.task) {
      this.capped.add(file);
      await appendFile(file, `${JSON.stringify({ type: "log.capped", at, bytes: size })}\n`, { mode: 0o600 });
      return;
    }
    await appendFile(file, line, { mode: 0o600 });
    this.sizes.set(file, size + bytes);
  }
}
