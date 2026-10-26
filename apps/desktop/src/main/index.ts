import { join } from "node:path";
import { createFunnel } from "cli-funnel";
import { app, BrowserWindow, nativeTheme, shell } from "electron";
import { IPC } from "../shared/api";
import { languageFrom } from "../shared/i18n";
import type { AgentProvider } from "../shared/model";
import { Accounts } from "./accounts";
import { documentTools } from "./documents";
import { AgentEngine } from "./engine/agent";
import type { Engine } from "./engine/engine";
import { FakeEngine } from "./engine/fake";
import { TaskRunner } from "./engine/runner";
import { fileGuard } from "./guard";
import { registerIpc } from "./ipc";
import { applyLook } from "./look";
import { ToolServer } from "./mcp/server";
import { pickAi } from "./pickAi";
import { Store } from "./store/store";

const isMac = process.platform === "darwin";

// macOS shows these in Tost Work > About, so a build can be told apart from another of the same version.
app.setAboutPanelOptions({ applicationVersion: __APP_VERSION__, version: __APP_BUILD__ });
let mainWindow: BrowserWindow | null = null;

function createWindow(store: Store): BrowserWindow {
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
  // A load resets the zoom, so the text size goes back on after each one.
  win.webContents.on("did-finish-load", () => applyLook(win, store.getSettings()));
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
  // Before the window, so its background colour already follows the chosen theme.
  applyLook(null, store.getSettings());
  const funnel = createFunnel();
  const language = () => store.getSettings().language ?? languageFrom(app.getLocale());

  // Tasks run on Codex or Claude Code. TOST_WORK_ENGINE=fake replays a script instead, for trying the interface without an account.
  let engine: Engine;
  let tools: ToolServer | null = null;
  if (process.env.TOST_WORK_ENGINE === "fake") {
    engine = new FakeEngine(undefined, undefined, join(app.getAppPath(), "resources", "fake"));
  } else {
    const agent = new AgentEngine(
      funnel,
      language,
      documentTools(),
      () => {
        const { name, work, notes } = store.getSettings();
        return { name, work, notes };
      },
      () =>
        pickAi(
          store.getSettings().defaultAi,
          // A failed check is unknown (null), not signed out.
          (provider) =>
            funnel.authStatus(provider).then(
              (status) => status.loggedIn,
              () => null,
            ),
        ),
    );
    tools = new ToolServer(agent);
    await tools.start();
    agent.attachTools(tools);
    engine = agent;
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
  // One sign-in per agent CLI. Their progress goes to the window tagged with the CLI it belongs to.
  const accountsFor = (provider: AgentProvider) =>
    new Accounts(
      {
        detect: () => funnel.providers[provider].detect(),
        authStatus: () => funnel.authStatus(provider),
        login: () => funnel.login(provider),
        logout: () => funnel.logout(provider),
      },
      (event) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(IPC.accountSignInEvent, provider, event);
      },
      (url) => shell.openExternal(url),
    );
  const accounts = { codex: accountsFor("codex"), claude: accountsFor("claude") };
  registerIpc(store, runner, accounts, () => mainWindow);
  app.on("before-quit", () => {
    accounts.codex.cancel();
    accounts.claude.cancel();
    void tools?.stop();
    funnel.close();
    store.close();
  });
  mainWindow = createWindow(store);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(store);
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
