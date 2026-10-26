import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, type BrowserWindow, dialog, ipcMain, Menu, type OpenDialogOptions, shell } from "electron";
import { IPC, type NewProjectInput, type NewTaskInput, type SaveResult, type TaskMenuAction } from "../shared/api";
import { languageFrom, type MessageKey, translate } from "../shared/i18n";
import type { Project } from "../shared/model";
import type { Accounts } from "./accounts";
import type { TaskRunner } from "./engine/runner";
import { type Conflict, copyInto, describe, readablePath, savablePaths, saveCopies } from "./files";
import type { Store } from "./store/store";
import { absolutePath, paths, settingsPatch, text } from "./validate";

/** Validates everything that comes from the interface, because IPC is a trust boundary. */
export function registerIpc(
  store: Store,
  runner: TaskRunner,
  accounts: Accounts,
  window: () => BrowserWindow | null,
): void {
  // Native dialogs speak the interface's language: the saved choice, or the system's.
  const t = (key: MessageKey, vars?: Record<string, string>) =>
    translate(store.getSettings().language ?? languageFrom(app.getLocale()), key, vars);
  const openDialog = (options: OpenDialogOptions) => {
    const win = window();
    return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
  };

  ipcMain.handle(IPC.settingsGet, () => store.getSettings());
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: unknown) => {
    const settings = { ...store.getSettings(), ...settingsPatch(patch) };
    store.saveSettings(settings);
    return settings;
  });

  ipcMain.handle(IPC.accountStatus, () => accounts.status());
  // The sign-in runs on after this returns; its progress and any failure go out as sign-in events.
  ipcMain.handle(IPC.accountSignIn, () => {
    void accounts.signIn();
  });
  ipcMain.handle(IPC.accountSendCode, (_e, code: unknown) => accounts.sendCode(text(code, "code", 200).trim()));
  ipcMain.handle(IPC.accountCancel, () => accounts.cancel());

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
    const result = await openDialog({ properties: ["openDirectory", "createDirectory"] });
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
    const given = paths(input?.attachments, "attachments");
    // Before any copying: if the engine can't start a task, no folder or copies are left behind.
    const { model, effort } = await runner.defaults();
    let attachments = given;
    if (!project) {
      await mkdir(workdir, { recursive: true });
      // The agent edits copies, so the user's originals stay as they are until they save a copy.
      attachments = await copyInto(given, workdir);
    }
    const task = runner.create({ projectId, brief, workdir, attachments, model, effort });
    runner.launch(task.id);
    return task;
  });

  ipcMain.handle(IPC.tasksAnswer, (_e, id: unknown, answer: unknown) =>
    runner.answer(text(id, "id", 100), text(answer, "answer", 5000)),
  );
  ipcMain.handle(IPC.tasksStop, (_e, id: unknown) => runner.stop(text(id, "id", 100)));
  ipcMain.handle(IPC.tasksDecide, (_e, id: unknown, allow: unknown) => {
    if (typeof allow !== "boolean") throw new Error("allow must be true or false");
    return runner.decide(text(id, "id", 100), allow);
  });
  ipcMain.handle(IPC.tasksFollowUp, (_e, id: unknown, message: unknown) => {
    const taskId = text(id, "id", 100);
    const body = text(message, "message").trim();
    if (!body) throw new Error("Write what to change first");
    const task = runner.followUp(taskId, body);
    runner.launch(taskId, body);
    return task;
  });

  ipcMain.handle(IPC.tasksSaveCopy, async (_e, id: unknown): Promise<SaveResult | null> => {
    const task = store.getTask(text(id, "id", 100));
    if (!task) throw new Error("That task doesn't exist");
    if (runner.isRunning(task.id)) throw new Error("Wait for the task to finish before saving");
    const sources = await savablePaths(task);
    if (sources.length === 0) throw new Error("This task hasn't made any files yet");
    const picked = await openDialog({
      title: t("save.pick"),
      buttonLabel: t("save.here"),
      properties: ["openDirectory", "createDirectory"],
    });
    const folder = picked.canceled ? undefined : picked.filePaths[0];
    if (!folder) return null;
    const ask = async (name: string): Promise<Conflict> => {
      const options = {
        type: "question" as const,
        message: t("save.exists", { name }),
        detail: t("save.existsDetail"),
        buttons: [t("save.keepBoth"), t("save.replace"), t("save.cancel")],
        defaultId: 0,
        cancelId: 2,
      };
      const win = window();
      const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      return (["keep-both", "replace", "cancel"] as const)[response] ?? "cancel";
    };
    const { saved } = await saveCopies(sources, folder, ask, (path) => shell.trashItem(path));
    return { folder, saved };
  });

  const taskOf = (id: unknown) => {
    const task = store.getTask(text(id, "id", 100));
    if (!task) throw new Error("That task doesn't exist");
    return task;
  };
  // A native menu, as Finder's and Mail's are. It only says what was picked; the window carries it out.
  ipcMain.handle(IPC.tasksMenu, (_e, id: unknown) => {
    const task = taskOf(id);
    return new Promise<TaskMenuAction | null>((resolve) => {
      let picked = false;
      const pick = (action: TaskMenuAction) => () => {
        picked = true;
        resolve(action);
      };
      const menu = Menu.buildFromTemplate([
        { label: t("menu.rename"), click: pick("rename") },
        { label: t("menu.reveal"), click: pick("reveal") },
        { type: "separator" },
        { label: t("menu.delete"), enabled: !runner.isRunning(task.id), click: pick("delete") },
      ]);
      // The menu closes before its click arrives on some systems, so a close with no pick waits a moment.
      const closed = () => setTimeout(() => picked || resolve(null), 100);
      const win = window();
      menu.popup(win ? { window: win, callback: closed } : { callback: closed });
    });
  });
  ipcMain.handle(IPC.tasksRename, (_e, id: unknown, title: unknown) =>
    runner.rename(text(id, "id", 100), text(title, "title", 200)),
  );
  ipcMain.handle(IPC.tasksReveal, async (_e, id: unknown) => {
    const error = await shell.openPath(taskOf(id).workdir);
    if (error) throw new Error(error);
  });
  ipcMain.handle(IPC.tasksRemove, async (_e, id: unknown) => {
    const task = taskOf(id);
    const options = {
      type: "warning" as const,
      message: t("delete.confirm", { name: task.title }),
      detail: t("delete.detail"),
      buttons: [t("delete.yes"), t("save.cancel")],
      defaultId: 1,
      cancelId: 1,
    };
    const win = window();
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (response !== 0) return false;
    runner.remove(task.id);
    return true;
  });

  ipcMain.handle(IPC.filesPick, async () => {
    const result = await openDialog({ title: t("attach.pick"), properties: ["openFile", "multiSelections"] });
    return result.canceled ? [] : result.filePaths;
  });

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
  ipcMain.handle(IPC.filesRestore, (_e, taskId: unknown, path: unknown) =>
    runner.restore(text(taskId, "taskId", 100), absolutePath(path, "path")),
  );
}
