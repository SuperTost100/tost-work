import { type BrowserWindow, nativeTheme } from "electron";
import type { Settings, TextSize } from "../shared/model";

/** The window zoom for each text size. The styles use pixel sizes, so zoom is what scales them all. */
export const ZOOM: Record<TextSize, number> = { small: 0.9, normal: 1, large: 1.15 };

/**
 * Applies the theme and the text size. The theme goes to the whole app rather than to the page, so native
 * dialogs, menus and the window background follow it too.
 */
export function applyLook(win: BrowserWindow | null, settings: Pick<Settings, "theme" | "textSize">): void {
  nativeTheme.themeSource = settings.theme;
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(ZOOM[settings.textSize]);
}
