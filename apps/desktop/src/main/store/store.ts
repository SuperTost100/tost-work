import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_SETTINGS,
  type FileChange,
  type Job,
  lastMade,
  type Message,
  type Project,
  type ProjectOverview,
  type Settings,
  type Step,
  type Task,
} from "../../shared/model";
import { matchesWords, SEARCH_LIMIT, searchWords } from "../../shared/search";

/** A task's steps, files and messages, which have tables of their own; the rest of the task is one JSON column. */
type Parts = Pick<Task, "steps" | "files" | "messages">;

/**
 * Projects and tasks, in SQLite through Node's built-in driver, so there is no native module to rebuild for Electron.
 * A task's steps, files and messages each have their own table, in their order, so the board can query them.
 */
export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists projects (id text primary key, data text not null, created_at text not null);
      create table if not exists tasks (
        id text primary key,
        project_id text,
        status text not null,
        data text not null,
        updated_at text not null
      );
      create index if not exists tasks_updated on tasks (updated_at desc);
      create index if not exists tasks_project on tasks (project_id, updated_at desc);
      create table if not exists settings (key text primary key, value text not null);
      create table if not exists jobs (id text primary key, data text not null, created_at text not null);
      create table if not exists task_steps (
        task_id text not null references tasks (id) on delete cascade,
        n integer not null,
        text text not null,
        status text not null,
        primary key (task_id, n)
      );
      create table if not exists task_files (
        task_id text not null references tasks (id) on delete cascade,
        n integer not null,
        path text not null,
        kind text not null,
        role text not null,
        primary key (task_id, n)
      );
      create index if not exists task_files_role on task_files (role, task_id);
      create table if not exists task_messages (
        task_id text not null references tasks (id) on delete cascade,
        n integer not null,
        sender text not null,
        at text not null,
        data text not null,
        primary key (task_id, n)
      );
      pragma foreign_keys = on;
    `);
    this.splitOldTasks(path);
  }

  /**
   * Tasks saved before 0.1 hold their steps, files and messages in their JSON column. The first start moves them to
   * their tables, after copying the database next to it, all in one transaction.
   * shortcut: only Tost and one tester have tasks from before 0.1; remove this in the version after 0.1 (#34).
   */
  private splitOldTasks(path: string): void {
    const { user_version: version } = this.db.prepare("pragma user_version").get() as { user_version: number };
    if (version >= 1) return;
    const old = this.db
      .prepare(
        `select data from tasks where json_type(data, '$.steps') is not null
           or json_type(data, '$.files') is not null or json_type(data, '$.messages') is not null`,
      )
      .all() as { data: string }[];
    // A copy from an earlier try that didn't finish is older still, so it stays.
    const backup = `${path}.before-0.1`;
    if (old.length > 0 && path !== ":memory:" && !existsSync(backup)) this.db.prepare("vacuum into ?").run(backup);
    this.transaction(() => {
      for (const row of old) {
        const task = JSON.parse(row.data) as Task;
        this.writeTask({ ...task, steps: task.steps ?? [], files: task.files ?? [], messages: task.messages ?? [] });
      }
      this.db.exec("pragma user_version = 1");
    });
  }

  private transaction(work: () => void): void {
    this.db.exec("begin");
    try {
      work();
      this.db.exec("commit");
    } catch (err) {
      this.db.exec("rollback");
      throw err;
    }
  }

  /** The tasks of these rows, each with its steps, files and messages: one query per table, however many tasks. */
  private tasksOf(rows: { data: string }[]): Task[] {
    const tasks = rows.map((r) => JSON.parse(r.data) as Task);
    if (tasks.length === 0) return tasks;
    const ids = JSON.stringify(tasks.map((t) => t.id));
    const parts = new Map<string, Parts>(tasks.map((t) => [t.id, { steps: [], files: [], messages: [] }]));
    const read = <Row>(columns: string, table: string) =>
      this.db
        .prepare(
          `select task_id, ${columns} from ${table} where task_id in (select value from json_each(?)) order by n`,
        )
        .all(ids) as (Row & { task_id: string })[];
    for (const { task_id, ...step } of read<Step>("text, status", "task_steps")) parts.get(task_id)?.steps.push(step);
    for (const { task_id, ...file } of read<FileChange>("path, kind, role", "task_files"))
      parts.get(task_id)?.files.push(file);
    for (const { task_id, data } of read<{ data: string }>("data", "task_messages"))
      parts.get(task_id)?.messages.push(JSON.parse(data) as Message);
    return tasks.map((t) => ({ ...t, ...parts.get(t.id) }));
  }

  /** Writes the task and replaces its steps, files and messages. The caller holds the transaction. */
  private writeTask(task: Task): void {
    const { steps, files, messages, ...rest } = task;
    this.db
      .prepare(
        `insert into tasks (id, project_id, status, data, updated_at) values (?, ?, ?, ?, ?)
         on conflict(id) do update set status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(task.id, task.projectId, task.status, JSON.stringify(rest), task.updatedAt);
    for (const table of ["task_steps", "task_files", "task_messages"])
      this.db.prepare(`delete from ${table} where task_id = ?`).run(task.id);
    const step = this.db.prepare("insert into task_steps (task_id, n, text, status) values (?, ?, ?, ?)");
    for (const [n, s] of steps.entries()) step.run(task.id, n, s.text, s.status);
    const file = this.db.prepare("insert into task_files (task_id, n, path, kind, role) values (?, ?, ?, ?, ?)");
    for (const [n, f] of files.entries()) file.run(task.id, n, f.path, f.kind, f.role);
    const message = this.db.prepare("insert into task_messages (task_id, n, sender, at, data) values (?, ?, ?, ?, ?)");
    for (const [n, m] of messages.entries()) message.run(task.id, n, m.from, m.at, JSON.stringify(m));
  }

  /** The saved settings over the defaults, so a setting added in a later version has a value. */
  getSettings(): Settings {
    const row = this.db.prepare("select value from settings where key = 'app'").get() as { value: string } | undefined;
    return { ...DEFAULT_SETTINGS, ...(row ? (JSON.parse(row.value) as Partial<Settings>) : {}) };
  }

  saveSettings(settings: Settings): void {
    this.db
      .prepare(
        "insert into settings (key, value) values ('app', ?) on conflict(key) do update set value = excluded.value",
      )
      .run(JSON.stringify(settings));
  }

  /** A small value the app keeps for itself, such as the folder files were last attached from. Null when unset. */
  value(key: string): string | null {
    const row = this.db.prepare("select value from settings where key = ?").get(`value:${key}`) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  saveValue(key: string, value: string): void {
    this.db
      .prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value")
      .run(`value:${key}`, value);
  }

  saveProject(project: Project): void {
    this.db
      .prepare(
        "insert into projects (id, data, created_at) values (?, ?, ?) on conflict(id) do update set data = excluded.data",
      )
      .run(project.id, JSON.stringify(project), project.createdAt);
  }

  listProjects(): Project[] {
    const rows = this.db.prepare("select data from projects order by created_at").all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Project);
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("select data from projects where id = ?").get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Project) : undefined;
  }

  /** How much goes with a project when it's removed, for the confirmation. */
  projectUsage(id: string): { tasks: number; jobs: number } {
    const count = (sql: string) => Number((this.db.prepare(sql).get(id) as { n: number }).n);
    return {
      tasks: count("select count(*) as n from tasks where project_id = ?"),
      jobs: count("select count(*) as n from jobs where json_extract(data, '$.projectId') = ?"),
    };
  }

  /**
   * Removes a project with its tasks and jobs, all or nothing. Only the app's records go: nothing here touches the
   * project's folder. Gives the ids of the jobs removed, so the window can drop them.
   */
  removeProject(id: string): string[] {
    const jobs = this.db.prepare("select id from jobs where json_extract(data, '$.projectId') = ?").all(id) as {
      id: string;
    }[];
    this.transaction(() => {
      this.db.prepare("delete from tasks where project_id = ?").run(id);
      this.db.prepare("delete from jobs where json_extract(data, '$.projectId') = ?").run(id);
      this.db.prepare("delete from projects where id = ?").run(id);
    });
    return jobs.map((j) => j.id);
  }

  saveTask(task: Task): void {
    this.transaction(() => this.writeTask(task));
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare("select data from tasks where id = ?").get(id) as { data: string } | undefined;
    return row ? this.tasksOf([row])[0] : undefined;
  }

  deleteTask(id: string): void {
    this.db.prepare("delete from tasks where id = ?").run(id);
  }

  /** Most recently updated first. */
  listTasks(limit = 50): Task[] {
    const rows = this.db.prepare("select data from tasks order by updated_at desc limit ?").all(limit) as {
      data: string;
    }[];
    return this.tasksOf(rows);
  }

  /**
   * Every task, newest first, for the board.
   * shortcut: reads the whole table at once; page it, or leave old finished tasks out, if boards reach thousands.
   */
  listAllTasks(): Task[] {
    const rows = this.db.prepare("select data from tasks order by updated_at desc").all() as { data: string }[];
    return this.tasksOf(rows);
  }

  /** Tasks whose title or brief holds every word of the query, ignoring case and accents. Newest first. */
  searchTasks(query: string, limit = SEARCH_LIMIT): Task[] {
    const words = searchWords(query);
    if (words.length === 0) return [];
    // Only the two fields are read for every task; the whole task only for the ones that match.
    const rows = this.db
      .prepare(
        "select id, json_extract(data, '$.title') as title, json_extract(data, '$.brief') as brief from tasks order by updated_at desc",
      )
      .all() as { id: string; title: string | null; brief: string | null }[];
    return rows
      .filter((r) => matchesWords(`${r.title ?? ""}\n${r.brief ?? ""}`, words))
      .slice(0, limit)
      .flatMap((r) => this.getTask(r.id) ?? []);
  }

  /** Every task of one project, newest first. The recent list stops at 50, a project's history doesn't. */
  listProjectTasks(projectId: string): Task[] {
    const rows = this.db
      .prepare("select data from tasks where project_id = ? order by updated_at desc")
      .all(projectId) as { data: string }[];
    return this.tasksOf(rows);
  }

  saveJob(job: Job): void {
    this.db
      .prepare(
        "insert into jobs (id, data, created_at) values (?, ?, ?) on conflict(id) do update set data = excluded.data",
      )
      .run(job.id, JSON.stringify(job), job.createdAt);
  }

  getJob(id: string): Job | undefined {
    const row = this.db.prepare("select data from jobs where id = ?").get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Job) : undefined;
  }

  /** Oldest first, the order they were made in. */
  listJobs(): Job[] {
    const rows = this.db.prepare("select data from jobs order by created_at").all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Job);
  }

  /** Every task still working or waiting for the user, however old, newest first. */
  listActiveTasks(): Task[] {
    const rows = this.db
      .prepare("select data from tasks where status in ('running', 'needs-you') order by updated_at desc")
      .all() as { data: string }[];
    return this.tasksOf(rows);
  }

  /** Whether a run of this job still needs the user or is still working. */
  jobBusy(jobId: string): boolean {
    const row = this.db
      .prepare(
        "select 1 from tasks where status in ('running', 'needs-you') and json_extract(data, '$.jobId') = ? limit 1",
      )
      .get(jobId);
    return row !== undefined;
  }

  deleteJob(id: string): void {
    this.db.prepare("delete from jobs where id = ?").run(id);
  }

  /** How many tasks each project has, for the project cards. */
  /** Each project's tasks in a few numbers, and its newest file, for the projects page. */
  projectOverviews(): Record<string, ProjectOverview> {
    const counts = this.db
      .prepare(
        `select project_id as id, count(*) as n, sum(status = 'running') as working, sum(status = 'needs-you') as needs
         from tasks where project_id is not null group by project_id`,
      )
      .all() as { id: string; n: number; working: number; needs: number }[];
    const overviews: Record<string, ProjectOverview> = {};
    for (const r of counts)
      overviews[r.id] = { tasks: Number(r.n), working: Number(r.working), needsYou: Number(r.needs), lastResult: null };
    // Newest first, and only tasks that made something, so each project's first hit is its last result.
    const made = this.db
      .prepare(
        `select project_id as id, data from tasks t where project_id is not null
           and exists (select 1 from task_files f where f.task_id = t.id and f.role = 'made')
         order by updated_at desc`,
      )
      .iterate() as Iterable<{ id: string; data: string }>;
    let left = counts.length;
    for (const row of made) {
      const overview = overviews[row.id];
      if (!overview || overview.lastResult) continue;
      const [task] = this.tasksOf([row]);
      overview.lastResult = task ? lastMade(task) : null;
      if (overview.lastResult && --left === 0) break;
    }
    return overviews;
  }

  /** Tasks that were running when the app quit can't continue, so they are marked stopped on the next start. */
  stopInterrupted(at: string): number {
    // A task waiting for the user isn't cut off: its agent ended its turn, and the answer starts the next one.
    const rows = this.db.prepare("select data from tasks where status = 'running'").all() as {
      data: string;
    }[];
    for (const task of this.tasksOf(rows))
      this.saveTask({ ...task, status: "stopped", interrupted: true, question: null, approval: null, updatedAt: at });
    return rows.length;
  }

  close(): void {
    this.db.close();
  }
}
