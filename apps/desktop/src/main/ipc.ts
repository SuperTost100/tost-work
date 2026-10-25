import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserWindow, dialog, ipcMain, shell } from "electron";
import { IPC, type NewProjectInput, type NewTaskInput } from "../shared/api";
import type { Project } from "../shared/model";
import type { TaskRunner } from "./engine/runner";
import { describe, readablePath } from "./files";
import type { Store } from "./store/store";
import { absolutePath, paths, text } from "./validate";

/** Validates everything that comes from the interface, because IPC is a trust boundary. */
export function registerIpc(store: Store, runner: TaskRunner, window: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.projectsList, () => store.listProjects());

  ipcMain.handle(IPC.projectsCreate, (_e, input: NewProjectInput) => {
    const name = text(input?.name, "name", 200).trim();
    const folder = absolutePath(input?.folder, "folder");
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
  ipcMain.handle(IPC.tasksListForProject, (_e, projectId: unknown) =>
    store.listProjectTasks(text(projectId, "projectId", 100)),
  );
  ipcMain.handle(IPC.projectsTaskCounts, () => store.taskCounts());
  ipcMain.handle(IPC.tasksGet, (_e, id: unknown) => store.getTask(text(id, "id", 100)) ?? null);

  ipcMain.handle(IPC.tasksStart, async (_e, input: NewTaskInput) => {
    const brief = text(input?.brief, "brief").trim();
    if (!brief) throw new Error("A task needs a brief");
    const projectId = input?.projectId == null ? null : text(input.projectId, "projectId", 100);
    const project = projectId ? store.getProject(projectId) : undefined;
    if (projectId && !project) throw new Error("That project doesn't exist");
    // A task without a project works in a temporary folder of its own, as a quick edit does.
    const workdir = project?.folder ?? join(tmpdir(), "tost-work", "quick", randomUUID());
    if (!project) await mkdir(workdir, { recursive: true });
    const task = runner.create({ projectId, brief, workdir, attachments: paths(input?.attachments, "attachments") });
    runner.launch(task.id);
    return task;
  });

  ipcMain.handle(IPC.tasksAnswer, (_e, id: unknown, answer: unknown) =>
    runner.answer(text(id, "id", 100), text(answer, "answer", 5000)),
  );
  ipcMain.handle(IPC.tasksStop, (_e, id: unknown) => runner.stop(text(id, "id", 100)));

  const fileOf = async (taskId: unknown, path: unknown, limitSize = true) => {
    const task = store.getTask(text(taskId, "taskId", 100));
    if (!task) throw new Error("That task doesn't exist");
    return readablePath(task, absolutePath(path, "path"), limitSize);
  };
  ipcMain.handle(IPC.filesRead, async (_e, taskId: unknown, path: unknown) => {
    const real = await fileOf(taskId, path);
    return { ...describe(real), bytes: new Uint8Array(await readFile(real)) };
  });
  ipcMain.handle(IPC.filesOpen, async (_e, taskId: unknown, path: unknown) => {
    const error = await shell.openPath(await fileOf(taskId, path, false));
    if (error) throw new Error(error);
  });
  ipcMain.handle(IPC.filesReveal, async (_e, taskId: unknown, path: unknown) =>
    shell.showItemInFolder(await fileOf(taskId, path, false)),
  );
}
