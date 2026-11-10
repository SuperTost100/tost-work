// Prints the Figma plugin code that lays out one page of the screen map from a capture's manifest. An agent runs the
// printed code with the Figma MCP's use_figma tool, then uploads each PNG into the frame of the same index.
// Usage: node scripts/screen-map/figma-script.mjs <outdir> <light|dark> <version>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [OUT, THEME, VERSION] = process.argv.slice(2);
if (!OUT || (THEME !== "light" && THEME !== "dark") || !VERSION)
  throw new Error("usage: figma-script.mjs <outdir> <light|dark> <version>");
const NAMES = {
  setup: "Setup",
  task: "Home and a task",
  projects: "Projects",
  skills: "Skills",
  jobs: "Scheduled jobs",
  board: "Board",
  settings: "Settings",
  cards: "Cards",
  errors: "Tasks that can't start",
  linux: "Linux sandbox notice",
  install: "Installing an AI",
  windows: "Windows only",
};
// A line under a section's name, for frames that aren't the capture's own platform or that a script had to stage.
const NOTES = {
  errors:
    "Staged: the fake engine runs none of the checks, so each failure is saved as the real engine would leave it, with the app's own sentence. The last frame is a Linux state.",
  linux:
    "Linux only. The real check runs on a PATH without bubblewrap and socat; each step links one in and presses Check again.",
  install: "Staged: the status and the install are patched, so nothing is installed and the install never finishes.",
  windows:
    "Windows only, staged on this capture: Claude is set to run unconfined, as on Windows. The window itself is the capture's platform.",
};
const PLATFORMS = { linux: "Linux", darwin: "macOS", win32: "Windows" };
const manifest = JSON.parse(readFileSync(join(OUT, THEME, "manifest.json"), "utf8"));
const flows = [];
for (const shot of manifest) {
  if (flows.at(-1)?.key !== shot.flow)
    flows.push({ key: shot.flow, name: `${flows.length + 1} · ${NAMES[shot.flow] ?? shot.flow}`, screens: [] });
  flows.at(-1).screens.push(`${String(shot.n).padStart(2, "0")} · ${shot.screen.replaceAll("-", " ")}`);
}
const platform = PLATFORMS[manifest[0]?.platform] ?? "an unknown system";
const layoutNote =
  platform === "macOS"
    ? "Captured on macOS."
    : `Captured on ${platform}: no space is kept above the sidebar. The Mac layout keeps it for the window buttons.`;
const page = THEME === "light" ? "Light" : "Dark";
console.log(`const FLOWS = ${JSON.stringify(flows.map(({ key, name, screens }) => ({ name, screens, note: NOTES[key] ?? null })))};
await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
// The page of this theme, made if it's missing, and emptied, so the map is rebuilt from scratch each time.
let page = figma.root.children.find((p) => p.name === ${JSON.stringify(page)});
if (!page) { page = figma.createPage(); page.name = ${JSON.stringify(page)}; }
await figma.setCurrentPageAsync(page);
for (const node of [...page.children]) node.remove();
const W = 1280, H = 820, GAP = 240, PAD = 160, LABEL = 90;
const ink = { type: "SOLID", color: { r: 0.106, g: 0.09, b: 0.07 } };
const frames = [];
const title = figma.createText();
title.fontName = { family: "Inter", style: "Semi Bold" };
title.characters = ${JSON.stringify(`Tost Work ${VERSION.replace("-", " ")} · screen map · ${THEME}`)};
title.fontSize = 96;
title.fills = [ink];
page.appendChild(title);
title.x = 0; title.y = -400;
const layout = figma.createText();
layout.fontName = { family: "Inter", style: "Semi Bold" };
layout.characters = ${JSON.stringify(layoutNote)};
layout.fontSize = 44;
layout.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.36, b: 0.31 } }];
page.appendChild(layout);
layout.x = 0; layout.y = -250;
let y = 0;
for (const f of FLOWS) {
  const sec = figma.createSection();
  sec.name = f.name;
  page.appendChild(sec);
  sec.x = 0; sec.y = y;
  sec.resizeWithoutConstraints(PAD * 2 + f.screens.length * W + (f.screens.length - 1) * GAP, PAD * 2 + LABEL + H);
  if (f.note) {
    const note = figma.createText();
    note.fontName = { family: "Inter", style: "Semi Bold" };
    note.characters = f.note;
    note.fontSize = 32;
    note.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.36, b: 0.31 } }];
    sec.appendChild(note);
    note.textAutoResize = "HEIGHT";
    note.resize(Math.max(W, sec.width - PAD * 2), note.height);
    note.x = PAD; note.y = 20;
  }
  for (let i = 0; i < f.screens.length; i++) {
    const x = PAD + i * (W + GAP);
    const t = figma.createText();
    t.fontName = { family: "Inter", style: "Semi Bold" };
    t.characters = f.screens[i];
    t.fontSize = 44;
    t.fills = [ink];
    sec.appendChild(t);
    t.x = x; t.y = PAD;
    const fr = figma.createFrame();
    fr.name = f.name + " / " + f.screens[i];
    fr.resize(W, H);
    fr.cornerRadius = 12;
    fr.clipsContent = true;
    fr.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.14 }, offset: { x: 0, y: 10 }, radius: 40, spread: 0, visible: true, blendMode: "NORMAL" }];
    sec.appendChild(fr);
    fr.x = x; fr.y = PAD + LABEL;
    frames.push(fr.id);
    if (i > 0) {
      const v = figma.createVector();
      sec.appendChild(v);
      await v.setVectorNetworkAsync({
        vertices: [{ x: 0, y: 0, strokeCap: "NONE" }, { x: GAP - 70, y: 0, strokeCap: "ARROW_LINES" }],
        segments: [{ start: 0, end: 1 }],
        regions: [],
      });
      v.strokes = [ink];
      v.strokeWeight = 8;
      v.name = "arrow";
      v.x = x - GAP + 35; v.y = PAD + LABEL + H / 2;
    }
  }
  y += sec.height + 240;
}
return { page: page.id, frames };`);
