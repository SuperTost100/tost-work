import JSZip from "jszip";
import type { AgentAccount } from "../shared/api";
import {
  type AgentProvider,
  type CourseKey,
  SECTION_LEVEL,
  type SectionKey,
  type Settings,
  sectionOn,
} from "../shared/model";
import type { LogFile } from "./debugLog";

/** What the info file is built from. Some of it holds names and addresses, which the file leaves out. */
export interface InfoInput {
  version: string;
  build: string;
  os: { platform: string; release: string; arch: string };
  electron: string;
  chrome: string;
  window: { width: number; height: number } | null;
  /** The language of the computer, used while the settings have none. */
  systemLanguage: string;
  settings: Settings;
  /** Each agent CLI as the app saw it, or null when it couldn't be checked. */
  accounts: Record<AgentProvider, AgentAccount | null>;
  key: CourseKey | null;
  at: string;
}

/**
 * The state the export reports: versions, window, and the settings that shape the screens. It names each field it
 * keeps, so what the user typed (name, work, notes) and who is signed in (account, plan, key ending) can't get in.
 */
export function buildInfo(i: InfoInput) {
  const { settings } = i;
  const cli = (provider: AgentProvider) => {
    const account = i.accounts[provider];
    return account ? { installed: account.installed, version: account.version ?? null } : null;
  };
  const pick = settings.modelPick;
  return {
    exportedAt: i.at,
    app: { version: i.version, build: i.build },
    os: { platform: i.os.platform, release: i.os.release, arch: i.os.arch },
    electron: i.electron,
    chrome: i.chrome,
    window: i.window ? { width: i.window.width, height: i.window.height } : null,
    language: settings.language,
    systemLanguage: i.systemLanguage,
    level: settings.level,
    sections: Object.fromEntries(
      (Object.keys(SECTION_LEVEL) as SectionKey[]).map((key) => [key, sectionOn(settings, key)]),
    ),
    theme: settings.theme,
    textSize: settings.textSize,
    debug: settings.debug,
    defaultAi: settings.defaultAi,
    modelPick: "preset" in pick ? { preset: pick.preset } : { ai: pick.ai, model: pick.model, effort: pick.effort },
    ais: [
      { ai: "chatgpt", kind: "subscription", connected: i.accounts.codex?.loggedIn ?? null },
      { ai: "claude", kind: "subscription", connected: i.accounts.claude?.loggedIn ?? null },
      { ai: "key", kind: "api-key", connected: i.key !== null, ...(i.key ? { vendor: i.key.vendor } : {}) },
    ],
    clis: { codex: cli("codex"), claude: cli("claude") },
  };
}

const two = (n: number) => String(n).padStart(2, "0");

/** The zip's default name, with the computer's local time: tost-work-logs-0.0.21-20261102-1530.zip. */
export function logsZipName(version: string, at: Date): string {
  const day = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  return `tost-work-logs-${version}-${day}-${two(at.getHours())}${two(at.getMinutes())}.zip`;
}

/** The zip: the log files under their names, and info.json. */
export function logsZip(files: LogFile[], info: unknown): Promise<Buffer> {
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.data, { createFolders: false });
  zip.file("info.json", `${JSON.stringify(info, null, 2)}\n`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** The promise's result, or null if it fails or takes longer than `ms`. */
export async function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(resolve, ms, null);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
