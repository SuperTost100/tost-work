import { contextBridge, ipcRenderer } from "electron";
import type { MenuAction, SignInEvent } from "../shared/api";
import { IPC, type TostWorkApi } from "../shared/api";
import type { AgentProvider, Settings, Task } from "../shared/model";

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
    const handler = (_: unknown, action: MenuAction) => listener(action);
    ipcRenderer.on(IPC.menuAction, handler);
    return () => ipcRenderer.removeListener(IPC.menuAction, handler);
  },
  menuState: (state) => ipcRenderer.send(IPC.menuState, state),
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
  key: {
    info: () => ipcRenderer.invoke(IPC.keyInfo),
    save: (key) => ipcRenderer.invoke(IPC.keySave, key),
    remove: () => ipcRenderer.invoke(IPC.keyRemove),
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    create: (input) => ipcRenderer.invoke(IPC.projectsCreate, input),
    taskCounts: () => ipcRenderer.invoke(IPC.projectsTaskCounts),
    pickFolder: () => ipcRenderer.invoke(IPC.projectsPickFolder),
  },
  tasks: {
    list: () => ipcRenderer.invoke(IPC.tasksList),
    listForProject: (projectId) => ipcRenderer.invoke(IPC.tasksListForProject, projectId),
    get: (id) => ipcRenderer.invoke(IPC.tasksGet, id),
    start: (input) => ipcRenderer.invoke(IPC.tasksStart, input),
    answer: (id, answer) => ipcRenderer.invoke(IPC.tasksAnswer, id, answer),
    stop: (id) => ipcRenderer.invoke(IPC.tasksStop, id),
    resume: (id) => ipcRenderer.invoke(IPC.tasksResume, id),
    decide: (id, allow) => ipcRenderer.invoke(IPC.tasksDecide, id, allow),
    followUp: (id, text) => ipcRenderer.invoke(IPC.tasksFollowUp, id, text),
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
  },
  files: {
    pick: () => ipcRenderer.invoke(IPC.filesPick),
    read: (taskId, path) => ipcRenderer.invoke(IPC.filesRead, taskId, path),
    open: (taskId, path) => ipcRenderer.invoke(IPC.filesOpen, taskId, path),
    reveal: (taskId, path) => ipcRenderer.invoke(IPC.filesReveal, taskId, path),
    restore: (taskId, path) => ipcRenderer.invoke(IPC.filesRestore, taskId, path),
  },
  skills: {
    list: () => ipcRenderer.invoke(IPC.skillsList),
    create: (title) => ipcRenderer.invoke(IPC.skillsCreate, title),
    save: (id, draft) => ipcRenderer.invoke(IPC.skillsSave, id, draft),
    addFiles: (id) => ipcRenderer.invoke(IPC.skillsAddFiles, id),
    reveal: (id) => ipcRenderer.invoke(IPC.skillsReveal, id),
    remove: (id) => ipcRenderer.invoke(IPC.skillsRemove, id),
  },
};

contextBridge.exposeInMainWorld("tostWork", api);
