import type { MenuItemConstructorOptions } from "electron";
import type { MenuAction, MenuState } from "../shared/api";
import type { MessageKey } from "../shared/i18n";
import { type Settings, sectionOn } from "../shared/model";

export interface MenuOptions {
  t: (key: MessageKey) => string;
  isMac: boolean;
  settings: Settings;
  /** Whether a task is open and working: the Task items act on it, so they're off without one. */
  task: MenuState;
  /** Hands an action to the window, which carries it out. */
  send: (action: MenuAction) => void;
  /** One step bigger or smaller, or back to normal: the menu's zoom is the Text size setting. */
  textSize: (step: -1 | 0 | 1) => void;
  about: () => void;
  openSite: () => void;
  /** Developer tools, only in a development build. */
  dev: boolean;
}

/**
 * The menu bar, in the interface's language. On a Mac the app menu holds About, Settings and Quit; Windows and Linux
 * put Settings and Quit in File and About in Help.
 */
export function menuTemplate(o: MenuOptions): MenuItemConstructorOptions[] {
  const { t, isMac } = o;
  const action = (a: MenuAction) => () => o.send(a);
  const settingsItem: MenuItemConstructorOptions = {
    label: t(isMac ? "appMenu.settingsMac" : "appMenu.settings"),
    accelerator: "CmdOrCtrl+,",
    click: action("settings"),
  };
  const about: MenuItemConstructorOptions = { label: t("appMenu.about"), click: o.about };

  const file: MenuItemConstructorOptions = {
    label: t("appMenu.file"),
    submenu: [
      { label: t("appMenu.newTask"), accelerator: "CmdOrCtrl+N", click: action("new-task") },
      { label: t("appMenu.newProject"), accelerator: "Shift+CmdOrCtrl+N", click: action("new-project") },
      {
        label: t("appMenu.quickEdit"),
        accelerator: "CmdOrCtrl+O",
        enabled: sectionOn(o.settings, "quickEdit"),
        click: action("quick-edit"),
      },
      { type: "separator" },
      ...(isMac
        ? [{ label: t("appMenu.close"), role: "close" } as const]
        : [settingsItem, { type: "separator" } as const, { label: t("appMenu.exit"), role: "quit" } as const]),
    ],
  };
  const edit: MenuItemConstructorOptions = {
    label: t("appMenu.edit"),
    submenu: [
      { label: t("appMenu.undo"), role: "undo" },
      { label: t("appMenu.redo"), role: "redo" },
      { type: "separator" },
      { label: t("appMenu.cut"), role: "cut" },
      { label: t("appMenu.copy"), role: "copy" },
      { label: t("appMenu.paste"), role: "paste" },
      { label: t("appMenu.selectAll"), role: "selectAll" },
    ],
  };
  const view: MenuItemConstructorOptions = {
    label: t("appMenu.view"),
    submenu: [
      { label: t("appMenu.textBigger"), accelerator: "CmdOrCtrl+Plus", click: () => o.textSize(1) },
      { label: t("appMenu.textSmaller"), accelerator: "CmdOrCtrl+-", click: () => o.textSize(-1) },
      { label: t("appMenu.textNormal"), accelerator: "CmdOrCtrl+0", click: () => o.textSize(0) },
      { type: "separator" },
      // No accelerator: Cmd+B has to reach the Skills editor to make text bold, so the window handles the key.
      { label: t(o.settings.sidebarHidden ? "nav.expand" : "nav.collapse"), click: action("toggle-sidebar") },
      { label: t("appMenu.fullScreen"), role: "togglefullscreen" },
      ...(o.dev ? [{ type: "separator" } as const, { role: "toggleDevTools" } as const] : []),
    ],
  };
  const task: MenuItemConstructorOptions = {
    label: t("appMenu.task"),
    submenu: [
      // Enter in the box already sends, so the shortcut only shows here.
      { label: t("appMenu.send"), accelerator: "CmdOrCtrl+Enter", registerAccelerator: false, click: action("send") },
      { label: t("appMenu.stop"), accelerator: "CmdOrCtrl+.", enabled: o.task.running, click: action("stop") },
      { type: "separator" },
      { label: t("menu.rename"), enabled: o.task.task, click: action("rename") },
      {
        label: t("menu.reveal"),
        accelerator: "Shift+CmdOrCtrl+R",
        enabled: o.task.task,
        click: action("reveal"),
      },
    ],
  };
  const window: MenuItemConstructorOptions = {
    label: t("appMenu.window"),
    submenu: [
      { label: t("appMenu.minimize"), role: "minimize" },
      ...(isMac
        ? [
            { label: t("appMenu.zoom"), role: "zoom" } as const,
            { type: "separator" } as const,
            { label: t("appMenu.front"), role: "front" } as const,
          ]
        : [{ label: t("appMenu.close"), role: "close" } as const]),
    ],
  };
  const help: MenuItemConstructorOptions = {
    label: t("appMenu.help"),
    role: "help",
    submenu: [{ label: "tost.one", click: o.openSite }, ...(isMac ? [] : [{ type: "separator" } as const, about])],
  };

  if (!isMac) return [file, edit, view, task, window, help];
  const appItems: MenuItemConstructorOptions = {
    label: "Tost Work",
    submenu: [
      about,
      { type: "separator" },
      settingsItem,
      { type: "separator" },
      { label: t("appMenu.services"), role: "services" },
      { type: "separator" },
      { label: t("appMenu.hide"), role: "hide" },
      { label: t("appMenu.hideOthers"), role: "hideOthers" },
      { label: t("appMenu.showAll"), role: "unhide" },
      { type: "separator" },
      { label: t("appMenu.quit"), role: "quit" },
    ],
  };
  return [appItems, file, edit, view, task, window, help];
}

/** The text size one step from `current`, or Normal for step 0. */
export function nextTextSize(current: Settings["textSize"], step: -1 | 0 | 1): Settings["textSize"] {
  if (step === 0) return "normal";
  const sizes = ["small", "normal", "large"] as const;
  const i = Math.min(2, Math.max(0, sizes.indexOf(current) + step));
  return sizes[i] ?? "normal";
}
