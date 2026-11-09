import type { AgentProvider } from "./model";

/**
 * Whether Claude Code runs its commands without a sandbox on this system. Claude Code has no sandbox on native
 * Windows, so there Tost Work starts it without one and the window warns the user. Mac and Linux keep the sandbox, and
 * a task fails there rather than run unconfined.
 */
export const claudeUnconfined = (platform: string): boolean => platform === "win32";

/**
 * Whether a run on `provider` has to wait for the user's OK: Claude runs unconfined here and the user hasn't yet
 * pressed Continue on the notice that says so (`Settings.unconfinedAcknowledged`).
 */
export const needsUnconfinedOk = (provider: AgentProvider, platform: string, acknowledged: boolean): boolean =>
  provider === "claude" && claudeUnconfined(platform) && !acknowledged;

/** Whether a task on `provider` asks its CLI for a sandbox on `platform`. */
export const sandboxFor = (provider: AgentProvider, platform: string): boolean =>
  !(provider === "claude" && claudeUnconfined(platform));

/**
 * What a Linux sandbox lacks:
 * - `bwrap`: bubblewrap isn't on the PATH. Both CLIs use it (Codex falls back to a copy it bundles, but on Ubuntu that
 *   copy is blocked the same way, so the fix is the same).
 * - `socat`: not on the PATH. Only Claude Code needs it, for its network proxy.
 * - `userns`: bubblewrap is there but can't create a user namespace. On Ubuntu 24.04 and later that's AppArmor's
 *   restriction, which an AppArmor profile for bwrap lifts.
 */
export type SandboxMissing = "bwrap" | "socat" | "userns";

/** Which AIs need each thing, so a notice can say that socat matters only for Claude. */
export const SANDBOX_NEEDS: Record<SandboxMissing, AgentProvider[]> = {
  bwrap: ["codex", "claude"],
  socat: ["claude"],
  userns: ["codex", "claude"],
};

/** The Linux distribution, from /etc/os-release, for the notice. */
export interface Distro {
  /** ID, such as "ubuntu" or "fedora". */
  id: string;
  /** ID_LIKE, such as ["debian"] on Ubuntu: the family whose commands apply. */
  like: string[];
  /** NAME, such as "Ubuntu". */
  name: string;
  /** VERSION_ID, such as "24.04". Empty on a rolling release. */
  version: string;
}

/** Whether a task can start its sandbox, and what to fix when it can't. Always ready on Mac and Windows. */
export interface SandboxReadiness {
  ready: boolean;
  /** Empty when ready. */
  missing: SandboxMissing[];
  /** Null off Linux, or when /etc/os-release can't be read. */
  distro: Distro | null;
  /**
   * Whether the kernel has Ubuntu's AppArmor restriction on user namespaces on
   * (`kernel.apparmor_restrict_unprivileged_userns = 1`), so the notice can show the AppArmor fix for `userns`. Null
   * when the setting isn't there.
   */
  appArmorRestrictsUserns: boolean | null;
  /** What bubblewrap printed when it couldn't start, for the debug log. */
  detail?: string;
}
