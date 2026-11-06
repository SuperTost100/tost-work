import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_SETTINGS,
  type Job,
  lastMade,
  type Project,
  type ProjectOverview,
  type Settings,
  type Task,
} from "../../shared/model";
import { matchesWords, SEARCH_LIMIT, searchWords } from "../../shared/search";

/**
 * Projects and tasks, in SQLite through Node's built-in driver, so there is no native module to rebuild for Electron.
 * shortcut: each task is one JSON column; move steps, files and messages to their own tables when the board needs
 * to query them.
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
    `);
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
    this.db.exec("begin");
    try {
      this.db.prepare("delete from tasks where project_id = ?").run(id);
      this.db.prepare("delete from jobs where json_extract(data, '$.projectId') = ?").run(id);
      this.db.prepare("delete from projects where id = ?").run(id);
      this.db.exec("commit");
    } catch (err) {
      this.db.exec("rollback");
      throw err;
    }
    return jobs.map((j) => j.id);
  }

  saveTask(task: Task): void {
    this.db
      .prepare(
        `insert into tasks (id, project_id, status, data, updated_at) values (?, ?, ?, ?, ?)
         on conflict(id) do update set status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(task.id, task.projectId, task.status, JSON.stringify(task), task.updatedAt);
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare("select data from tasks where id = ?").get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Task) : undefined;
  }

  deleteTask(id: string): void {
    this.db.prepare("delete from tasks where id = ?").run(id);
  }

  /** Most recently updated first. */
  listTasks(limit = 50): Task[] {
    const rows = this.db.prepare("select data from tasks order by updated_at desc limit ?").all(limit) as {
      data: string;
    }[];
    return rows.map((r) => JSON.parse(r.data) as Task);
  }

  /**
   * Every task, newest first, for the board.
   * shortcut: reads the whole table at once; page it, or leave old finished tasks out, if boards reach thousands.
   */
  listAllTasks(): Task[] {
    const rows = this.db.prepare("select data from tasks order by updated_at desc").all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Task);
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
    return rows.map((r) => JSON.parse(r.data) as Task);
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
    return rows.map((r) => JSON.parse(r.data) as Task);
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
        `select project_id as id, data from tasks where project_id is not null and data like '%"role":"made"%'
         order by updated_at desc`,
      )
      .iterate() as Iterable<{ id: string; data: string }>;
    let left = counts.length;
    for (const row of made) {
      const overview = overviews[row.id];
      if (!overview || overview.lastResult) continue;
      overview.lastResult = lastMade(JSON.parse(row.data) as Task);
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
    for (const row of rows) {
      const task = JSON.parse(row.data) as Task;
      this.saveTask({ ...task, status: "stopped", interrupted: true, question: null, approval: null, updatedAt: at });
    }
    return rows.length;
  }

  close(): void {
    this.db.close();
  }
}
