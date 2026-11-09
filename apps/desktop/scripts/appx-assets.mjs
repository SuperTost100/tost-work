// Draws the Microsoft Store package's tiles and logos into build/appx from the app icon's "T" mark, the way
// build/icon.svg draws it. Run it again after changing the icon: node scripts/appx-assets.mjs (needs Playwright's
// Chromium: pnpm exec playwright-core install chromium, or point CHROMIUM at a Chrome or Chromium binary).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "build", "appx");
mkdirSync(out, { recursive: true });

const INK = "#1b1712";
const PAPER = "#faf8f4";
// The T from Logo.tsx, in its 64-unit box.
const T = `<path d="M14 17h36v6H35v26h-6V23H14z" fill="${PAPER}"/>`;

/** A tile: the T on the app's dark background, edge to edge, since Windows draws the tile's own shape. */
const tile = (w, h, mark) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="${INK}"/>
    <g transform="translate(${(w - mark) / 2} ${(h - mark) / 2}) scale(${mark / 64})">${T}</g>
  </svg>`;

/** A logo: the rounded dark square of the app icon, on a transparent background, for the taskbar and the Store. */
const logo = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect x="2" y="2" width="60" height="60" rx="13.5" fill="${INK}"/>${T}
  </svg>`;

const files = {
  "StoreLogo.png": logo(50),
  "Square44x44Logo.png": logo(44),
  "Square150x150Logo.png": tile(150, 150, 96),
  "Wide310x150Logo.png": tile(310, 150, 96),
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage();
for (const [name, svg] of Object.entries(files)) {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg);
  await page.setViewportSize({ width: Number(w), height: Number(h) });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
  await page.screenshot({ path: join(out, name), omitBackground: true });
  console.log(`${name} ${w}x${h}`);
}
await browser.close();
