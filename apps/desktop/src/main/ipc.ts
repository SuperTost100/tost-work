import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { app, type BrowserWindow, dialog, ipcMain, Menu, type OpenDialogOptions, shell } from "electron";
import {
  IPC,
  type NewProjectInput,
  type NewTaskInput,
  type ProjectMenuAction,
  type SaveResult,
  type TaskMenuAction,
} from "../shared/api";
import { languageFrom, type MessageKey, translate } from "../shared/i18n";
import { type AgentProvider, BRIEF_MAX, MAX_QUESTIONS, type Project, type Settings } from "../shared/model";
import type { Accounts } from "./accounts";
import type { TaskRunner } from "./engine/runner";
import { type Conflict, copyInto, describe, readablePath, savablePaths, saveCopies } from "./files";
import type { Installer } from "./installer";
import { type Jobs, jobDraft } from "./jobs";
import type { KeyStore } from "./keys";
import { removalText } from "./projects";
import type { SkillFolder } from "./skills";
import type { Store } from "./store/store";
import { absolutePath, paths, settingsPatch, text } from "./validate";

/** Validates everything that comes from the interface, because IPC is a trust boundary. */
export function registerIpc(
  store: Store,
  runner: TaskRunner,
  accounts: Record<AgentProvider, Accounts>,
  keys: KeyStore,
  installer: Installer,
  window: () => BrowserWindow | null,
  /** Applies saved settings to the window and the menu bar. */
  settingsSaved: (settings: Settings) => void,
  skills: SkillFolder,
  jobs: Jobs,
): void {
  const account = (provider: unknown): Accounts => {
    if (provider !== "codex" && provider !== "claude") throw new Error("provider must be codex or claude");
    return accounts[provider];
  };
  // Native dialogs speak the interface's language: the saved choice, or the system's.
  const t = (key: MessageKey, vars?: Record<string, string>) =>
    translate(store.getSettings().language ?? languageFrom(app.getLocale()), key, vars);
  const openDialog = (options: OpenDialogOptions) => {
    const win = window();
    return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
  };

  ipcMain.handle(IPC.settingsGet, () => store.getSettings());
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: unknown) => {
    const current = store.getSettings();
    const changes = settingsPatch(patch);
    // A patch names only the section switches and notifications it changes, so two quick toggles can't undo each other.
    const settings = {
      ...current,
      ...changes,
      sections: { ...current.sections, ...changes.sections },
      notify: { ...current.notify, ...changes.notify },
    };
    store.saveSettings(settings);
    settingsSaved(settings);
    return settings;
  });

  ipcMain.handle(IPC.accountStatus, (_e, provider: unknown) => account(provider).status());
  // The sign-in runs on after this returns; its progress and any failure go out as sign-in events.
  ipcMain.handle(IPC.accountSignIn, (_e, provider: unknown) => {
    void account(provider).signIn();
  });
  ipcMain.handle(IPC.accountSendCode, (_e, provider: unknown, code: unknown) =>
    account(provider).sendCode(text(code, "code", 200).trim()),
  );
  ipcMain.handle(IPC.accountCancel, (_e, provider: unknown) => account(provider).cancel());
  ipcMain.handle(IPC.accountSignOut, (_e, provider: unknown) => account(provider).signOut());
  ipcMain.handle(IPC.accountInstall, (_e, provider: unknown) => {
    account(provider);
    return installer.install(provider as AgentProvider);
  });
  ipcMain.handle(IPC.keyInfo, () => keys.info());
  ipcMain.handle(IPC.keySave, (_e, key: unknown) => keys.save(text(key, "key", 400).trim()));
  ipcMain.handle(IPC.keyRemove, () => keys.remove());

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
  ipcMain.handle(IPC.tasksDraft, (_e, id: unknown) => runner.draft(text(id, "id", 100)));

  ipcMain.handle(IPC.tasksStart, async (_e, input: NewTaskInput) => {
    const brief = text(input?.brief, "brief", BRIEF_MAX).trim();
    if (!brief) throw new Error("A task needs a brief");
    const projectId = input?.projectId == null ? null : text(input.projectId, "projectId", 100);
    const project = projectId ? store.getProject(projectId) : undefined;
    if (projectId && !project) throw new Error("That project doesn't exist");
    // A task without a project works in a temporary folder of its own, as a quick edit does.
    const workdir = project?.folder ?? join(tmpdir(), "tost-work", "quick", randomUUID());
    const given = paths(input?.attachments, "attachments");
    // Before any copying: if the engine can't start a task, no folder or copies are left behind.
    const { provider, auth, model, effort } = await runner.defaults();
    let attachments = given;
    if (!project) {
      await mkdir(workdir, { recursive: true });
      // The agent edits copies, so the user's originals stay as they are until they save a copy.
      attachments = await copyInto(given, workdir);
    }
    const task = runner.create({ projectId, brief, workdir, attachments, provider, auth, model, effort });
    runner.launch(task.id);
    return task;
  });

  ipcMain.handle(IPC.tasksAnswer, (_e, id: unknown, answers: unknown) => {
    if (!Array.isArray(answers) || answers.length > MAX_QUESTIONS) throw new Error("Send one answer per question");
    return runner.answer(
      text(id, "id", 100),
      answers.map((a) => text(a, "answer", BRIEF_MAX)),
    );
  });
  ipcMain.handle(IPC.tasksStop, (_e, id: unknown) => runner.stop(text(id, "id", 100)));
  ipcMain.handle(IPC.tasksResume, (_e, id: unknown) => runner.resume(text(id, "id", 100)));
  ipcMain.handle(IPC.tasksDecide, (_e, id: unknown, allow: unknown) => {
    if (typeof allow !== "boolean") throw new Error("allow must be true or false");
    return runner.decide(text(id, "id", 100), allow);
  });
  ipcMain.handle(IPC.tasksFollowUp, (_e, id: unknown, message: unknown) => {
    const taskId = text(id, "id", 100);
    const body = text(message, "message", BRIEF_MAX).trim();
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
  const popup = <A>(items: ({ label: string; action: A; enabled?: boolean } | "separator")[]) =>
    new Promise<A | null>((resolve) => {
      let picked = false;
      const menu = Menu.buildFromTemplate(
        items.map((item) =>
          item === "separator"
            ? { type: "separator" as const }
            : {
                label: item.label,
                enabled: item.enabled,
                click: () => {
                  picked = true;
                  resolve(item.action);
                },
              },
        ),
      );
      // The menu closes before its click arrives on some systems, so a close with no pick waits a moment.
      const closed = () => setTimeout(() => picked || resolve(null), 100);
      const win = window();
      menu.popup(win ? { window: win, callback: closed } : { callback: closed });
    });
  const itemMenu = (canDelete: boolean) =>
    popup<TaskMenuAction>([
      { label: t("menu.rename"), action: "rename" },
      { label: t("menu.reveal"), action: "reveal" },
      "separator",
      { label: t("menu.delete"), action: "delete", enabled: canDelete },
    ]);
  ipcMain.handle(IPC.tasksMenu, (_e, id: unknown) => itemMenu(!runner.isRunning(taskOf(id).id)));
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

  const projectOf = (id: unknown) => {
    const project = store.getProject(text(id, "id", 100));
    if (!project) throw new Error("That project doesn't exist");
    return project;
  };
  ipcMain.handle(IPC.projectsMenu, (_e, id: unknown) => {
    projectOf(id);
    return popup<ProjectMenuAction>([
      { label: t("menu.rename"), action: "rename" },
      { label: t("menu.editInstructions"), action: "instructions" },
      { label: t("menu.reveal"), action: "reveal" },
      "separator",
      { label: t("menu.removeProject"), action: "remove" },
    ]);
  });
  ipcMain.handle(IPC.projectsUpdate, (_e, id: unknown, patch: unknown) => {
    const project = projectOf(id);
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new Error("patch must be an object");
    const input = patch as Record<string, unknown>;
    const next = { ...project };
    for (const key of Object.keys(input)) {
      if (key === "name") {
        next.name = text(input.name, "name", 200).trim();
        if (!next.name) throw new Error("A project needs a name");
      } else if (key === "instructions") next.instructions = text(input.instructions, "instructions");
      else throw new Error(`Unknown project field: ${key}`);
    }
    store.saveProject(next);
    return next;
  });
  ipcMain.handle(IPC.projectsReveal, async (_e, id: unknown) => {
    const error = await shell.openPath(projectOf(id).folder);
    if (error) throw new Error(error);
  });
  ipcMain.handle(IPC.projectsRemove, async (_e, id: unknown) => {
    const project = projectOf(id);
    const lang = store.getSettings().language ?? languageFrom(app.getLocale());
    const { message, detail } = removalText(lang, project.name, store.projectUsage(project.id));
    const options = {
      type: "warning" as const,
      message,
      detail,
      buttons: [t("project.removeYes"), t("save.cancel")],
      defaultId: 1,
      cancelId: 1,
    };
    const win = window();
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (response !== 0) return false;
    // Working tasks end first: a run still ending would save its task back after the project is gone. Only the
    // app's records go. The folder is never touched.
    await runner.stopProject(project.id);
    try {
      jobs.removeProject(project.id);
    } catch (err) {
      runner.projectStays(project.id);
      throw err;
    }
    return true;
  });

  // Skills. Ids are folder names, which SkillFolder checks; the text fields have the format's limits.
  const skillId = (id: unknown) => text(id, "id", 200);
  const draft = (value: unknown) => {
    const d = (value ?? {}) as Record<string, unknown>;
    const title = text(d.title, "title", 200).trim();
    if (!title) throw new Error("A skill needs a name");
    return { title, description: text(d.description, "description", 1024), steps: text(d.steps, "steps", BRIEF_MAX) };
  };
  ipcMain.handle(IPC.jobsList, () => jobs.list());
  ipcMain.handle(IPC.jobsCreate, (_e, draft: unknown) => jobs.create(jobDraft(draft)));
  ipcMain.handle(IPC.jobsUpdate, (_e, id: unknown, draft: unknown) =>
    jobs.update(text(id, "id", 100), jobDraft(draft)),
  );
  ipcMain.handle(IPC.jobsSetOn, (_e, id: unknown, on: unknown) => {
    if (typeof on !== "boolean") throw new Error("on must be true or false");
    return jobs.setOn(text(id, "id", 100), on);
  });
  ipcMain.handle(IPC.jobsSkipOnce, (_e, id: unknown) => jobs.skipOnce(text(id, "id", 100)));
  ipcMain.handle(IPC.jobsRemove, (_e, id: unknown) => jobs.remove(text(id, "id", 100)));
  ipcMain.handle(IPC.jobsRunNow, (_e, id: unknown) => jobs.runNow(text(id, "id", 100)));

  ipcMain.handle(IPC.skillsList, async () => [...(await skills.list()), ...(await skills.builtIns())]);
  ipcMain.handle(IPC.skillsCreate, (_e, title: unknown) => {
    const name = text(title, "title", 200).trim();
    if (!name) throw new Error("A skill needs a name");
    return skills.create(name);
  });
  ipcMain.handle(IPC.skillsSave, (_e, id: unknown, value: unknown, note: unknown) =>
    skills.save(skillId(id), draft(value), note == null ? "" : text(note, "note", 200)),
  );
  ipcMain.handle(IPC.skillsDuplicate, (_e, id: unknown) =>
    skills.duplicate(skillId(id), (title) => t("skills.copyOf", { title })),
  );
  ipcMain.handle(IPC.skillsImport, async (_e, dropped: unknown) => {
    if (dropped != null) {
      const path = text(dropped, "path", 4096);
      if (!isAbsolute(path)) throw new Error("Drop a skill's folder or a .zip of one");
      // A SKILL.md dropped on its own stands for the folder it's in.
      return skills.import(basename(path) === "SKILL.md" ? dirname(path) : path);
    }
    // Windows and Linux can't pick a folder or a file in one dialog, so a menu asks which first, on every system alike.
    const from = await new Promise<"folder" | "zip" | null>((resolve) => {
      let picked = false;
      const pick = (kind: "folder" | "zip") => () => {
        picked = true;
        resolve(kind);
      };
      const menu = Menu.buildFromTemplate([
        { label: t("skills.importFolder"), click: pick("folder") },
        { label: t("skills.importZip"), click: pick("zip") },
      ]);
      const closed = () => setTimeout(() => picked || resolve(null), 100);
      const win = window();
      menu.popup(win ? { window: win, callback: closed } : { callback: closed });
    });
    if (!from) return null;
    const result = await openDialog(
      from === "folder"
        ? { title: t("skills.importFolder"), properties: ["openDirectory"] }
        : { title: t("skills.importZip"), properties: ["openFile"], filters: [{ name: "Zip", extensions: ["zip"] }] },
    );
    const picked = result.canceled ? undefined : result.filePaths[0];
    return picked ? skills.import(picked) : null;
  });
  ipcMain.handle(IPC.skillsHistory, (_e, id: unknown) => skills.history(skillId(id)));
  ipcMain.handle(IPC.skillsRestore, (_e, id: unknown, n: unknown) => {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new Error("That version isn't kept any more");
    return skills.restore(skillId(id), n);
  });
  ipcMain.handle(IPC.skillsAddFiles, async (_e, id: unknown) => {
    const result = await openDialog({ title: t("skills.addFiles"), properties: ["openFile", "multiSelections"] });
    const skill = skillId(id);
    return skills.addFiles(skill, result.canceled ? [] : result.filePaths);
  });
  ipcMain.handle(IPC.skillsReveal, async (_e, id: unknown) => {
    const error = await shell.openPath(await skills.folderOf(skillId(id)));
    if (error) throw new Error(error);
  });
  ipcMain.handle(IPC.skillsRemove, (_e, id: unknown) => skills.remove(skillId(id)));
  ipcMain.handle(IPC.skillsMenu, (_e, id: unknown) => {
    skillId(id);
    return itemMenu(true);
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
  // A file the task listed may be missing for a moment while the agent rewrites it, or for good if the user moved
  // it. That's null, which the preview explains, rather than an error.
  ipcMain.handle(IPC.filesRead, async (_e, taskId: unknown, path: unknown) => {
    try {
      const real = await fileOf(taskId, path);
      return { ...describe(real), bytes: new Uint8Array(await readFile(real)) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
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
