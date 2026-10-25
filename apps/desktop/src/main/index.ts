import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, shell } from "electron";
import { IPC } from "../shared/api";
import { FakeEngine } from "./engine/fake";
import { TaskRunner } from "./engine/runner";
import { registerIpc } from "./ipc";
import { Store } from "./store/store";

const isMac = process.platform === "darwin";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "Tost Work",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#22201D" : "#FAF8F4",
    // On Mac the traffic lights sit inside the sidebar, as in the mockup.
    // shortcut: Windows and Linux keep the system frame, switch to titleBarOverlay when we style those builds.
    ...(isMac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 16 } } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  return win;
}

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  const store = new Store(join(app.getPath("userData"), "tost-work.db"));
  store.stopInterrupted(new Date().toISOString());
  // shortcut: every task runs on the fake engine until the cli-funnel engine lands (cli-funnel #126 to #128).
  const runner = new TaskRunner(store, new FakeEngine(), (task) => mainWindow?.webContents.send(IPC.taskChanged, task));
  registerIpc(store, runner, () => mainWindow);
  app.on("before-quit", () => store.close());
  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
