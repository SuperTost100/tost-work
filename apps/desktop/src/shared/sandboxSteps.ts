import type { SandboxReadiness } from "./sandbox";

/** The package managers the notice has a command for. */
export type PackageManager = "apt" | "dnf" | "pacman" | "zypper" | "apk";

/** The command that installs packages with each manager. */
const INSTALL: Record<PackageManager, string> = {
  apt: "sudo apt install",
  dnf: "sudo dnf install",
  pacman: "sudo pacman -S",
  zypper: "sudo zypper install",
  apk: "sudo apk add",
};

/**
 * Which manager each distribution uses, by its ID or by one of the IDs in its ID_LIKE (Ubuntu's is "debian", Rocky's
 * is "rhel centos fedora"). The openSUSE IDs are matched by their prefix, because Leap and Tumbleweed have their own.
 */
const FAMILY: Record<string, PackageManager> = {
  debian: "apt",
  ubuntu: "apt",
  fedora: "dnf",
  rhel: "dnf",
  centos: "dnf",
  arch: "pacman",
  suse: "zypper",
  opensuse: "zypper",
  sles: "zypper",
  alpine: "apk",
};

/** The package manager for a distribution, or null for one the notice has no command for. */
export function packageManagerFor(distro: SandboxReadiness["distro"]): PackageManager | null {
  if (!distro) return null;
  for (const id of [distro.id, ...distro.like]) {
    const key = id.toLowerCase();
    const found = FAMILY[key] ?? (key.startsWith("opensuse") ? "zypper" : undefined);
    if (found) return found;
  }
  return null;
}

/** AppArmor's profile for bubblewrap, which lets it create the user namespace Ubuntu 24.04 and later refuse it. */
export const APPARMOR_COMMAND = `sudo tee /etc/apparmor.d/bwrap >/dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>
profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
sudo systemctl reload apparmor`;

/** One thing for the user to do, in the order to do it. */
export type SandboxStep =
  /** Install packages. With no `command`, the system's package manager isn't one the notice knows. */
  | { kind: "install"; packages: string[]; command: string | null }
  /** Add the AppArmor profile. `distro` is the system's name and version, such as "Ubuntu 24.04", when it's known. */
  | { kind: "apparmor"; command: string; distro: string | null }
  /** The system won't let bubblewrap create user namespaces and AppArmor isn't why, so there's no command. */
  | { kind: "userns"; detail: string | null };

/** The distribution as "Ubuntu 24.04", or just its name on a rolling release, or null when it isn't known. */
export const distroLabel = (distro: SandboxReadiness["distro"]): string | null =>
  distro?.name ? [distro.name, distro.version].filter(Boolean).join(" ") : null;

/**
 * What to show a user whose sandbox can't start: the packages to install, with the command for their package manager,
 * and for a blocked user namespace either the AppArmor fix or, when AppArmor isn't the cause, what bubblewrap said.
 * Empty when the sandbox is ready.
 */
export function sandboxSteps(readiness: SandboxReadiness): SandboxStep[] {
  const steps: SandboxStep[] = [];
  const packages = [
    ...(readiness.missing.includes("bwrap") ? ["bubblewrap"] : []),
    ...(readiness.missing.includes("socat") ? ["socat"] : []),
  ];
  if (packages.length > 0) {
    const manager = packageManagerFor(readiness.distro);
    steps.push({
      kind: "install",
      packages,
      command: manager ? `${INSTALL[manager]} ${packages.join(" ")}` : null,
    });
  }
  if (readiness.missing.includes("userns")) {
    steps.push(
      readiness.appArmorRestrictsUserns === true
        ? { kind: "apparmor", command: APPARMOR_COMMAND, distro: distroLabel(readiness.distro) }
        : { kind: "userns", detail: readiness.detail?.trim() || null },
    );
  }
  return steps;
}
