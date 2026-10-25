import { DatabaseSync } from "node:sqlite";
import type { Project, Task } from "../../shared/model";

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
    `);
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

  /** Most recently updated first. */
  listTasks(limit = 50): Task[] {
    const rows = this.db.prepare("select data from tasks order by updated_at desc limit ?").all(limit) as {
      data: string;
    }[];
    return rows.map((r) => JSON.parse(r.data) as Task);
  }

  /** Tasks that were running when the app quit can't continue, so they are marked stopped on the next start. */
  stopInterrupted(at: string): number {
    let count = 0;
    for (const task of this.listTasks(1000)) {
      if (task.status === "running" || task.status === "needs-you") {
        this.saveTask({ ...task, status: "stopped", question: null, approval: null, updatedAt: at });
        count++;
      }
    }
    return count;
  }

  close(): void {
    this.db.close();
  }
}
