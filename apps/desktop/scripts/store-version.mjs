// Prints the Microsoft Store version for a Tost Work version, or for package.json's when none is given.
//   node scripts/store-version.mjs            1.0.30 for 0.0.30-dev
//   node scripts/store-version.mjs 0.1.2-alpha   1.0.102
// The Store needs a first number above 0 and adds a fourth number of 0 itself, so a version a.b.c becomes
// 1.a.(b × 100 + c): 0.1.0 is 1.0.100, 1.0.0 is 1.1.0. It only grows, as the Store requires, while the minor and the
// patch stay under 100.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function storeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[a-z]+)?$/.exec(version);
  if (!match) throw new Error(`Not a Tost Work version: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 99 || patch > 99)
    throw new Error(`${version} doesn't fit the Store's numbering: minor and patch stay under 100`);
  return `1.${major}.${minor * 100 + patch}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
  console.log(storeVersion(process.argv[2] ?? pkg.version));
}
