import { join } from "node:path";
import { createFunnel } from "cli-funnel";
import { app, BrowserWindow, nativeTheme, shell } from "electron";
import { IPC } from "../shared/api";
import { languageFrom } from "../shared/i18n";
import { Accounts } from "./accounts";
import { documentTools } from "./documents";
import { CodexEngine } from "./engine/codex";
import type { Engine } from "./engine/engine";
import { FakeEngine } from "./engine/fake";
import { TaskRunner } from "./engine/runner";
import { fileGuard } from "./guard";
import { registerIpc } from "./ipc";
import { ToolServer } from "./mcp/server";
import { Store } from "./store/store";

const isMac = process.platform === "darwin";

// macOS shows these in Tost Work > About, so a build can be told apart from another of the same version.
app.setAboutPanelOptions({ applicationVersion: __APP_VERSION__, version: __APP_BUILD__ });
let mainWindow: BrowserWindow | null = null;

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
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

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

app.whenReady().then(async () => {
  const store = new Store(join(app.getPath("userData"), "tost-work.db"));
  store.stopInterrupted(new Date().toISOString());
  const funnel = createFunnel();
  const language = () => store.getSettings().language ?? languageFrom(app.getLocale());

  // Tasks run on Codex. TOST_WORK_ENGINE=fake replays a script instead, for trying the interface without an account.
  let engine: Engine;
  let tools: ToolServer | null = null;
  if (process.env.TOST_WORK_ENGINE === "fake") {
    engine = new FakeEngine(undefined, undefined, join(app.getAppPath(), "resources", "fake"));
  } else {
    const codex = new CodexEngine(funnel, language, documentTools(), () => store.getSettings().name);
    tools = new ToolServer(codex);
    await tools.start();
    codex.attachTools(tools);
    engine = codex;
  }

  // shortcut: kept copies are never cleaned up; add a size limit or an age limit before the public beta.
  const guard = fileGuard(join(app.getPath("userData"), "kept"), (path) => shell.trashItem(path));
  const runner = new TaskRunner(
    store,
    engine,
    (task) => {
      // On Mac the app outlives its window, so a task can change after the window is gone.
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.taskChanged, task);
    },
    undefined,
    guard,
  );
  const accounts = new Accounts(
    {
      detect: () => funnel.providers.codex.detect(),
      authStatus: () => funnel.authStatus("codex"),
      login: () => funnel.login("codex"),
    },
    (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.accountSignInEvent, event);
    },
    (url) => shell.openExternal(url),
  );
  registerIpc(store, runner, accounts, () => mainWindow);
  app.on("before-quit", () => {
    accounts.cancel();
    void tools?.stop();
    funnel.close();
    store.close();
  });
  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
