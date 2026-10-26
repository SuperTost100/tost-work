// Downloads the pinned OfficeCLI release into resources/bin/<os>-<arch>, checks every file against the checksums
// below, and adds the license files Apache-2.0 asks to ship with it. The agent uses it to make and edit Word, Excel
// and PowerPoint files.
//
//   node scripts/fetch-officecli.mjs            the platform this machine runs on
//   node scripts/fetch-officecli.mjs mac-arm64 mac-x64
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.158";
const RELEASE = `https://github.com/iOfficeAI/OfficeCLI/releases/download/v${VERSION}`;
const SOURCE = `https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/v${VERSION}`;

/** Target (electron-builder's os and arch names) to release asset, file name and sha256. */
const BINARIES = {
  "mac-arm64": ["officecli-mac-arm64", "officecli", "67cf08d95fab556cad9d1e9d0d3b76a7962b5658c716aeaef2e83cbc19af7ff7"],
  "mac-x64": ["officecli-mac-x64", "officecli", "038716417adb626d5e94bc71dfecea2d2be9838f3d9b2eb49c2f0b3d634cf4f2"],
  "win-x64": [
    "officecli-win-x64.exe",
    "officecli.exe",
    "117545f3bc817d7c6d2e78a62e4f73f75b918ccd61558e404c60949a8cb9fd1f",
  ],
  "linux-x64": ["officecli-linux-x64", "officecli", "9ee41d5558caea7bcd5aab1b3e76b2bd70f0535f09cf65dda3668130510cc719"],
};
const NOTICES = {
  LICENSE: "7e282402a5a6db33995fe638bb3fe79013f9884d8f7d15a42e481c1e86aadda1",
  NOTICE: "3a4715b268e148a8e9566f5e835f766f5c95c3da4d6e5ddd908806a258a2f07b",
  "THIRD-PARTY-NOTICES.txt": "7e79e54cddf05f25681198429eb42e1401c1c53a3b29bf63744dc09411c029d8",
};

const here = dirname(fileURLToPath(import.meta.url));
const os = { darwin: "mac", win32: "win", linux: "linux" }[process.platform];
const targets = process.argv.slice(2).length ? process.argv.slice(2) : [`${os}-${process.arch}`];

async function fetchChecked(url, sha256) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== sha256) throw new Error(`${url}: sha256 ${got}, expected ${sha256}`);
  return bytes;
}

/** True when the file is already there with the right checksum, so a second run downloads nothing. */
async function present(path, sha256) {
  try {
    return (
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex") === sha256
    );
  } catch {
    return false;
  }
}

for (const target of targets) {
  const binary = BINARIES[target];
  if (!binary) throw new Error(`No OfficeCLI build for ${target}. Known: ${Object.keys(BINARIES).join(", ")}`);
  const [asset, name, sha256] = binary;
  const dir = join(here, "..", "resources", "bin", target);
  await mkdir(dir, { recursive: true });
  const files = [
    [`${RELEASE}/${asset}`, name, sha256],
    ...Object.entries(NOTICES).map(([f, s]) => [`${SOURCE}/${f}`, `officecli-${f}`, s]),
  ];
  for (const [url, file, sum] of files) {
    const path = join(dir, file);
    if (await present(path, sum)) continue;
    await writeFile(path, await fetchChecked(url, sum));
  }
  await chmod(join(dir, name), 0o755);
  console.log(`OfficeCLI ${VERSION} for ${target} is in ${dir}`);
}
