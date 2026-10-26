/** Whether the app runs on a Mac, where shortcuts use ⌘ rather than Ctrl. */
export const onMac = (): boolean => typeof window !== "undefined" && window.tostWork?.platform === "darwin";

/** A shortcut as the platform writes it: ⌘N on a Mac, Ctrl+N elsewhere. */
export const shortcut = (key: string, mac = onMac()): string =>
  mac ? `⌘${key === "Enter" ? "↩" : key}` : `Ctrl+${key}`;

/** A tooltip with the shortcut after the label, as menus show it. */
export const withShortcut = (label: string, key: string, mac = onMac()): string => `${label} (${shortcut(key, mac)})`;
