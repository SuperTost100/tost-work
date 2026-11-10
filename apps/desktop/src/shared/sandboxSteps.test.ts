import { describe, expect, it } from "vitest";
import type { Distro, SandboxMissing, SandboxReadiness } from "./sandbox";
import { APPARMOR_COMMAND, distroLabel, packageManagerFor, sandboxSteps } from "./sandboxSteps";

const distro = (id: string, like: string[] = [], name = id, version = ""): Distro => ({ id, like, name, version });
const readiness = (missing: SandboxMissing[], over: Partial<SandboxReadiness> = {}): SandboxReadiness => ({
  ready: missing.length === 0,
  missing,
  distro: distro("ubuntu", ["debian"], "Ubuntu", "24.04"),
  appArmorRestrictsUserns: null,
  ...over,
});

describe("packageManagerFor", () => {
  it.each([
    ["debian", [], "apt"],
    ["ubuntu", ["debian"], "apt"],
    ["linuxmint", ["ubuntu", "debian"], "apt"],
    ["pop", ["ubuntu", "debian"], "apt"],
    ["fedora", [], "dnf"],
    ["rocky", ["rhel", "centos", "fedora"], "dnf"],
    ["amzn", ["fedora"], "dnf"],
    ["arch", [], "pacman"],
    ["manjaro", ["arch"], "pacman"],
    ["endeavouros", ["arch"], "pacman"],
    ["opensuse-leap", ["suse", "opensuse"], "zypper"],
    ["opensuse-tumbleweed", [], "zypper"],
    ["sles", ["suse"], "zypper"],
    ["alpine", [], "apk"],
    ["Ubuntu", [], "apt"],
  ] as const)("%s %j uses %s", (id, like, manager) => {
    expect(packageManagerFor(distro(id, [...like]))).toBe(manager);
  });

  it("has no manager for a distribution it doesn't know, or when /etc/os-release couldn't be read", () => {
    expect(packageManagerFor(distro("nixos"))).toBeNull();
    expect(packageManagerFor(distro("void", ["xbps"]))).toBeNull();
    expect(packageManagerFor(null)).toBeNull();
  });
});

describe("sandboxSteps", () => {
  it("has nothing to do when the sandbox is ready", () => {
    expect(sandboxSteps(readiness([]))).toEqual([]);
  });

  it.each([
    ["debian", ["debian"], "sudo apt install bubblewrap socat"],
    ["fedora", [], "sudo dnf install bubblewrap socat"],
    ["manjaro", ["arch"], "sudo pacman -S bubblewrap socat"],
    ["opensuse-leap", ["suse", "opensuse"], "sudo zypper install bubblewrap socat"],
    ["alpine", [], "sudo apk add bubblewrap socat"],
  ])("installs with the manager of %s", (id, like, command) => {
    expect(sandboxSteps(readiness(["bwrap", "socat"], { distro: distro(id, like) }))).toEqual([
      { kind: "install", packages: ["bubblewrap", "socat"], command },
    ]);
  });

  it("lists only the packages that are missing", () => {
    expect(sandboxSteps(readiness(["socat"]))).toEqual([
      { kind: "install", packages: ["socat"], command: "sudo apt install socat" },
    ]);
    expect(sandboxSteps(readiness(["bwrap"]))).toEqual([
      { kind: "install", packages: ["bubblewrap"], command: "sudo apt install bubblewrap" },
    ]);
  });

  it("names the packages without a command on a system it has no manager for", () => {
    expect(sandboxSteps(readiness(["bwrap", "socat"], { distro: distro("nixos") }))).toEqual([
      { kind: "install", packages: ["bubblewrap", "socat"], command: null },
    ]);
    expect(sandboxSteps(readiness(["socat"], { distro: null }))).toEqual([
      { kind: "install", packages: ["socat"], command: null },
    ]);
  });

  it("adds the AppArmor profile when user namespaces are blocked and AppArmor restricts them", () => {
    expect(sandboxSteps(readiness(["userns"], { appArmorRestrictsUserns: true }))).toEqual([
      { kind: "apparmor", command: APPARMOR_COMMAND, distro: "Ubuntu 24.04" },
    ]);
    expect(APPARMOR_COMMAND).toContain("/etc/apparmor.d/bwrap");
    expect(APPARMOR_COMMAND.endsWith("sudo systemctl reload apparmor")).toBe(true);
  });

  it("puts the install before the AppArmor profile when both are needed", () => {
    const steps = sandboxSteps(readiness(["bwrap", "socat", "userns"], { appArmorRestrictsUserns: true }));
    expect(steps.map((s) => s.kind)).toEqual(["install", "apparmor"]);
  });

  it("shows bubblewrap's own message, with no command, when AppArmor isn't the cause", () => {
    const detail = "bwrap: No permissions to create new namespace";
    for (const apparmor of [false, null]) {
      expect(sandboxSteps(readiness(["userns"], { appArmorRestrictsUserns: apparmor, detail }))).toEqual([
        { kind: "userns", detail },
      ]);
    }
    expect(sandboxSteps(readiness(["userns"], { appArmorRestrictsUserns: false }))).toEqual([
      { kind: "userns", detail: null },
    ]);
  });

  it("names a rolling release by its name alone, and an unknown system by nothing", () => {
    expect(distroLabel(distro("arch", [], "Arch Linux", ""))).toBe("Arch Linux");
    expect(distroLabel(null)).toBeNull();
    expect(sandboxSteps(readiness(["userns"], { appArmorRestrictsUserns: true, distro: null }))).toEqual([
      { kind: "apparmor", command: APPARMOR_COMMAND, distro: null },
    ]);
  });
});
