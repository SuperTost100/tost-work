/** @vitest-environment node */
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeUnconfined, needsUnconfinedOk, sandboxFor } from "../shared/sandbox";
import { BWRAP_PROBE, checkSandbox, onPath, parseOsRelease, type SandboxSystem } from "./sandbox";

const UBUNTU = `PRETTY_NAME="Ubuntu 24.04.5 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.5 LTS (Noble Numbat)"
ID=ubuntu
ID_LIKE=debian
`;

/** A Linux system with the programs given on the PATH, where bubblewrap's run gives `probe`. */
function system(
  over: { programs?: string[]; probe?: { ok: boolean; output: string }; files?: Record<string, string> } = {},
) {
  const runs: { file: string; args: string[] }[] = [];
  const programs = over.programs ?? ["bwrap", "socat"];
  const files = over.files ?? {
    "/etc/os-release": UBUNTU,
    "/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1\n",
  };
  const fake: SandboxSystem = {
    platform: "linux",
    which: async (name) => (programs.includes(name) ? `/usr/bin/${name}` : null),
    run: async (file, args) => {
      runs.push({ file, args });
      return over.probe ?? { ok: true, output: "" };
    },
    read: async (path) => files[path] ?? null,
  };
  return { fake, runs };
}

describe("needsUnconfinedOk", () => {
  it("holds back only a Claude run on Windows before the user said yes", () => {
    expect(needsUnconfinedOk("claude", "win32", false)).toBe(true);
    expect(needsUnconfinedOk("claude", "win32", true)).toBe(false);
    expect(needsUnconfinedOk("codex", "win32", false)).toBe(false);
    for (const platform of ["darwin", "linux"]) expect(needsUnconfinedOk("claude", platform, false)).toBe(false);
  });
});

describe("claudeUnconfined", () => {
  it("is true only on Windows, and only Claude Code there goes without a sandbox", () => {
    expect(claudeUnconfined("win32")).toBe(true);
    expect(claudeUnconfined("darwin")).toBe(false);
    expect(claudeUnconfined("linux")).toBe(false);
    expect(sandboxFor("claude", "win32")).toBe(false);
    expect(sandboxFor("codex", "win32")).toBe(true);
    for (const platform of ["darwin", "linux"]) {
      expect(sandboxFor("claude", platform)).toBe(true);
      expect(sandboxFor("codex", platform)).toBe(true);
    }
  });
});

describe("parseOsRelease", () => {
  it("reads the distribution, quoted or not", () => {
    expect(parseOsRelease(UBUNTU)).toEqual({ id: "ubuntu", like: ["debian"], name: "Ubuntu", version: "24.04" });
    expect(parseOsRelease('NAME="Fedora Linux"\nID=fedora\nVERSION_ID=41\n')).toEqual({
      id: "fedora",
      like: [],
      name: "Fedora Linux",
      version: "41",
    });
    expect(parseOsRelease("NAME='Linux Mint'\nID=linuxmint\nID_LIKE=\"ubuntu debian\"\n# a comment\n")).toEqual({
      id: "linuxmint",
      like: ["ubuntu", "debian"],
      name: "Linux Mint",
      version: "",
    });
    expect(parseOsRelease("NAME=Arch\\ Linux\nID=arch")).toMatchObject({ id: "arch" });
    expect(parseOsRelease("")).toBeNull();
  });
});

describe("checkSandbox", () => {
  it("is ready on Mac and Windows without running anything", async () => {
    for (const platform of ["darwin", "win32"]) {
      const { fake, runs } = system();
      const read: string[] = [];
      const result = await checkSandbox("claude", {
        ...fake,
        platform,
        which: async (name) => {
          read.push(name);
          return null;
        },
      });
      expect(result).toEqual({ ready: true, missing: [], distro: null, appArmorRestrictsUserns: null });
      expect(runs).toEqual([]);
      expect(read).toEqual([]);
    }
  });

  it("is ready when bubblewrap starts and socat is there, and says which distribution it is", async () => {
    const { fake, runs } = system();
    expect(await checkSandbox("claude", fake)).toEqual({
      ready: true,
      missing: [],
      distro: { id: "ubuntu", like: ["debian"], name: "Ubuntu", version: "24.04" },
      appArmorRestrictsUserns: true,
    });
    expect(runs).toEqual([{ file: "/usr/bin/bwrap", args: BWRAP_PROBE }]);
  });

  it("asks for socat only for Claude Code", async () => {
    const { fake } = system({ programs: ["bwrap"] });
    expect(await checkSandbox("claude", fake)).toMatchObject({ ready: false, missing: ["socat"] });
    expect(await checkSandbox("codex", fake)).toMatchObject({ ready: true, missing: [] });
    expect(await checkSandbox(null, fake)).toMatchObject({ ready: false, missing: ["socat"] });
  });

  it("reports bubblewrap missing, and doesn't try to run it", async () => {
    const { fake, runs } = system({ programs: [] });
    expect(await checkSandbox("codex", fake)).toMatchObject({ ready: false, missing: ["bwrap"] });
    expect(await checkSandbox("claude", fake)).toMatchObject({ ready: false, missing: ["bwrap", "socat"] });
    expect(runs).toEqual([]);
  });

  it("reports bubblewrap blocked from user namespaces, with what it said", async () => {
    const { fake } = system({
      probe: { ok: false, output: "bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted" },
    });
    expect(await checkSandbox("codex", fake)).toEqual({
      ready: false,
      missing: ["userns"],
      distro: { id: "ubuntu", like: ["debian"], name: "Ubuntu", version: "24.04" },
      appArmorRestrictsUserns: true,
      detail: "bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted",
    });
  });

  it("checks again every time, so a fix made in a terminal counts", async () => {
    const programs: string[] = ["bwrap"];
    const { fake } = system({ programs });
    expect((await checkSandbox("claude", fake)).ready).toBe(false);
    programs.push("socat");
    expect((await checkSandbox("claude", fake)).ready).toBe(true);
  });

  it("reads the distribution from /usr/lib/os-release when /etc has none, and copes without either", async () => {
    const usrLib = system({ files: { "/usr/lib/os-release": "NAME=Fedora\nID=fedora\nVERSION_ID=41" } });
    expect(await checkSandbox("codex", usrLib.fake)).toMatchObject({
      distro: { id: "fedora", version: "41" },
      appArmorRestrictsUserns: null,
    });
    const none = system({ files: {} });
    expect(await checkSandbox("codex", none.fake)).toMatchObject({ ready: true, distro: null });
  });
});

describe("onPath", () => {
  it("finds an executable file on the PATH, and skips folders and files that don't run", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-path-"));
    const [a, b, c] = [join(root, "a"), join(root, "b"), join(root, "c")];
    await Promise.all([mkdir(a), mkdir(b), mkdir(c)]);
    await mkdir(join(a, "socat"));
    await writeFile(join(b, "socat"), "");
    await writeFile(join(c, "socat"), "#!/bin/sh\n");
    await chmod(join(c, "socat"), 0o755);
    expect(await onPath("socat", [a, b, c].join(delimiter))).toBe(join(c, "socat"));
    expect(await onPath("bwrap", [a, b, c].join(delimiter))).toBeNull();
    expect(await onPath("socat", "")).toBeNull();
  });
});
