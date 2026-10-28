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
  shell,
  Tray,
} from "electron";
import { IPC, type MenuState } from "../shared/api";
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
import { staysInMenuBar, trayMenu } from "./tray";

const isMac = process.platform === "darwin";

// macOS shows these in Tost Work > About, so a build can be told apart from another of the same version.
app.setAboutPanelOptions({ applicationVersion: __APP_VERSION__, version: __APP_BUILD__ });
let mainWindow: BrowserWindow | null = null;
// Whether closing the last window leaves Tost Work running in the menu bar. Set once the jobs are loaded.
let staysOpen = () => false;

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
  win.webContents.on("did-finish-load", () => {
    applyLook(win, store.getSettings());
    win.webContents.send(IPC.fullScreen, win.isFullScreen());
  });
  win.on("enter-full-screen", () => win.webContents.send(IPC.fullScreen, true));
  win.on("leave-full-screen", () => win.webContents.send(IPC.fullScreen, false));
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
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.taskChanged, task);
      notifier.changed(task);
      trayChanged();
    },
    undefined,
    guard,
    (taskId, text) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.taskText, taskId, text);
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
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.jobChanged, change);
      trayChanged();
    },
  });
  // Every half minute, and on waking up, when a missed run is due straight away.
  const lookAtJobs = () => void jobs.tick().catch((err: unknown) => console.error("Jobs couldn't run", err));
  setInterval(lookAtJobs, 30_000);
  powerMonitor.on("resume", lookAtJobs);
  powerMonitor.on("unlock-screen", lookAtJobs);
  lookAtJobs();

  // The menu-bar icon (the tray on Windows and Linux), there only while Tost Work stays when its window closes.
  let tray: Tray | null = null;
  staysOpen = () => staysInMenuBar(store.getSettings(), jobs.list());
  const updateTray = () => {
    if (!staysOpen()) {
      tray?.destroy();
      tray = null;
      return;
    }
    if (!tray) {
      const icon = nativeImage.createFromPath(
        join(app.getAppPath(), "resources", "tray", isMac ? "trayTemplate.png" : "tray.png"),
      );
      if (isMac) icon.setTemplateImage(true);
      tray = new Tray(icon);
      tray.setToolTip("Tost Work");
      // On Windows and Linux a click opens the window; the menu is on the right click. A Mac shows the menu.
      if (!isMac) tray.on("click", () => showWindow());
    }
    const lang = language();
    const menu = trayMenu(
      (key, vars) => translate(lang, key, vars),
      lang,
      jobs.list(),
      store.listActiveTasks(),
      new Date(),
      { open: () => showWindow(), openTask: (id) => showWindow(id), quit: () => app.quit() },
    );
    tray.setContextMenu(Menu.buildFromTemplate(menu));
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
      trayChanged();
      confirmNotifications(settings);
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
  // Started at login with a job on, Tost Work waits in the menu bar; otherwise it opens its window as usual. A Mac
  // ignores the login item's arguments, so it says itself whether this start came from the login.
  const startedAtLogin = process.argv.includes(AT_LOGIN) || (isMac && app.getLoginItemSettings().wasOpenedAtLogin);
  if (startedAtLogin && staysOpen()) {
    if (isMac) void app.dock?.hide();
  } else mainWindow = createWindow(store);
  app.on("activate", () => {
    // Through showWindow, so a Mac that hid the Dock icon at login shows it again with the window.
    if (BrowserWindow.getAllWindows().length === 0) showWindow();
  });
});

// With a job on, Tost Work stays in the menu bar (the tray elsewhere), and a Mac drops its Dock icon until the window
// comes back. Otherwise Windows and Linux quit, and a Mac keeps the app in the Dock, as before.
app.on("window-all-closed", () => {
  if (staysOpen()) {
    if (isMac) void app.dock?.hide();
  } else if (!isMac) app.quit();
});
