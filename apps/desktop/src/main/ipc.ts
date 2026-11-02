import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { app, type BrowserWindow, clipboard, dialog, ipcMain, Menu, type OpenDialogOptions, shell } from "electron";
import {
  IPC,
  type NewProjectInput,
  type ProjectMenuAction,
  type SaveResult,
  type SkillMenuAction,
} from "../shared/api";
import { guideText, languageFrom, type MessageKey, translate } from "../shared/i18n";
import {
  type AgentProvider,
  BRIEF_MAX,
  DESCRIPTION_MAX,
  MAX_QUESTIONS,
  mergeSettings,
  type Project,
  type Settings,
} from "../shared/model";
import { removalText } from "../shared/projectText";
import { type MenuItem, taskMenuItems } from "../shared/taskMenu";
import type { Accounts } from "./accounts";
import type { DebugLogs } from "./debugLog";
import { type TaskRunner, withFiles } from "./engine/runner";
import { type Conflict, copyInto, describe, readablePath, removeCopies, savablePaths, saveCopies } from "./files";
import type { Installer } from "./installer";
import { type Jobs, jobDraft } from "./jobs";
import type { KeyStore } from "./keys";
import type { GuideText, SkillFolder } from "./skills";
import type { Store } from "./store/store";
import { absolutePath, oneLine, paths, placedTask, settingsPatch, text } from "./validate";

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
  debug: DebugLogs,
): void {
  // A handler that fails goes to the app's debug log too, and on to the window as before.
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) =>
    ipcMain.handle(channel, async (e, ...args) => {
      try {
        return await listener(e, ...args);
      } catch (err) {
        debug.app("error", `${channel} failed`, err);
        throw err;
      }
    });
  const account = (provider: unknown): Accounts => {
    if (provider !== "codex" && provider !== "claude") throw new Error("provider must be codex or claude");
    return accounts[provider];
  };
  // Native dialogs speak the interface's language: the saved choice, or the system's.
  const language = () => store.getSettings().language ?? languageFrom(app.getLocale());
  const t = (key: MessageKey, vars?: Record<string, string>) => translate(language(), key, vars);
  // The built-in guides show their titles in that language too.
  const guideInLanguage: GuideText = (name) => guideText(language(), name);
  const openDialog = (options: OpenDialogOptions) => {
    const win = window();
    return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
  };

  handle(IPC.settingsGet, () => store.getSettings());
  handle(IPC.settingsUpdate, (_e, patch: unknown) => {
    const settings = mergeSettings(store.getSettings(), settingsPatch(patch));
    store.saveSettings(settings);
    settingsSaved(settings);
    return settings;
  });

  handle(IPC.accountStatus, (_e, provider: unknown) => account(provider).status());
  // The sign-in runs on after this returns; its progress and any failure go out as sign-in events.
  handle(IPC.accountSignIn, (_e, provider: unknown) => {
    void account(provider).signIn();
  });
  handle(IPC.accountSendCode, (_e, provider: unknown, code: unknown) =>
    account(provider).sendCode(text(code, "code", 200).trim()),
  );
  handle(IPC.accountCancel, (_e, provider: unknown) => account(provider).cancel());
  handle(IPC.accountSignOut, (_e, provider: unknown) => account(provider).signOut());
  handle(IPC.accountInstall, (_e, provider: unknown) => {
    account(provider);
    return installer.install(provider as AgentProvider);
  });
  handle(IPC.keyInfo, () => keys.info());
  handle(IPC.keySave, (_e, key: unknown) => keys.save(text(key, "key", 400).trim()));
  handle(IPC.keyRemove, () => keys.remove());

  handle(IPC.projectsList, () => store.listProjects());

  handle(IPC.projectsCreate, (_e, input: NewProjectInput) => {
    const name = text(input?.name, "name", 200).trim();
    const folder = absolutePath(input?.folder, "folder");
    if (!name) throw new Error("A project needs a name");
    const project: Project = {
      id: randomUUID(),
      name,
      description: oneLine(text(input?.description ?? "", "description", DESCRIPTION_MAX)),
      folder,
      instructions: "",
      createdAt: new Date().toISOString(),
    };
    store.saveProject(project);
    return project;
  });

  handle(IPC.projectsPickFolder, async (_e, defaultPath?: unknown) => {
    const result = await openDialog({
      properties: ["openDirectory", "createDirectory"],
      defaultPath: defaultPath == null ? undefined : text(defaultPath, "defaultPath", 1000),
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle(IPC.tasksList, () => store.listTasks());
  handle(IPC.tasksListActive, () => store.listActiveTasks());
  handle(IPC.tasksListForProject, (_e, projectId: unknown) =>
    store.listProjectTasks(text(projectId, "projectId", 100)),
  );
  handle(IPC.tasksListAll, () => store.listAllTasks());
  handle(IPC.tasksSearch, (_e, query: unknown) => store.searchTasks(text(query, "query", 200)));
  handle(IPC.projectsOverviews, () => store.projectOverviews());
  handle(IPC.tasksGet, (_e, id: unknown) => store.getTask(text(id, "id", 100)) ?? null);
  handle(IPC.tasksDraft, (_e, id: unknown) => runner.draft(text(id, "id", 100)));

  // A new task's brief, project and folder. A task without a project works in a temporary folder of its own, as a
  // quick edit does.
  const newTask = (input: unknown) =>
    placedTask(
      input,
      (id) => store.getProject(id),
      () => join(tmpdir(), "tost-work", "quick", randomUUID()),
    );
  // The files the agent works on. A quick edit's agent edits copies, so the user's originals stay as they are until
  // they save a copy.
  const workFiles = async (projectId: string | null, workdir: string, given: string[]) => {
    if (projectId) return given;
    await mkdir(workdir, { recursive: true });
    return copyInto(given, workdir);
  };
  handle(IPC.tasksStart, async (_e, input: unknown) => {
    const { brief, projectId, attachments: given, workdir } = newTask(input);
    // Before any copying: if the engine can't start a task, no folder or copies are left behind.
    const { provider, auth, model, effort } = await runner.defaults();
    const attachments = await workFiles(projectId, workdir, given);
    const task = runner.create({ projectId, brief, workdir, attachments, provider, auth, model, effort });
    runner.launch(task.id);
    return task;
  });
  // Saved without starting: no engine, and for a quick edit no folder or copies yet. They're made when it starts.
  handle(IPC.tasksSaveForLater, (_e, input: unknown) => runner.create(newTask(input)));
  handle(IPC.tasksStartSaved, (_e, id: unknown) =>
    runner.startSaved(text(id, "id", 100), (task) => workFiles(task.projectId, task.workdir, task.attachments)),
  );
  // An edit to a task saved for later is placed as a new one is, so a change of project moves it to that folder. A
  // quick edit's files are still copied only when it starts.
  handle(IPC.tasksUpdateDraft, (_e, id: unknown, input: unknown) =>
    runner.updateDraft(text(id, "id", 100), newTask(input)),
  );
  handle(IPC.tasksMarkReviewed, (_e, id: unknown) => runner.markReviewed(text(id, "id", 100)));
  handle(IPC.tasksMarkUnreviewed, (_e, id: unknown) => runner.markUnreviewed(text(id, "id", 100)));

  // Files attached after the first message: a quick edit works on copies, as it does with the first ones. If the task
  // then refuses the message, for example because it's working, the copies go again.
  const withAttached = async <T>(taskId: string, given: unknown, use: (files: string[]) => T): Promise<T> => {
    const files = paths(given, "attachments");
    const task = store.getTask(taskId);
    if (!task) throw new Error("That task doesn't exist");
    const copies = task.projectId === null && files.length ? await copyInto(files, task.workdir) : null;
    try {
      return use(copies ?? files);
    } catch (err) {
      if (copies) await removeCopies(copies);
      throw err;
    }
  };
  handle(IPC.tasksAnswer, (_e, id: unknown, answers: unknown, files?: unknown) => {
    if (!Array.isArray(answers) || answers.length > MAX_QUESTIONS) throw new Error("Send one answer per question");
    const taskId = text(id, "id", 100);
    const given = answers.map((a) => text(a, "answer", BRIEF_MAX));
    return withAttached(taskId, files, (attached) => runner.answer(taskId, given, attached));
  });
  handle(IPC.tasksStop, (_e, id: unknown) => runner.stop(text(id, "id", 100)));
  handle(IPC.tasksResume, (_e, id: unknown) => runner.resume(text(id, "id", 100)));
  handle(IPC.tasksDecide, (_e, id: unknown, allow: unknown) => {
    if (typeof allow !== "boolean") throw new Error("allow must be true or false");
    return runner.decide(text(id, "id", 100), allow);
  });
  handle(IPC.tasksFollowUp, (_e, id: unknown, message: unknown, files?: unknown) => {
    const taskId = text(id, "id", 100);
    const body = text(message, "message", BRIEF_MAX).trim();
    if (!body) throw new Error("Write what to change first");
    return withAttached(taskId, files, (attached) => {
      const task = runner.followUp(taskId, body, attached);
      runner.launch(taskId, withFiles(body, attached));
      return task;
    });
  });

  handle(IPC.tasksSaveCopy, async (_e, id: unknown): Promise<SaveResult | null> => {
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
  const popup = <A>(items: MenuItem<A>[]) =>
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
  const skillMenu = () =>
    popup<SkillMenuAction>([
      { label: t("menu.rename"), action: "rename" },
      { label: t("menu.reveal"), action: "reveal" },
      { label: t("menu.exportZip"), action: "export" },
      "separator",
      { label: t("menu.delete"), action: "delete" },
    ]);
  handle(IPC.tasksMenu, (_e, id: unknown) => {
    const task = taskOf(id);
    const log = store.getSettings().debug && debug.hasTask(task.id);
    return popup(taskMenuItems(task, !runner.isRunning(task.id), t, log));
  });
  handle(IPC.tasksRename, (_e, id: unknown, title: unknown) =>
    runner.rename(text(id, "id", 100), text(title, "title", 200)),
  );
  handle(IPC.tasksReveal, async (_e, id: unknown) => {
    const error = await shell.openPath(taskOf(id).workdir);
    if (error) throw new Error(error);
  });
  // The window asks the user before it calls remove.
  handle(IPC.tasksRemove, async (_e, id: unknown) => {
    const taskId = taskOf(id).id;
    runner.remove(taskId);
    // Its log goes with it, whether debug is on or not. The task is gone either way, so a log that stays is reported.
    await debug.removeTask(taskId).catch((err: unknown) => console.error(`Couldn't delete the log of ${taskId}`, err));
  });

  const projectOf = (id: unknown) => {
    const project = store.getProject(text(id, "id", 100));
    if (!project) throw new Error("That project doesn't exist");
    return project;
  };
  handle(IPC.projectsMenu, (_e, id: unknown) => {
    projectOf(id);
    return popup<ProjectMenuAction>([
      { label: t("menu.rename"), action: "rename" },
      { label: t("menu.editDescription"), action: "describe" },
      { label: t("menu.editInstructions"), action: "instructions" },
      { label: t("menu.reveal"), action: "reveal" },
      "separator",
      { label: t("menu.removeProject"), action: "remove" },
    ]);
  });
  handle(IPC.projectsUpdate, (_e, id: unknown, patch: unknown) => {
    const project = projectOf(id);
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new Error("patch must be an object");
    const input = patch as Record<string, unknown>;
    const next = { ...project };
    for (const key of Object.keys(input)) {
      if (key === "name") {
        next.name = text(input.name, "name", 200).trim();
        if (!next.name) throw new Error("A project needs a name");
      } else if (key === "description")
        next.description = oneLine(text(input.description, "description", DESCRIPTION_MAX));
      else if (key === "instructions") next.instructions = text(input.instructions, "instructions");
      else throw new Error(`Unknown project field: ${key}`);
    }
    store.saveProject(next);
    return next;
  });
  handle(IPC.projectsReveal, async (_e, id: unknown) => {
    const error = await shell.openPath(projectOf(id).folder);
    if (error) throw new Error(error);
  });
  handle(IPC.projectsRemovalText, (_e, id: unknown) => {
    const project = projectOf(id);
    const lang = store.getSettings().language ?? languageFrom(app.getLocale());
    return removalText(lang, project.name, store.projectUsage(project.id));
  });
  // The window asks the user, with the text above, before it calls remove.
  handle(IPC.projectsRemove, async (_e, id: unknown) => {
    const project = projectOf(id);
    // Working tasks end first: a run still ending would save its task back after the project is gone. Only the
    // app's records go. The folder is never touched.
    await runner.stopProject(project.id);
    const taskIds = store.listProjectTasks(project.id).map((task) => task.id);
    try {
      jobs.removeProject(project.id);
    } catch (err) {
      runner.projectStays(project.id);
      throw err;
    }
    // The tasks' logs go with the tasks.
    for (const taskId of taskIds)
      await debug
        .removeTask(taskId)
        .catch((err: unknown) => console.error(`Couldn't delete the log of ${taskId}`, err));
  });

  // The debug logs. They are read only from this computer's own window, and copying puts them on its clipboard.
  handle(IPC.debugTaskLog, (_e, id: unknown) => debug.readTask(taskOf(id).id));
  handle(IPC.debugRevealTaskLog, (_e, id: unknown) => {
    const taskId = taskOf(id).id;
    if (!debug.hasTask(taskId)) throw new Error("This task has no log yet");
    shell.showItemInFolder(debug.taskFile(taskId));
  });
  handle(IPC.debugCopyTaskLog, async (_e, id: unknown) => {
    const log = await debug.taskText(taskOf(id).id);
    if (log === null) throw new Error("This task has no log yet");
    clipboard.writeText(log);
  });
  handle(IPC.debugRevealAppLog, async () => shell.showItemInFolder(await debug.touchApp()));

  // Skills. Ids are folder names, which SkillFolder checks; the text fields have the format's limits.
  const skillId = (id: unknown) => text(id, "id", 200);
  const draft = (value: unknown) => {
    const d = (value ?? {}) as Record<string, unknown>;
    const title = text(d.title, "title", 200).trim();
    if (!title) throw new Error("A skill needs a name");
    return { title, description: text(d.description, "description", 1024), steps: text(d.steps, "steps", BRIEF_MAX) };
  };
  handle(IPC.jobsList, () => jobs.list());
  handle(IPC.jobsCreate, (_e, draft: unknown) => jobs.create(jobDraft(draft)));
  handle(IPC.jobsUpdate, (_e, id: unknown, draft: unknown) => jobs.update(text(id, "id", 100), jobDraft(draft)));
  handle(IPC.jobsSetOn, (_e, id: unknown, on: unknown) => {
    if (typeof on !== "boolean") throw new Error("on must be true or false");
    return jobs.setOn(text(id, "id", 100), on);
  });
  handle(IPC.jobsSkipOnce, (_e, id: unknown) => jobs.skipOnce(text(id, "id", 100)));
  handle(IPC.jobsRemove, (_e, id: unknown) => jobs.remove(text(id, "id", 100)));
  handle(IPC.jobsRunNow, (_e, id: unknown) => jobs.runNow(text(id, "id", 100)));

  handle(IPC.skillsList, async () => [...(await skills.list()), ...(await skills.builtIns(guideInLanguage))]);
  handle(IPC.skillsCreate, (_e, title: unknown) => {
    const name = text(title, "title", 200).trim();
    if (!name) throw new Error("A skill needs a name");
    return skills.create(name);
  });
  handle(IPC.skillsSave, (_e, id: unknown, value: unknown, note: unknown) =>
    skills.save(skillId(id), draft(value), note == null ? "" : text(note, "note", 200)),
  );
  handle(IPC.skillsDuplicate, (_e, id: unknown) =>
    skills.duplicate(skillId(id), (title) => t("skills.copyOf", { title }), guideInLanguage),
  );
  handle(IPC.skillsImport, async (_e, dropped: unknown) => {
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
  handle(IPC.skillsHistory, (_e, id: unknown) => skills.history(skillId(id)));
  handle(IPC.skillsRestore, (_e, id: unknown, n: unknown) => {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new Error("That version isn't kept any more");
    return skills.restore(skillId(id), n);
  });
  handle(IPC.skillsAddFiles, async (_e, id: unknown) => {
    const result = await openDialog({ title: t("skills.addFiles"), properties: ["openFile", "multiSelections"] });
    const skill = skillId(id);
    return skills.addFiles(skill, result.canceled ? [] : result.filePaths);
  });
  handle(IPC.skillsReveal, async (_e, id: unknown) => {
    const error = await shell.openPath(await skills.folderOf(skillId(id)));
    if (error) throw new Error(error);
  });
  handle(IPC.skillsRemove, (_e, id: unknown) => skills.remove(skillId(id)));
  handle(IPC.skillsExport, async (_e, id: unknown) => {
    // Built before the dialog, so a skill that is gone or too big fails before the user picks a place.
    const { name, data } = await skills.zip(skillId(id));
    const options = { title: t("menu.exportZip"), defaultPath: join(app.getPath("downloads"), `${name}.zip`) };
    const win = window();
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return;
    // Written beside it first and then moved over it, so a write that fails leaves a zip that was there untouched.
    const part = `${filePath}.${randomUUID()}.part`;
    try {
      await writeFile(part, data);
      await rename(part, filePath);
    } catch (err) {
      await rm(part, { force: true });
      throw err;
    }
    shell.showItemInFolder(filePath);
  });
  handle(IPC.skillsMenu, (_e, id: unknown) => {
    skillId(id);
    return skillMenu();
  });

  handle(IPC.filesPick, async () => {
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
  handle(IPC.filesRead, async (_e, taskId: unknown, path: unknown) => {
    try {
      const real = await fileOf(taskId, path);
      return { ...describe(real), bytes: new Uint8Array(await readFile(real)) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  });
  handle(IPC.filesOpen, async (_e, taskId: unknown, path: unknown) => {
    const error = await shell.openPath(await fileOf(taskId, path, false));
    if (error) throw new Error(error);
  });
  handle(IPC.filesReveal, async (_e, taskId: unknown, path: unknown) =>
    shell.showItemInFolder(await fileOf(taskId, path, false)),
  );
  handle(IPC.filesRestore, (_e, taskId: unknown, path: unknown) =>
    runner.restore(text(taskId, "taskId", 100), absolutePath(path, "path")),
  );
}
