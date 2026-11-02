/// <reference lib="dom" />
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { JobChange, MenuAction, SignInEvent } from "../shared/api";
import { IPC, type TostWorkApi } from "../shared/api";
import type { AgentProvider, Settings, Task } from "../shared/model";

// In full screen macOS hides the traffic lights, so the page drops the space it keeps for them.
ipcRenderer.on(IPC.fullScreen, (_: unknown, on: boolean) => {
  document.documentElement.toggleAttribute("data-full-screen", on === true);
});

const api: TostWorkApi = {
  platform: process.platform as TostWorkApi["platform"],
  versions: { app: __APP_VERSION__, electron: process.versions.electron ?? "" },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    onChange: (listener) => {
      const handler = (_: unknown, settings: Settings) => listener(settings);
      ipcRenderer.on(IPC.settingsChanged, handler);
      return () => ipcRenderer.removeListener(IPC.settingsChanged, handler);
    },
  },
  onMenu: (listener) => {
    // An action the panel asked for while this window was still loading waits in the main process, as a task does.
    let listening = true;
    const handler = (_: unknown, action: MenuAction) => listener(action);
    ipcRenderer.on(IPC.menuAction, handler);
    void ipcRenderer.invoke(IPC.takePendingMenu).then((action: unknown) => {
      if (typeof action === "string" && listening) listener(action as MenuAction);
    });
    return () => {
      listening = false;
      ipcRenderer.removeListener(IPC.menuAction, handler);
    };
  },
  panel: {
    open: (target) => ipcRenderer.send(IPC.panelOpen, target),
    quit: () => ipcRenderer.send(IPC.panelQuit),
    fit: (height) => ipcRenderer.send(IPC.panelFit, height),
  },
  menuState: (state) => ipcRenderer.send(IPC.menuState, state),
  onOpenTask: (listener) => {
    // A click that came while the window was still loading waits in the main process. It's older than any click
    // that arrives here, so a newer one wins, and nothing is delivered after unsubscribing.
    let newer = false;
    let listening = true;
    const handler = (_: unknown, taskId: unknown) => {
      if (typeof taskId !== "string") return;
      newer = true;
      listener(taskId);
    };
    ipcRenderer.on(IPC.openTask, handler);
    void ipcRenderer.invoke(IPC.takePendingTask).then((taskId: unknown) => {
      if (typeof taskId === "string" && !newer && listening) listener(taskId);
    });
    return () => {
      listening = false;
      ipcRenderer.removeListener(IPC.openTask, handler);
    };
  },
  account: {
    status: (provider) => ipcRenderer.invoke(IPC.accountStatus, provider),
    signIn: (provider) => ipcRenderer.invoke(IPC.accountSignIn, provider),
    sendCode: (provider, code) => ipcRenderer.invoke(IPC.accountSendCode, provider, code),
    cancel: (provider) => ipcRenderer.invoke(IPC.accountCancel, provider),
    signOut: (provider) => ipcRenderer.invoke(IPC.accountSignOut, provider),
    install: (provider) => ipcRenderer.invoke(IPC.accountInstall, provider),
    onSignIn: (listener) => {
      const handler = (_: unknown, provider: AgentProvider, event: SignInEvent) => listener(provider, event);
      ipcRenderer.on(IPC.accountSignInEvent, handler);
      return () => ipcRenderer.removeListener(IPC.accountSignInEvent, handler);
    },
  },
  models: {
    choices: () => ipcRenderer.invoke(IPC.modelsChoices),
  },
  key: {
    info: () => ipcRenderer.invoke(IPC.keyInfo),
    save: (key) => ipcRenderer.invoke(IPC.keySave, key),
    remove: () => ipcRenderer.invoke(IPC.keyRemove),
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    create: (input) => ipcRenderer.invoke(IPC.projectsCreate, input),
    overviews: () => ipcRenderer.invoke(IPC.projectsOverviews),
    pickFolder: (defaultPath) => ipcRenderer.invoke(IPC.projectsPickFolder, defaultPath),
    menu: (id) => ipcRenderer.invoke(IPC.projectsMenu, id),
    update: (id, patch) => ipcRenderer.invoke(IPC.projectsUpdate, id, patch),
    reveal: (id) => ipcRenderer.invoke(IPC.projectsReveal, id),
    removalText: (id) => ipcRenderer.invoke(IPC.projectsRemovalText, id),
    remove: (id) => ipcRenderer.invoke(IPC.projectsRemove, id),
  },
  tasks: {
    list: () => ipcRenderer.invoke(IPC.tasksList),
    listActive: () => ipcRenderer.invoke(IPC.tasksListActive),
    listForProject: (projectId) => ipcRenderer.invoke(IPC.tasksListForProject, projectId),
    listAll: () => ipcRenderer.invoke(IPC.tasksListAll),
    search: (query) => ipcRenderer.invoke(IPC.tasksSearch, query),
    get: (id) => ipcRenderer.invoke(IPC.tasksGet, id),
    start: (input) => ipcRenderer.invoke(IPC.tasksStart, input),
    saveForLater: (input) => ipcRenderer.invoke(IPC.tasksSaveForLater, input),
    startSaved: (id, pick) => ipcRenderer.invoke(IPC.tasksStartSaved, id, pick),
    updateDraft: (id, input) => ipcRenderer.invoke(IPC.tasksUpdateDraft, id, input),
    markReviewed: (id) => ipcRenderer.invoke(IPC.tasksMarkReviewed, id),
    markUnreviewed: (id) => ipcRenderer.invoke(IPC.tasksMarkUnreviewed, id),
    answer: (id, answers, attachments) => ipcRenderer.invoke(IPC.tasksAnswer, id, answers, attachments),
    stop: (id) => ipcRenderer.invoke(IPC.tasksStop, id),
    resume: (id) => ipcRenderer.invoke(IPC.tasksResume, id),
    decide: (id, allow) => ipcRenderer.invoke(IPC.tasksDecide, id, allow),
    followUp: (id, text, attachments) => ipcRenderer.invoke(IPC.tasksFollowUp, id, text, attachments),
    saveCopy: (id) => ipcRenderer.invoke(IPC.tasksSaveCopy, id),
    menu: (id) => ipcRenderer.invoke(IPC.tasksMenu, id),
    rename: (id, title) => ipcRenderer.invoke(IPC.tasksRename, id, title),
    reveal: (id) => ipcRenderer.invoke(IPC.tasksReveal, id),
    remove: (id) => ipcRenderer.invoke(IPC.tasksRemove, id),
    onChange: (listener) => {
      const handler = (_: unknown, task: Task) => listener(task);
      ipcRenderer.on(IPC.taskChanged, handler);
      return () => ipcRenderer.removeListener(IPC.taskChanged, handler);
    },
    draft: (id) => ipcRenderer.invoke(IPC.tasksDraft, id),
    onText: (listener) => {
      const handler = (_: unknown, taskId: string, text: string, restart?: boolean) =>
        listener(taskId, text, restart === true);
      ipcRenderer.on(IPC.taskText, handler);
      return () => ipcRenderer.removeListener(IPC.taskText, handler);
    },
  },
  files: {
    pick: () => ipcRenderer.invoke(IPC.filesPick),
    read: (taskId, path) => ipcRenderer.invoke(IPC.filesRead, taskId, path),
    open: (taskId, path) => ipcRenderer.invoke(IPC.filesOpen, taskId, path),
    reveal: (taskId, path) => ipcRenderer.invoke(IPC.filesReveal, taskId, path),
    restore: (taskId, path) => ipcRenderer.invoke(IPC.filesRestore, taskId, path),
  },
  debug: {
    taskLog: (id) => ipcRenderer.invoke(IPC.debugTaskLog, id),
    revealTaskLog: (id) => ipcRenderer.invoke(IPC.debugRevealTaskLog, id),
    copyTaskLog: (id) => ipcRenderer.invoke(IPC.debugCopyTaskLog, id),
    revealAppLog: () => ipcRenderer.invoke(IPC.debugRevealAppLog),
  },
  jobs: {
    list: () => ipcRenderer.invoke(IPC.jobsList),
    create: (draft) => ipcRenderer.invoke(IPC.jobsCreate, draft),
    update: (id, draft) => ipcRenderer.invoke(IPC.jobsUpdate, id, draft),
    setOn: (id, on) => ipcRenderer.invoke(IPC.jobsSetOn, id, on),
    skipOnce: (id) => ipcRenderer.invoke(IPC.jobsSkipOnce, id),
    remove: (id) => ipcRenderer.invoke(IPC.jobsRemove, id),
    runNow: (id) => ipcRenderer.invoke(IPC.jobsRunNow, id),
    onChange: (listener) => {
      const handler = (_: unknown, change: JobChange) => listener(change);
      ipcRenderer.on(IPC.jobChanged, handler);
      return () => ipcRenderer.removeListener(IPC.jobChanged, handler);
    },
  },
  skills: {
    list: () => ipcRenderer.invoke(IPC.skillsList),
    create: (title) => ipcRenderer.invoke(IPC.skillsCreate, title),
    save: (id, draft, note) => ipcRenderer.invoke(IPC.skillsSave, id, draft, note),
    duplicate: (id) => ipcRenderer.invoke(IPC.skillsDuplicate, id),
    // Only the preload can tell where a dropped file is on disk.
    import: (dropped) => ipcRenderer.invoke(IPC.skillsImport, dropped ? webUtils.getPathForFile(dropped) : undefined),
    history: (id) => ipcRenderer.invoke(IPC.skillsHistory, id),
    restore: (id, n) => ipcRenderer.invoke(IPC.skillsRestore, id, n),
    addFiles: (id) => ipcRenderer.invoke(IPC.skillsAddFiles, id),
    reveal: (id) => ipcRenderer.invoke(IPC.skillsReveal, id),
    remove: (id) => ipcRenderer.invoke(IPC.skillsRemove, id),
    exportZip: (id) => ipcRenderer.invoke(IPC.skillsExport, id),
    menu: (id) => ipcRenderer.invoke(IPC.skillsMenu, id),
  },
};

contextBridge.exposeInMainWorld("tostWork", api);
