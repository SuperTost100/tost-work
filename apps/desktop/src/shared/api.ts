/** What the preload exposes to the interface as `window.tostWork`. */
export interface TostWorkApi {
  platform: "darwin" | "win32" | "linux";
  versions: { app: string; electron: string };
}
