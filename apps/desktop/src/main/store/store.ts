import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS, type Project, type Settings, type Task } from "../../shared/model";

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

  /** Every task of one project, newest first. The recent list stops at 50, a project's history doesn't. */
  listProjectTasks(projectId: string): Task[] {
    const rows = this.db
      .prepare("select data from tasks where project_id = ? order by updated_at desc")
      .all(projectId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Task);
  }

  /** How many tasks each project has, for the project cards. */
  taskCounts(): Record<string, number> {
    const rows = this.db
      .prepare("select project_id as id, count(*) as n from tasks where project_id is not null group by project_id")
      .all() as { id: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.id, Number(r.n)]));
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
