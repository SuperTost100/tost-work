import { contextBridge, ipcRenderer } from "electron";
import { IPC, type TostWorkApi } from "../shared/api";
import type { Task } from "../shared/model";

const api: TostWorkApi = {
  platform: process.platform as TostWorkApi["platform"],
  versions: { app: process.env.npm_package_version ?? "0.0.1", electron: process.versions.electron ?? "" },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    create: (input) => ipcRenderer.invoke(IPC.projectsCreate, input),
    pickFolder: () => ipcRenderer.invoke(IPC.projectsPickFolder),
  },
  tasks: {
    list: () => ipcRenderer.invoke(IPC.tasksList),
    get: (id) => ipcRenderer.invoke(IPC.tasksGet, id),
    start: (input) => ipcRenderer.invoke(IPC.tasksStart, input),
    answer: (id, answer) => ipcRenderer.invoke(IPC.tasksAnswer, id, answer),
    stop: (id) => ipcRenderer.invoke(IPC.tasksStop, id),
    onChange: (listener) => {
      const handler = (_: unknown, task: Task) => listener(task);
      ipcRenderer.on(IPC.taskChanged, handler);
      return () => ipcRenderer.removeListener(IPC.taskChanged, handler);
    },
  },
};

contextBridge.exposeInMainWorld("tostWork", api);
