import type { AgentProvider } from "./model";

/**
 * The vendors' official installers, one line each. They install for the user alone, without admin rights or Node,
 * check the download's SHA-256 before using it, and leave the CLI where its own `update` command works.
 */
export const INSTALLERS: Record<AgentProvider, { unix: string; windows: string }> = {
  claude: {
    unix: "curl -fsSL https://claude.ai/install.sh | bash",
    windows: "irm https://claude.ai/install.ps1 | iex",
  },
  codex: {
    unix: "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh",
    windows: "$env:CODEX_NON_INTERACTIVE='1'; irm https://chatgpt.com/codex/install.ps1 | iex",
  },
};

/** The installer line for this computer, as the user would type it in a terminal. */
export const installLine = (provider: AgentProvider, platform: string): string =>
  platform === "win32" ? INSTALLERS[provider].windows : INSTALLERS[provider].unix;

/** How an install went. A failure names its likely cause, so the interface can say what to do in plain words. */
export type InstallResult = { ok: true } | { ok: false; reason: "offline" | "space" | "failed"; detail: string };
