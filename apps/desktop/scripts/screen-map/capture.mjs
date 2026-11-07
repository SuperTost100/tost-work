// Captures every screen and state of the built app in one theme, for the screen map in Figma (see README.md).
// Usage, from apps/desktop after `pnpm build`: node scripts/screen-map/capture.mjs <outdir> <light|dark>.
// On Linux without a display, run it under xvfb-run. Writes <outdir>/<theme>/<flow>__<n>-<screen>.png and a
// manifest.json that lists them in order. It runs on the fake engine, in Italian, with throwaway data.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [OUT, THEME] = process.argv.slice(2);
if (!OUT || (THEME !== "light" && THEME !== "dark")) throw new Error("usage: capture.mjs <outdir> <light|dark>");
const version = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")).version;
// The stage's welcome card already seen, except in the setup flow, where a new user meets it.
const stage = /-(dev|alpha|beta)$/.exec(version)?.[1] ?? null;
const dir = join(OUT, THEME);
mkdirSync(dir, { recursive: true });
const electronPath = createRequire(join(APP, "package.json"))("electron");
const manifest = [];
// The throwaway data folders, removed on the way out, whether the capture finished or not.
const made = [];
process.on("exit", () => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const STILL =
  "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

const launch = async (settings) => {
  const data = mkdtempSync(join(tmpdir(), "tost-work-screens-"));
  made.push(data);
  const db = new DatabaseSync(join(data, "tost-work.db"));
  db.exec("create table if not exists settings (key text primary key, value text not null)");
  if (settings) db.prepare("insert into settings (key, value) values ('app', ?)").run(JSON.stringify(settings));
  db.close();
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [APP, "--no-sandbox", `--user-data-dir=${data}`],
    // The home folder is the throwaway one too, so the skills in Documents/Tost Work/Skills are its own, never the
    // operator's. shortcut: on macOS the Documents folder doesn't follow HOME; capture on Linux, as the README says.
    env: {
      ...process.env,
      HOME: data,
      XDG_DOCUMENTS_DIR: join(data, "Documents"),
      TOST_WORK_ENGINE: "fake",
      TZ: "Europe/Rome",
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.waitForLoadState("domcontentloaded");
  await page.addStyleTag({ content: STILL }).catch(() => {});
  return { app, page, data };
};

let flowIndex = 0;
const flow = (name) => {
  flowIndex++;
  let n = 0;
  return async (page, screen, note = "") => {
    n++;
    await page.addStyleTag({ content: STILL }).catch(() => {});
    await page.waitForTimeout(450);
    const file = `${String(flowIndex).padStart(2, "0")}-${name}__${String(n).padStart(2, "0")}-${screen}.png`;
    await page.screenshot({ path: join(dir, file) });
    manifest.push({ flow: name, n, screen, note, file });
    // Saved after every screen, so a step that fails later still leaves a usable capture.
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
  };
};
const safe = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log(`SKIP ${label}: ${e.message.split("\n")[0]}`);
  }
};

// 1. Setup, from a fresh install.
{
  const { app, page } = await launch({ language: "it", theme: THEME });
  const shot = flow("setup");
  await page.waitForSelector(".setup", { timeout: 20000 });
  for (let i = 0; i < 8; i++) {
    await shot(page, `step-${i + 1}`);
    const name = page.locator(".setup input[type=text], .setup input:not([type])").first();
    if ((await name.count()) && !(await name.inputValue())) await name.fill(i === 0 ? "Tost" : "Offerte per i clienti");
    const area = page.locator(".setup textarea").first();
    if ((await area.count()) && !(await area.inputValue()))
      await area.fill("Faccio formazione sull'AI per le aziende.");
    const skip = page.getByRole("button", { name: "Salta per ora" });
    const next = page.getByRole("button", { name: /^(Avanti|Inizia a lavorare)$/ });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    else if (await next.isVisible().catch(() => false)) await next.click({ timeout: 3000 }).catch(() => {});
    else break;
    await page.waitForTimeout(500);
    if (!(await page.locator(".setup").count())) break;
  }
  await page.waitForTimeout(600);
  await shot(page, stage ? "first-home-welcome" : "first-home");
  process.kill(app.process().pid, "SIGKILL");
}

// The rest from a set-up app with a project, a job and tasks in every state.
const { app, page, data } = await launch({
  setupDone: true,
  name: "Tost",
  language: "it",
  theme: THEME,
  level: "expert",
  welcomed: stage,
});
await page.waitForSelector("text=Tost", { timeout: 20000 });
const send = (channel, arg) =>
  app.evaluate(({ BrowserWindow }, [c, a]) => BrowserWindow.getAllWindows()[0].webContents.send(c, a), [channel, arg]);
const menu = (a) => send("menu:action", a);
const openTask = (id) => send("window:open-task", id);
const nav = async (id) => {
  await page.click(`[data-nav=${id}]`);
  await page.waitForTimeout(500);
};
const folder = join(data, "proj");
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, "Proposta.docx"), "old");
const proj = await page.evaluate(
  (f) =>
    window.tostWork.projects.create({
      name: "Alpi Logistica",
      description: "Offerte e contratti per Alpi Logistica",
      folder: f,
    }),
  folder,
);
await page.evaluate(
  ({ id }) =>
    window.tostWork.jobs.create({
      projectId: id,
      title: "Riepilogo settimanale",
      brief: "Riassumi le offerte della settimana",
      schedule: { repeat: "weekly", time: "09:00", days: [1] },
      missed: "run",
      output: "",
    }),
  proj,
);
const start = (brief, projectId = null) =>
  page.evaluate(([b, p]) => window.tostWork.tasks.start({ projectId: p, brief: b }), [brief, projectId]);
const get = (id) => page.evaluate((i) => window.tostWork.tasks.get(i), id);
const until = async (id, ok) => {
  for (let i = 0; i < 80; i++) {
    const t = await get(id);
    if (ok(t)) return t;
    await page.waitForTimeout(400);
  }
  return get(id);
};
const asking = await start("Scrivi una proposta per Ferraris Trasporti dagli appunti della chiamata");
await until(asking.id, (t) => t.question);
const done = await start("Prepara il listino prezzi 2027", proj.id);
for (let i = 0; i < 80; i++) {
  const t = await get(done.id);
  if (t.question) await page.evaluate((id) => window.tostWork.tasks.answer(id, ["The client pays it"]), done.id);
  else if (t.approval) await page.evaluate((id) => window.tostWork.tasks.decide(id, "allow"), done.id);
  if (t.status === "done" || t.status === "review") break;
  await page.waitForTimeout(400);
}
const approving = await start("Aggiorna la proposta con i nuovi prezzi", proj.id);
for (let i = 0; i < 80; i++) {
  const t = await get(approving.id);
  if (t.question) await page.evaluate((id) => window.tostWork.tasks.answer(id, ["The client pays it"]), approving.id);
  if (t.approval) break;
  await page.waitForTimeout(400);
}
await page.reload();
await page.waitForSelector("text=Tost");

// 2. Home and a task.
{
  const shot = flow("task");
  await nav("home");
  await shot(page, "home");
  await safe("home typed", async () => {
    await page
      .locator(".composer textarea")
      .first()
      .fill("Scrivi l'offerta per il corso di dicembre, come quella di ottobre");
    await shot(page, "home-typed");
    await page.locator(".composer textarea").first().fill("");
  });
  await safe("working", async () => {
    const w = await start("Riassumi le spese di ottobre in una tabella");
    await openTask(w.id);
    await page.waitForTimeout(600);
    await shot(page, "task-working");
  });
  await openTask(asking.id);
  await shot(page, "task-question");
  await openTask(approving.id);
  await shot(page, "task-replace-file");
  await openTask(done.id);
  await shot(page, "task-done");
  await safe("file preview", async () => {
    await page.locator(".ftabs button, .ftabs a").first().click({ timeout: 3000 });
    await shot(page, "task-file-preview");
  });
  await safe("search", async () => {
    await nav("home");
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(400);
    await page.keyboard.type("prop");
    await shot(page, "search");
    await page.keyboard.press("Escape");
  });
}

// 3. Projects.
{
  const shot = flow("projects");
  await nav("projects");
  await shot(page, "projects");
  await safe("new project", async () => {
    await menu("new-project");
    try {
      await page.waitForTimeout(500);
      await shot(page, "new-project");
    } finally {
      // Closed even when the shot fails, so the dialog doesn't cover the screens after it.
      await page.keyboard.press("Escape");
    }
  });
  await safe("project page", async () => {
    await page.locator(".pcard").first().click({ timeout: 3000 });
    await shot(page, "project");
  });
}

// 4. Skills.
await safe("skills", async () => {
  const shot = flow("skills");
  await nav("skills");
  await shot(page, "skills");
  const item = page.locator(".slist .sitem .open").first();
  if (await item.count()) {
    await item.click();
    await shot(page, "skill-editor");
  }
});

// 5. Jobs.
await safe("jobs", async () => {
  const shot = flow("jobs");
  await nav("jobs");
  await shot(page, "jobs");
  await page.locator(".jmain").first().click({ timeout: 3000 });
  await page.waitForTimeout(400);
  const steps = page.locator(".msteps li button, .msteps li");
  const n = Math.min(await steps.count(), 4);
  for (let i = 0; i < n; i++) {
    await steps
      .nth(i)
      .click({ timeout: 2000 })
      .catch(() => {});
    await shot(page, `job-editor-step-${i + 1}`);
  }
  await page.keyboard.press("Escape");
});

// 6. Board.
await safe("board", async () => {
  const shot = flow("board");
  await nav("board");
  await shot(page, "board-list");
  await page.locator(".brow").first().click({ timeout: 3000 });
  await shot(page, "board-row-open");
  await page.keyboard.press("Escape");
  await page.locator(".top .iconbtn").nth(1).click();
  await shot(page, "board-columns");
  await page.locator(".top .iconbtn").nth(0).click();
});

// 7. Settings, every tab, then What's new, About and the profile.
await safe("settings", async () => {
  const shot = flow("settings");
  await menu("settings");
  await page.waitForTimeout(500);
  const labels = (await page.locator(".snav > button, .snav > a").allInnerTexts()).map((l) => l.trim());
  for (const l of labels) {
    // Each page can replace the list, so the tab is found again by its label.
    if (!(await page.locator(".snav").count())) await menu("settings");
    await page.waitForTimeout(300);
    await page
      .locator(".snav > button, .snav > a")
      .filter({ hasText: l })
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await shot(page, l.toLowerCase().replace(/[^a-zà-ú0-9]+/g, "-"));
  }
  await page.click("[data-nav=profile]").catch(() => {});
  await shot(page, "profile");
});

// 8. Cards.
await safe("cards", async () => {
  const shot = flow("cards");
  await menu("report");
  await page.getByRole("dialog").waitFor({ timeout: 4000 });
  await shot(page, "report-a-problem");
  await page.keyboard.press("Escape");
  await start("Un'altra prova");
  await page.waitForTimeout(1200);
  await app.evaluate(({ app }) => app.quit());
  await page.getByRole("alertdialog").waitFor({ timeout: 6000 });
  await shot(page, "quit-card");
  await page.getByRole("alertdialog").getByRole("button", { name: "Annulla" }).click();
});

console.log(`captured ${manifest.length} screens`);
process.kill(app.process().pid, "SIGKILL");
process.exit(0);
