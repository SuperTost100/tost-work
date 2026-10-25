import { contextBridge } from "electron";
import type { TostWorkApi } from "../shared/api";

const api: TostWorkApi = {
  platform: process.platform as TostWorkApi["platform"],
  versions: { app: process.env.npm_package_version ?? "0.0.1", electron: process.versions.electron ?? "" },
};

contextBridge.exposeInMainWorld("tostWork", api);
