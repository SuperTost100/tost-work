import { homedir } from "node:os";
import { join } from "node:path";
import { createFunnel } from "cli-funnel";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  safeStorage,
  screen,
  shell,
  Tray,
} from "electron";
import { IPC, type MenuAction, type MenuState } from "../shared/api";
import { languageFrom, translate } from "../shared/i18n";
import type { AgentProvider } from "../shared/model";
import { Accounts } from "./accounts";
import { giveAgentsOwnHomes } from "./agentHomes";
import { menuTemplate, nextTextSize } from "./appMenu";
import { documentTools } from "./documents";
import { AgentEngine } from "./engine/agent";
import type { Engine } from "./engine/engine";
import { FakeEngine } from "./engine/fake";
import { TaskRunner } from "./engine/runner";
import { fileGuard } from "./guard";
import { findInstalledCodex, Installer } from "./installer";
import { registerIpc } from "./ipc";
import { Jobs } from "./jobs";
import { KeyStore } from "./keys";
import { AT_LOGIN, setOpenAtLogin } from "./loginItem";
import { applyLook } from "./look";
import { ToolServer } from "./mcp/server";
import { confirmsNotifications, Notifier } from "./notify";
import { pickAi } from "./pickAi";
import { SkillFolder } from "./skills";
import { SkillVersions } from "./skillVersions";
import { Store } from "./store/store";
import { opensWindow, panelBounds, staysInMenuBar, trayMenu } from "./tray";
import { buttonsPosition } from "./windowButtons";

const isMac = process.platform === "darwin";

// macOS shows these in Tost Work > About, so a build can be told apart from another of the same version.
app.setAboutPanelOptions({ applicationVersion: __APP_VERSION__, version: __APP_BUILD__ });
let mainWindow: BrowserWindow | null = null;
// The menu-bar panel, once the icon has been clicked. Hidden rather than closed between clicks.
let panel: BrowserWindow | null = null;

/** Sends to the main window and the menu-bar panel, whichever exist, so both keep their lists current. */
function toWindows(channel: string, ...args: unknown[]): void {
  for (const win of [mainWindow, panel]) if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}
// Whether closing the window leaves Tost Work running in the menu bar. Set once the settings are loaded.
let staysOpen = () => false;
// What happens once the main window is closed. The menu-bar panel is a window too, hidden but never closed, so
// Electron's "all windows closed" never comes once it exists: the main window's own close decides.
let mainClosed = () => {};

const PRELOAD = () => join(import.meta.dirname, "../preload/index.cjs");

/** Loads the interface in a window; the menu-bar panel is the same page, told apart by its hash. */
function loadPage(win: BrowserWindow, hash?: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(hash ? `${devUrl}#${hash}` : devUrl);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"), hash ? { hash } : undefined);
}

/** The panel the menu-bar icon opens: no frame, over other windows, gone as soon as the user clicks elsewhere. */
function createPanel(width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // A Mac gives it the frosted look of other menu-bar panels; elsewhere it's the app's own background.
    ...(isMac
      ? { transparent: true, vibrancy: "popover" as const, visualEffectState: "active" as const }
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? "#22201D" : "#FAF8F4" }),
    webPreferences: { preload: PRELOAD(), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Without skipping it, this turns the whole app into a menu-bar app and back, which hides it for a moment: the first
  // click on the icon, with the window open, left the app without its menu and deaf to clicks until the Dock icon
  // was clicked. shortcut: with the window open, the panel may not show over another app in full screen; switch to
  // `type: "panel"` if that turns out to matter.
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  loadPage(win, "panel");
  return win;
}

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
    // On Mac the traffic lights sit inside the sidebar, as in the mockup, centred on the rail when it's collapsed.
    // shortcut: Windows and Linux keep the system frame, switch to titleBarOverlay when we style those builds.
    ...(isMac
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: buttonsPosition(process.getSystemVersion()) }
      : {}),
    webPreferences: {
      preload: PRELOAD(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  // A load resets the zoom, so the text size goes back on after each one.
  win.webContents.on("did-finish-load", () => {
    applyLook(win, store.getSettings());
    win.webContents.send(IPC.fullScreen, win.isFullScreen());
  });
  win.on("enter-full-screen", () => win.webContents.send(IPC.fullScreen, true));
  win.on("leave-full-screen", () => win.webContents.send(IPC.fullScreen, false));
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    mainClosed();
  });

  // Links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  loadPage(win);
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
  // The Word, Excel, PowerPoint and PDF guides show among them as built in; earlier versions stay in the app's data.
  const documents = documentTools();
  const skills = new SkillFolder(
    join(app.getPath("documents"), "Tost Work", "Skills"),
    (path) => shell.trashItem(path),
    { builtIns: documents?.skills, versions: new SkillVersions(join(app.getPath("userData"), "skill-versions")) },
  );
  store.stopInterrupted(new Date().toISOString());
  // Before the window, so its background colour already follows the chosen theme.
  applyLook(null, store.getSettings());
  // Codex and Claude Code read only what Tost Work gives them, not the user's own setup.
  if (process.env.TOST_WORK_ENGINE !== "fake") giveAgentsOwnHomes(join(app.getPath("userData"), "agents"));
  const funnel = createFunnel();
  const language = () => store.getSettings().language ?? languageFrom(app.getLocale());

  // Tasks run on Codex or Claude Code. TOST_WORK_ENGINE=fake replays a script instead, for trying the interface without an account.
  let engine: Engine;
  let tools: ToolServer | null = null;
  if (process.env.TOST_WORK_ENGINE === "fake") {
    engine = new FakeEngine(undefined, undefined, join(app.getAppPath(), "resources", "fake"));
  } else {
    const agent = new AgentEngine(funnel, language, {
      documents,
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
      job: (id) => store.getJob(id),
    });
    tools = new ToolServer(agent);
    await tools.start();
    agent.attachTools(tools);
    engine = agent;
  }

  // Brings the window back, making it again if it was closed; with a task, the window opens it, as a notification
  // click asks. A window that's still loading isn't listening yet, so the task waits here until the window asks.
  let pendingTask: string | null = null;
  ipcMain.handle(IPC.takePendingTask, () => {
    const id = pendingTask;
    pendingTask = null;
    return id;
  });
  const showWindow = (taskId?: string) => {
    if (isMac) void app.dock?.show();
    let win = mainWindow;
    if (!win || win.isDestroyed()) win = mainWindow = createWindow(store);
    if (taskId && win.webContents.isLoading()) pendingTask = taskId;
    else if (taskId) win.webContents.send(IPC.openTask, taskId);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  const showTask = (taskId: string) => showWindow(taskId);
  // An action for the window, such as New task from the panel. A window still loading asks for it once it listens.
  // A page that has loaded may still not be listening: only once it asks for the waiting action is it.
  let pendingMenu: MenuAction | null = null;
  const listening = new WeakSet<Electron.WebContents>();
  ipcMain.handle(IPC.takePendingMenu, (e) => {
    listening.add(e.sender);
    const action = pendingMenu;
    pendingMenu = null;
    return action;
  });
  const showWindowWith = (action: MenuAction) => {
    showWindow();
    const win = mainWindow;
    if (!win) return;
    if (listening.has(win.webContents)) win.webContents.send(IPC.menuAction, action);
    else pendingMenu = action;
  };
  // Held until clicked or closed: a notification that's collected forgets its click.
  const shown = new Set<Notification>();
  const notifier = new Notifier(
    () => store.getSettings(),
    () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()),
    (n) => {
      if (!Notification.isSupported()) return;
      const note = new Notification({
        title: n.title,
        body: translate(language(), `notify.${n.kind}`),
        silent: n.silent,
      });
      shown.add(note);
      note.on("click", () => {
        shown.delete(note);
        showTask(n.taskId);
      });
      note.on("close", () => shown.delete(note));
      note.show();
    },
  );
  notifier.know(store.listTasks(500));
  let notifyBefore = store.getSettings();
  const confirmNotifications = (settings: typeof notifyBefore) => {
    const confirm = confirmsNotifications(notifyBefore, settings);
    notifyBefore = settings;
    if (!confirm || !Notification.isSupported()) return;
    const lang = language();
    const note = new Notification({
      title: translate(lang, "notify.onTitle"),
      body: translate(lang, "notify.onBody"),
      silent: true,
    });
    shown.add(note);
    note.on("click", () => shown.delete(note));
    note.on("close", () => shown.delete(note));
    note.show();
  };
  // Starting at login, set again at each start so it follows the app if it moved. Only an installed app does it:
  // a development run would register Electron itself.
  const loginDeps = {
    platform: process.platform,
    setLoginItemSettings: (s: { openAtLogin: boolean; args?: string[] }) => app.setLoginItemSettings(s),
    autostartDir: join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "autostart"),
    exec: process.env.APPIMAGE ?? process.execPath,
  };
  let atLogin = store.getSettings().openAtLogin;
  // One change at a time, so turning it on then off quickly can't end with the entry written after its removal.
  let loginQueue: Promise<void> = Promise.resolve();
  const applyLogin = (on: boolean) => {
    if (!app.isPackaged) return;
    loginQueue = loginQueue
      .then(() => setOpenAtLogin(on, loginDeps))
      .catch((err: unknown) => console.error("Couldn't change starting at login", err));
  };
  // Off as well as on, so a removal that failed last time is tried again.
  applyLogin(atLogin);

  // shortcut: kept copies are never cleaned up; add a size limit or an age limit before the public beta.
  const guard = fileGuard(join(app.getPath("userData"), "kept"), (path) => shell.trashItem(path));
  const runner = new TaskRunner(
    store,
    engine,
    (task) => {
      // On Mac the app outlives its window, so a task can change after the window is gone.
      toWindows(IPC.taskChanged, task);
      notifier.changed(task);
      trayChanged();
    },
    undefined,
    guard,
    (taskId, text, restart) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.taskText, taskId, text, restart);
    },
  );
  // Set once the tray exists below; jobs and tasks changing before that have nothing to update.
  let trayChanged = () => {};
  // Jobs start their runs as tasks, like the ones the user starts, on the account new tasks use.
  const jobs = new Jobs({
    store,
    busy: (jobId) => store.jobBusy(jobId),
    start: async (job, at) => {
      const project = store.getProject(job.projectId);
      if (!project) throw new Error(translate(language(), "jobs.projectGone"));
      const { provider, auth, model, effort } = await runner.defaults();
      // The project may have been removed while the account was being read.
      if (!store.getProject(job.projectId)) throw new Error(translate(language(), "jobs.projectGone"));
      const day = new Intl.DateTimeFormat(language(), { day: "numeric", month: "short" }).format(at);
      const task = runner.create({
        projectId: project.id,
        brief: job.brief,
        workdir: project.folder,
        provider,
        auth,
        model,
        effort,
        jobId: job.id,
        title: `${job.title} · ${day}`,
      });
      runner.launch(task.id);
      return task.id;
    },
    changed: (change) => {
      toWindows(IPC.jobChanged, change);
      trayChanged();
    },
  });
  // Every half minute, and on waking up, when a missed run is due straight away.
  const lookAtJobs = () => void jobs.tick().catch((err: unknown) => console.error("Jobs couldn't run", err));
  setInterval(lookAtJobs, 30_000);
  powerMonitor.on("resume", lookAtJobs);
  powerMonitor.on("unlock-screen", lookAtJobs);
  lookAtJobs();

  // The menu-bar icon (the tray on Windows and Linux), there as long as Tost Work runs. A click opens the panel and a
  // right click the menu. Linux trays don't report clicks, so there the menu is all there is.
  staysOpen = () => staysInMenuBar(store.getSettings());
  const icon = nativeImage.createFromPath(
    join(app.getAppPath(), "resources", "tray", isMac ? "trayTemplate.png" : "tray.png"),
  );
  if (isMac) icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip("Tost Work");
  const PANEL_WIDTH = 340;
  let panelHeight = 420;
  // A click on the icon while the panel is open first takes the focus from it, which hides it: the click mustn't
  // then open it again.
  let panelHiddenAt = 0;
  const placePanel = () => {
    if (!panel || panel.isDestroyed()) return;
    const at = tray.getBounds();
    const area = screen.getDisplayNearestPoint({ x: at.x, y: at.y }).workArea;
    panel.setBounds(panelBounds(at, { width: PANEL_WIDTH, height: panelHeight }, area));
  };
  const hidePanel = () => {
    if (!panel || panel.isDestroyed() || !panel.isVisible()) return;
    panelHiddenAt = Date.now();
    panel.hide();
  };
  const togglePanel = () => {
    if (panel?.isVisible()) return hidePanel();
    if (Date.now() - panelHiddenAt < 250) return;
    if (!panel || panel.isDestroyed()) {
      const made = createPanel(PANEL_WIDTH, panelHeight);
      made.on("blur", hidePanel);
      made.on("closed", () => {
        if (panel === made) panel = null;
      });
      panel = made;
    }
    placePanel();
    // The theme may have changed since the panel was made; a Mac's panel is see-through and follows by itself.
    if (!isMac) panel.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#22201D" : "#FAF8F4");
    panel.show();
    panel.focus();
  };
  ipcMain.on(IPC.panelOpen, (_e, target: unknown) => {
    hidePanel();
    const t = typeof target === "object" && target !== null ? (target as Record<string, unknown>) : {};
    if (typeof t.taskId === "string" && t.taskId.length <= 100) showWindow(t.taskId);
    else if (t.action === "new-task" || t.action === "settings") showWindowWith(t.action);
    else showWindow();
  });
  ipcMain.on(IPC.panelQuit, () => app.quit());
  ipcMain.on(IPC.panelFit, (_e, height: unknown) => {
    if (typeof height !== "number" || !Number.isFinite(height)) return;
    panelHeight = Math.round(Math.min(Math.max(height, 120), 900));
    placePanel();
  });
  const menuNow = () => {
    const lang = language();
    return Menu.buildFromTemplate(
      trayMenu((key, vars) => translate(lang, key, vars), lang, jobs.list(), store.listActiveTasks(), new Date(), {
        open: () => showWindow(),
        openTask: (id) => showWindow(id),
        quit: () => app.quit(),
      }),
    );
  };
  if (process.platform === "linux") tray.on("click", () => showWindow());
  else {
    tray.on("click", togglePanel);
    tray.on("right-click", () => {
      hidePanel();
      tray.popUpContextMenu(menuNow());
    });
  }
  // Linux shows the menu it was given; the others build it when it's asked for, so it's always current.
  const updateTray = () => {
    if (process.platform === "linux") tray.setContextMenu(menuNow());
  };
  trayChanged = updateTray;
  updateTray();
  // The next job's time moves on by itself, so the menu is rebuilt every minute too.
  setInterval(updateTray, 60_000);

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
        toWindows(IPC.settingsChanged, next);
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
      trayChanged();
      confirmNotifications(settings);
      // The window that saved them has them; the panel hears, for its language and theme.
      if (panel && !panel.isDestroyed()) panel.webContents.send(IPC.settingsChanged, settings);
      if (settings.openAtLogin !== atLogin) {
        atLogin = settings.openAtLogin;
        applyLogin(atLogin);
      }
    },
    skills,
    jobs,
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
  // Started at login, Tost Work waits in the menu bar unless the user chose to have the window too. A Mac ignores the
  // login item's arguments, so it says itself whether this start came from the login.
  const startedAtLogin = process.argv.includes(AT_LOGIN) || (isMac && app.getLoginItemSettings().wasOpenedAtLogin);
  if (opensWindow(startedAtLogin, store.getSettings())) mainWindow = createWindow(store);
  else if (isMac) void app.dock?.hide();
  // Closing the window leaves Tost Work in the menu bar (the tray elsewhere), and a Mac drops its Dock icon until the
  // window comes back. Without that, Windows and Linux quit, and a Mac keeps the app in the Dock, as Mac apps do.
  mainClosed = () => {
    // Quitting closes the window too, after the store has closed: nothing is left to decide.
    if (quitting) return;
    if (staysOpen()) {
      if (isMac) void app.dock?.hide();
    } else if (!isMac) app.quit();
  };
  app.on("activate", () => {
    // The Dock icon brings the window back. Through showWindow, so a Mac that hid the Dock icon shows it again.
    if (!mainWindow || mainWindow.isDestroyed()) showWindow();
  });
});

// Listening is what stops Electron quitting by itself when the last window closes: the main window's close decides
// (see mainClosed), since the hidden panel would keep this from ever coming once it exists.
app.on("window-all-closed", () => {});
