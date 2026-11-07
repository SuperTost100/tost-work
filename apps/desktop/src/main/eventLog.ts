import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Task } from "../shared/model";

/** Lines older than this go when the app starts. */
const KEEP_DAYS = 7;
/** Past this the oldest lines go, so the file stays small whatever the app does. */
const MAX_BYTES = 512 * 1024;

/** A file's type from its name, without the name: "docx", or "file" when it has none. */
const typeOf = (path: string) => /\.([A-Za-z0-9]{1,8})$/.exec(path)?.[1]?.toLowerCase() ?? "file";

/** The text of one event: the time, what happened, and plain fields, never the user's words. */
type Fields = Record<string, string | number | boolean | undefined>;
const line = (at: Date, event: string, fields: Fields) =>
  [
    at.toISOString().slice(0, 19).replace("T", " "),
    event,
    ...Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, "_")}`),
  ].join(" ");

/**
 * The events log of a test build: what happened and when, so a problem report can say what led to it. It keeps no
 * task text, no file or folder names and no account details: a task is its short id, its state, the AI and model it ran
 * on, and how many files of each type it made. It's written only in dev, alpha and beta builds, and keeps 7 days.
 */
export class EventLog {
  /** Each task's last state written, so a task's line is written when its state changes, not on every update. */
  private states = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private file: string,
    private on: boolean,
    private now: () => Date = () => new Date(),
  ) {}

  /** Drops the lines older than a week, and the oldest past the size limit. */
  async prune(): Promise<void> {
    if (!this.on) return;
    await this.enqueue(async () => {
      const text = await readFile(this.file, "utf8").catch(() => "");
      if (!text) return;
      const since = new Date(this.now().getTime() - KEEP_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      let kept = text.split("\n").filter((l) => l && l.slice(0, 19) >= since);
      while (kept.length && Buffer.byteLength(kept.join("\n")) > MAX_BYTES)
        kept = kept.slice(Math.ceil(kept.length / 10));
      await writeFile(this.file, kept.length ? `${kept.join("\n")}\n` : "", { mode: 0o600 });
    });
  }

  /** Something the app did, with plain fields: a version, a platform, an error's name. */
  app(event: string, fields: Fields = {}): void {
    this.write(event, fields);
  }

  /** An error's kind, never its message, which can quote a file or what the user wrote. */
  error(where: string, err: unknown): void {
    const e = err as { name?: unknown; code?: unknown } | null;
    this.write("error", {
      where,
      name: typeof e?.name === "string" ? e.name : typeof err,
      code: typeof e?.code === "string" || typeof e?.code === "number" ? e.code : undefined,
    });
  }

  /** A task that changed state. */
  task(task: Task): void {
    if (this.states.get(task.id) === task.status) return;
    this.states.set(task.id, task.status);
    const made: Record<string, number> = {};
    for (const f of task.files)
      if (f.role === "made" && f.kind !== "delete") made[typeOf(f.path)] = (made[typeOf(f.path)] ?? 0) + 1;
    this.write("task", {
      id: task.id.slice(0, 8),
      status: task.status,
      ai: task.provider,
      model: task.model,
      effort: task.effort,
      job: task.jobId ? true : undefined,
      project: task.projectId ? true : undefined,
      asks: task.question ? true : task.approval ? task.approval.action : undefined,
      made: Object.entries(made)
        .map(([type, n]) => `${type}:${n}`)
        .join(","),
      error: task.error ? true : undefined,
    });
  }

  /** The newest lines that fit in `max` characters, oldest first, for a problem report. */
  async tail(max: number): Promise<string> {
    await this.queue;
    const lines = (await readFile(this.file, "utf8").catch(() => "")).split("\n").filter(Boolean);
    const out: string[] = [];
    let size = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i] as string;
      if (size + l.length + 1 > max) break;
      out.unshift(l);
      size += l.length + 1;
    }
    return out.join("\n");
  }

  private write(event: string, fields: Fields): void {
    if (!this.on) return;
    const text = `${line(this.now(), event, fields)}\n`;
    this.enqueue(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await appendFile(this.file, text, { mode: 0o600 });
    });
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    // A log that can't be written leaves the app alone.
    this.queue = this.queue.then(work).catch((err: unknown) => console.error("Couldn't write the events log", err));
    return this.queue;
  }
}
