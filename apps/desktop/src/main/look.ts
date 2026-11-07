import { type BrowserWindow, nativeTheme } from "electron";
import { type Settings, TEXT_ZOOM } from "../shared/model";

/**
 * Applies the theme and the text size. The theme goes to the whole app rather than to the page, so native
 * dialogs, menus and the window background follow it too.
 */
export function applyLook(win: BrowserWindow | null, settings: Pick<Settings, "theme" | "textSize">): void {
  nativeTheme.themeSource = settings.theme;
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(TEXT_ZOOM[settings.textSize]);
}
