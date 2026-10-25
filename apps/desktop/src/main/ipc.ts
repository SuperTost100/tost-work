import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserWindow, dialog, ipcMain } from "electron";
import { IPC, type NewProjectInput, type NewTaskInput } from "../shared/api";
import type { Project } from "../shared/model";
import type { TaskRunner } from "./engine/runner";
import type { Store } from "./store/store";

const text = (v: unknown, field: string, max = 20_000): string => {
  if (typeof v !== "string") throw new Error(`${field} must be text`);
  if (v.length > max) throw new Error(`${field} is too long`);
  return v;
};

/** Validates everything that comes from the interface, because IPC is a trust boundary. */
export function registerIpc(store: Store, runner: TaskRunner, window: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.projectsList, () => store.listProjects());

  ipcMain.handle(IPC.projectsCreate, (_e, input: NewProjectInput) => {
    const name = text(input?.name, "name", 200).trim();
    const folder = text(input?.folder, "folder", 4096);
    if (!name) throw new Error("A project needs a name");
    const project: Project = {
      id: randomUUID(),
      name,
      description: text(input?.description ?? "", "description", 2000),
      folder,
      instructions: "",
      createdAt: new Date().toISOString(),
    };
    store.saveProject(project);
    return project;
  });

  ipcMain.handle(IPC.projectsPickFolder, async () => {
    const win = window();
    const options = { properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(IPC.tasksList, () => store.listTasks());
  ipcMain.handle(IPC.tasksGet, (_e, id: unknown) => store.getTask(text(id, "id", 100)) ?? null);

  ipcMain.handle(IPC.tasksStart, async (_e, input: NewTaskInput) => {
    const brief = text(input?.brief, "brief").trim();
    if (!brief) throw new Error("A task needs a brief");
    const projectId = input?.projectId == null ? null : text(input.projectId, "projectId", 100);
    const project = projectId ? store.getProject(projectId) : undefined;
    if (projectId && !project) throw new Error("That project doesn't exist");
    const task = runner.create({ projectId, brief });
    // A task without a project works in a temporary folder of its own, as a quick edit does.
    const workdir = project?.folder ?? join(tmpdir(), "tost-work", "quick", task.id);
    if (!project) await mkdir(workdir, { recursive: true });
    void runner.start(task.id, workdir);
    return task;
  });

  ipcMain.handle(IPC.tasksAnswer, (_e, id: unknown, answer: unknown) =>
    runner.answer(text(id, "id", 100), text(answer, "answer", 5000)),
  );
  ipcMain.handle(IPC.tasksStop, (_e, id: unknown) => runner.stop(text(id, "id", 100)));
}
