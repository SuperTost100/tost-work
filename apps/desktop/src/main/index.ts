import { join } from "node:path";
import { createFunnel } from "cli-funnel";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, safeStorage, shell } from "electron";
import { IPC, type MenuState } from "../shared/api";
import { languageFrom, translate } from "../shared/i18n";
import type { AgentProvider } from "../shared/model";
import { Accounts } from "./accounts";
import { menuTemplate, nextTextSize } from "./appMenu";
import { documentTools } from "./documents";
import { AgentEngine } from "./engine/agent";
import type { Engine } from "./engine/engine";
import { FakeEngine } from "./engine/fake";
import { TaskRunner } from "./engine/runner";
import { fileGuard } from "./guard";
import { findInstalledCodex, Installer } from "./installer";
import { registerIpc } from "./ipc";
import { KeyStore } from "./keys";
import { applyLook } from "./look";
import { ToolServer } from "./mcp/server";
import { pickAi } from "./pickAi";
import { SkillFolder } from "./skills";
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
  // Codex's Windows installer puts it where cli-funnel doesn't look, so it's pointed there before anything runs.
  findInstalledCodex();
  const store = new Store(join(app.getPath("userData"), "tost-work.db"));
  const keys = new KeyStore(join(app.getPath("userData"), "course-key.json"), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (data) => safeStorage.decryptString(data),
  });
  // Where people can see, back up and copy their skills, as the course teaches.
  const skills = new SkillFolder(join(app.getPath("documents"), "Tost Work", "Skills"), (path) =>
    shell.trashItem(path),
  );
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
    const agent = new AgentEngine(funnel, language, {
      documents: documentTools(),
      user: () => {
        const { name, work, notes } = store.getSettings();
        return { name, work, notes };
      },
      ai: () =>
        pickAi(
          store.getSettings().defaultAi,
          // A failed check is unknown (null), not signed out.
          (provider) =>
            funnel.authStatus(provider).then(
              (status) => status.loggedIn,
              () => null,
            ),
          keys.info() !== null,
        ),
      courseKey: () => keys.get(),
      online: () => net.isOnline(),
      skills: () => skills.list(),
    });
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
  // The menu bar speaks the interface's language and follows the settings, so it's rebuilt when they change.
  let taskState: MenuState = { task: false, running: false };
  const refreshMenu = () => {
    const settings = store.getSettings();
    const lang = language();
    const menu = menuTemplate({
      t: (key) => translate(lang, key),
      isMac,
      settings,
      task: taskState,
      dev: !app.isPackaged,
      send: (action) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.menuAction, action);
      },
      textSize: (step) => {
        const current = store.getSettings();
        const next = { ...current, textSize: nextTextSize(current.textSize, step) };
        store.saveSettings(next);
        applyLook(mainWindow, next);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.settingsChanged, next);
      },
      // Only a Mac's About panel shows the build, so Windows and Linux get a small dialog with both.
      about: () => {
        if (isMac) return app.showAboutPanel();
        const options = {
          type: "info" as const,
          title: translate(lang, "appMenu.about"),
          message: "Tost Work",
          detail: translate(lang, "about.version", { version: __APP_VERSION__, build: __APP_BUILD__ }),
        };
        void (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options));
      },
      openSite: () => void shell.openExternal("https://tost.one"),
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  };
  refreshMenu();
  // The window says when a task opens, closes or stops working; anything but two booleans is ignored.
  ipcMain.on(IPC.menuState, (_e, state: unknown) => {
    const s = state as Partial<MenuState> | null;
    if (typeof s?.task !== "boolean" || typeof s.running !== "boolean") return;
    if (s.task === taskState.task && s.running === taskState.running) return;
    taskState = { task: s.task, running: s.running };
    refreshMenu();
  });
  registerIpc(
    store,
    runner,
    accounts,
    keys,
    new Installer(),
    () => mainWindow,
    (settings) => {
      applyLook(mainWindow, settings);
      refreshMenu();
    },
    skills,
  );
  // Quitting stops the tasks still working, so it asks first. They show as interrupted, with Resume, next time.
  let quitting = false;
  app.on("before-quit", (event) => {
    const working = runner.workingCount();
    if (!quitting && working > 0) {
      const lang = language();
      const options = {
        type: "question" as const,
        buttons: [translate(lang, "quit.quit"), translate(lang, "quit.cancel")],
        defaultId: 1,
        cancelId: 1,
        message:
          working === 1 ? translate(lang, "quit.title") : translate(lang, "quit.titleMany", { n: String(working) }),
        detail: translate(lang, "quit.detail"),
      };
      const choice =
        mainWindow && !mainWindow.isDestroyed()
          ? dialog.showMessageBoxSync(mainWindow, options)
          : dialog.showMessageBoxSync(options);
      if (choice !== 0) {
        event.preventDefault();
        return;
      }
    }
    quitting = true;
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
