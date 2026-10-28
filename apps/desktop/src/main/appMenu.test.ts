/** @vitest-environment node */
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import type { MenuAction } from "../shared/api";
import { translate } from "../shared/i18n";
import { DEFAULT_SETTINGS } from "../shared/model";
import { menuTemplate, nextTextSize } from "./appMenu";

function build(isMac: boolean, settings = DEFAULT_SETTINGS, task = { task: true, running: true }) {
  const sent: MenuAction[] = [];
  const sizes: number[] = [];
  const menu = menuTemplate({
    t: (key) => translate("it", key),
    isMac,
    settings,
    task,
    dev: false,
    send: (a) => sent.push(a),
    textSize: (step) => sizes.push(step),
    about: () => {},
    openSite: () => {},
  });
  const items = (label: string) => (menu.find((m) => m.label === label)?.submenu ?? []) as MenuItemConstructorOptions[];
  const item = (menuLabel: string, label: string) => items(menuLabel).find((i) => i.label === label);
  const click = (menuLabel: string, label: string) => (item(menuLabel, label)?.click as (() => void) | undefined)?.();
  return { menu, sent, sizes, items, item, click };
}

describe("menuTemplate", () => {
  it("gives a Mac the app menu with Settings and Quit, in the interface's language", () => {
    const { menu, item } = build(true);
    expect(menu.map((m) => m.label)).toEqual([
      "Tost Work",
      "File",
      "Modifica",
      "Vista",
      "Attività",
      "Finestra",
      "Aiuto",
    ]);
    expect(item("Tost Work", "Impostazioni…")?.accelerator).toBe("CmdOrCtrl+,");
    expect(item("Tost Work", "Esci da Tost Work")?.role).toBe("quit");
    expect(item("Modifica", "Incolla")?.role).toBe("paste");
  });

  it("puts Settings and Exit in File, and About in Help, on Windows and Linux", () => {
    const { menu, item, items } = build(false);
    expect(menu[0]?.label).toBe("File");
    expect(item("File", "Impostazioni")?.accelerator).toBe("CmdOrCtrl+,");
    expect(item("File", "Esci")?.role).toBe("quit");
    expect(items("Aiuto").map((i) => i.label)).toContain("Informazioni su Tost Work");
  });

  it("hands its actions to the window, and its zoom to the text size", () => {
    const { sent, sizes, click, item } = build(true);
    click("File", "Nuova attività");
    click("File", "Nuovo progetto…");
    click("File", "Modifica veloce di un file…");
    click("Attività", "Interrompi");
    click("Attività", "Rinomina");
    click("Attività", "Mostra nella cartella");
    click("Attività", "Invia");
    click("Vista", "Testo più grande");
    click("Vista", "Testo normale");
    click("Vista", "Comprimi la barra laterale");
    expect(sent).toEqual([
      "new-task",
      "new-project",
      "quick-edit",
      "stop",
      "rename",
      "reveal",
      "send",
      "toggle-sidebar",
    ]);
    expect(sizes).toEqual([1, 0]);
    // Enter in the box already sends, so the menu shows the shortcut without taking it over.
    expect(item("Attività", "Invia")?.registerAccelerator).toBe(false);
  });

  it("offers the sidebar in View without a shortcut, so Cmd+B stays with the Skills editor", () => {
    expect(build(true).item("Vista", "Comprimi la barra laterale")?.accelerator).toBeUndefined();
    const hidden = build(true, { ...DEFAULT_SETTINGS, sidebarHidden: true });
    expect(hidden.item("Vista", "Espandi la barra laterale")?.accelerator).toBeUndefined();
    expect(hidden.item("Vista", "Comprimi la barra laterale")).toBeUndefined();
  });

  it("turns the Task items off without an open task, and Stop off when it isn't working", () => {
    const none = build(true, DEFAULT_SETTINGS, { task: false, running: false });
    expect(none.item("Attività", "Interrompi")?.enabled).toBe(false);
    expect(none.item("Attività", "Rinomina")?.enabled).toBe(false);
    expect(none.item("Attività", "Mostra nella cartella")?.enabled).toBe(false);
    // Send stays on: it sends what's in the box, on Home too.
    expect(none.item("Attività", "Invia")?.enabled).not.toBe(false);
    const done = build(true, DEFAULT_SETTINGS, { task: true, running: false });
    expect(done.item("Attività", "Interrompi")?.enabled).toBe(false);
    expect(done.item("Attività", "Rinomina")?.enabled).toBe(true);
  });

  it("turns Quick edit off in the menu when it's off in Settings", () => {
    const { item } = build(true, { ...DEFAULT_SETTINGS, sections: { quickEdit: false } });
    expect(item("File", "Modifica veloce di un file…")?.enabled).toBe(false);
  });
});

describe("nextTextSize", () => {
  it("steps through the sizes and stops at the ends", () => {
    expect(nextTextSize("normal", 1)).toBe("large");
    expect(nextTextSize("large", 1)).toBe("large");
    expect(nextTextSize("normal", -1)).toBe("small");
    expect(nextTextSize("small", -1)).toBe("small");
    expect(nextTextSize("large", 0)).toBe("normal");
  });
});
