// Captures every screen and state of the built app in one theme, for the screen map in Figma (see README.md).
// Usage, from apps/desktop after `pnpm build`: node scripts/screen-map/capture.mjs <outdir> <light|dark>.
// On Linux without a display, run it under xvfb-run. Writes <outdir>/<theme>/<flow>__<n>-<screen>.png and a
// manifest.json that lists them in order. It runs on the fake engine, in Italian, with throwaway data.
// A few states exist only on one platform or need a real failure, so the capture makes them without touching the app:
// - Windows-only states: a preload registered on the session (see `preloadFor`) sets `claudeUnconfined` on the page's API;
// - a CLI that is installing: the same preload makes the AI's status "not installed" and its install never finish;
// - the Linux sandbox notice: the app runs on a PATH that has no bubblewrap or socat, which the real check finds;
// - tasks that can't start: rows saved into the throwaway database, with the app's own Italian sentence.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

// What the page's API says on a platform the capture isn't on, or while an install runs. The app's preload exposes the API
// with contextBridge, which makes `window.tostWork` read-only from the page, so this preload patches the call first.
const preloadFor = ({ unconfined, installing }) => `const { contextBridge } = require("electron");
const expose = contextBridge.exposeInMainWorld.bind(contextBridge);
contextBridge.exposeInMainWorld = (key, api) => {
  if (key !== "tostWork") return expose(key, api);
  const patched = { ...api, claudeUnconfined: ${unconfined} };
  if (${installing})
    patched.account = {
      ...api.account,
      status: async () => ({ installed: false, loggedIn: false }),
      install: () => new Promise(() => {}),
    };
  return expose(key, patched);
};
`;

// The Italian sentence for a message key, read from the app's own strings (the `it` list comes after the English one).
const italian = (key, vars = {}) => {
  const source = readFileSync(join(APP, "src/shared/i18n.ts"), "utf8");
  const found = [...source.matchAll(new RegExp(`"${key.replaceAll(".", "\\.")}":\\s*("(?:[^"\\\\]|\\\\.)*")`, "g"))].at(
    -1,
  );
  if (!found) throw new Error(`no Italian string for ${key}`);
  return JSON.parse(found[1]).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? `{${name}}`);
};

// options: unconfined and installing, for the preload above; path, the programs the app's PATH holds (linked from this
// computer's PATH by name) in place of the real PATH, so the sandbox check finds only those.
const launch = async (settings, options = {}) => {
  const data = mkdtempSync(join(tmpdir(), "tost-work-screens-"));
  made.push(data);
  const bin = join(data, "bin");
  if (options.path) {
    mkdirSync(bin);
    for (const name of options.path) linkProgram(bin, name);
  }
  const db = new DatabaseSync(join(data, "tost-work.db"));
  db.exec("create table if not exists settings (key text primary key, value text not null)");
  if (settings) db.prepare("insert into settings (key, value) values ('app', ?)").run(JSON.stringify(settings));
  db.close();
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [APP, "--no-sandbox", `--user-data-dir=${data}`],
    // The home and config folders are the throwaway one too (Documents comes from the config's user-dirs.dirs, or
    // else the home), so the skills in Documents/Tost Work/Skills are its own, never the operator's.
    // shortcut: on macOS the Documents folder doesn't follow HOME; capture on Linux, as the README says.
    env: {
      ...process.env,
      ...(options.path ? { PATH: bin } : {}),
      HOME: data,
      XDG_CONFIG_HOME: join(data, ".config"),
      TOST_WORK_ENGINE: "fake",
      TZ: "Europe/Rome",
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  if (options.unconfined || options.installing) {
    const file = join(data, "preload.cjs");
    writeFileSync(file, preloadFor({ unconfined: !!options.unconfined, installing: !!options.installing }));
    await app.evaluate(
      ({ session }, f) => session.defaultSession.registerPreloadScript({ type: "frame", filePath: f }),
      file,
    );
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  }
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.addStyleTag({ content: STILL }).catch(() => {});
  return { app, page, data, bin };
};

// A program of this computer, linked into `bin` by name, from the first folder of the real PATH that has it.
const linkProgram = (bin, name) => {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const file = join(dir, name);
    if (existsSync(file)) {
      symlinkSync(file, join(bin, name));
      return;
    }
  }
  throw new Error(`${name} isn't on this computer's PATH`);
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
    manifest.push({ flow: name, n, screen, note, platform: process.platform, file });
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
    if (i === 0) {
      await safe("language list", async () => {
        await page.locator(".setup select").first().click({ timeout: 3000 });
        await shot(page, "language-list-open");
        await page.keyboard.press("Escape");
      });
      await safe("name focused", async () => {
        await page.locator(".setup input").first().fill("Tost");
        await page.locator(".setup input").first().focus();
        await shot(page, "name-field-focused");
      });
    }
    if (i === 1)
      await safe("about you focused", async () => {
        await page.locator(".setup textarea").first().fill("Faccio formazione sull'AI per le aziende.");
        await page.locator(".setup textarea").first().focus();
        await shot(page, "text-field-focused");
      });
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
  welcomed: stage ? version : null,
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
  await safe("sidebar search focused", async () => {
    await page.locator(".sidebar .search input, .search input").first().focus({ timeout: 3000 });
    await shot(page, "sidebar-search-focused");
    await page.locator(".composer textarea").first().focus();
  });
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

// 8. Tasks that can't start. The fake engine runs none of the checks that stop a real task, so each is saved as the
// failed task the real engine would leave, with the app's own sentence, and the real window shows it.
await safe("task errors", async () => {
  const shot = flow("errors");
  const db = new DatabaseSync(join(data, "tost-work.db"));
  db.exec("pragma busy_timeout = 5000");
  const now = Date.now();
  const failed = (n, brief, workdir, extra) => {
    const at = new Date(now + n * 1000).toISOString();
    const id = `capture-failed-${n}`;
    const task = {
      id,
      projectId: proj.id,
      title: brief,
      brief,
      attachments: [],
      workdir,
      auth: "account",
      model: "capture",
      effort: "medium",
      choice: "balanced",
      status: "failed",
      question: null,
      approval: null,
      review: null,
      createdAt: at,
      updatedAt: at,
      ...extra,
    };
    db.prepare("insert into tasks (id, project_id, status, data, updated_at) values (?, ?, ?, ?, ?)").run(
      id,
      proj.id,
      "failed",
      JSON.stringify(task),
      at,
    );
    return id;
  };
  // A project folder that carries its own Claude Code settings: a .mcp.json, which Claude Code would start servers from.
  const mcp = join(folder, ".mcp.json");
  writeFileSync(mcp, "{}");
  const claudeFolder = failed(1, "Aggiorna il listino con i prezzi nuovi", folder, {
    provider: "claude",
    error: italian("error.claudeFolderSettings", { path: mcp }),
  });
  // What the real check says when Codex isn't there to turn its step check on.
  const chatgpt = failed(2, "Riassumi il contratto in una pagina", folder, {
    provider: "codex",
    error: italian("error.codexHookOff", { detail: "Codex isn't installed" }),
  });
  // A Linux computer without socat, for a Claude task. The notice's commands come from the real distribution.
  const { distro } = await page.evaluate(() => window.tostWork.sandbox.check("claude"));
  const sandbox = failed(3, "Prepara l'offerta per il corso di gennaio", folder, {
    provider: "claude",
    error: italian("error.sandboxNotReady", { ai: "Claude", missing: italian("sandbox.missing.socat") }),
    sandboxNotReady: { ready: false, missing: ["socat"], distro, appArmorRestrictsUserns: null },
    sandboxRun: { followUp: null },
  });
  db.close();
  await page.reload();
  await page.waitForSelector("text=Tost");
  await openTask(claudeFolder);
  await shot(page, "claude-folder-settings");
  await openTask(chatgpt);
  await shot(page, "chatgpt-cant-start");
  await openTask(sandbox);
  await shot(page, "linux-sandbox-not-ready");
});

// 9. Cards.
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

// A fresh app on its setup, walked to the Connect an AI step. Each step gets what it needs to go on.
const toConnectStep = async (p) => {
  await p.waitForSelector(".setup", { timeout: 20000 });
  for (let i = 0; i < 8; i++) {
    if (await p.getByRole("heading", { name: /^Collega un'AI/ }).count()) return;
    const field = p.locator(".setup input[type=text], .setup input:not([type])").first();
    if ((await field.count()) && !(await field.inputValue()))
      await field.fill(i === 0 ? "Tost" : "Offerte per i clienti");
    const skip = p.getByRole("button", { name: "Salta per ora" });
    const next = p.getByRole("button", { name: /^(Avanti|Inizia a lavorare)$/ });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    else await next.click({ timeout: 3000 });
    await p.waitForTimeout(400);
  }
  throw new Error("the Connect an AI step didn't open");
};
const settingsOf = { language: "it", theme: THEME };
const kill = (a) => process.kill(a.process().pid, "SIGKILL");
// The main app isn't needed from here, so it goes before the next ones start.
kill(app);

// 10. Linux: the sandbox notice in setup, from a PATH with no bubblewrap and no socat, then as each is installed. The
// check runs for real in the app's main process, so the notice is the real one; "Check again" finds what was linked in.
await safe("linux sandbox", async () => {
  const shot = flow("linux");
  const l = await launch(settingsOf, { path: ["node", "true", "claude", "codex"] });
  try {
    await toConnectStep(l.page);
    await l.page.waitForSelector(".sbx");
    await shot(l.page, "linux-sandbox-bwrap-and-socat-missing");
    linkProgram(l.bin, "bwrap");
    await l.page.getByRole("button", { name: "Controlla di nuovo" }).click();
    await l.page.waitForSelector(".sbx-status:not(:empty)");
    await shot(l.page, "linux-sandbox-socat-missing");
    linkProgram(l.bin, "socat");
    await l.page.getByRole("button", { name: "Controlla di nuovo" }).click();
    await l.page.waitForSelector(".sbx.ok");
    await shot(l.page, "linux-sandbox-ready");
  } finally {
    kill(l.app);
  }
});

// 11. Connect an AI while an install runs: Codex's row keeps its button. The status and the install are the preload's, so
// nothing is installed; the install never finishes.
await safe("install running", async () => {
  const shot = flow("install");
  const l = await launch(settingsOf, { installing: true });
  try {
    await toConnectStep(l.page);
    await l.page.getByRole("button", { name: "Installa Claude Code" }).click();
    await l.page.waitForSelector(".btn.busy");
    await shot(l.page, "install-running");
  } finally {
    kill(l.app);
  }
});

// 12. Windows only. The capture runs on Linux, so the preload says Claude runs unconfined, as it does on Windows; the
// window is still Linux's. Cancel closes each card, so nothing is installed, saved or started.
await safe("windows", async () => {
  const shot = flow("windows");
  const w = await launch(settingsOf, { unconfined: true });
  try {
    await toConnectStep(w.page);
    await shot(w.page, "windows-setup-claude-note");
    const claude = w.page.locator(".opt").filter({ hasText: "Abbonamento Claude" });
    await claude.getByRole("button", { name: /Accedi|Installa Claude Code/ }).click();
    await w.page.getByRole("alertdialog").waitFor({ timeout: 4000 });
    await shot(w.page, "windows-claude-card");
    await w.page.getByRole("alertdialog").getByRole("button", { name: "Annulla" }).click();
    await w.page.locator(".opt input").fill(`sk-ant-${"x".repeat(24)}`);
    await w.page.getByRole("button", { name: "Usa la chiave" }).click();
    await w.page.getByRole("alertdialog").waitFor({ timeout: 4000 });
    await shot(w.page, "windows-course-key-card");
    await w.page.getByRole("alertdialog").getByRole("button", { name: "Annulla" }).click();
  } finally {
    kill(w.app);
  }
  // A set-up app whose tasks run on Claude: Settings shows the note, and the first task asks before it starts.
  const m = await launch(
    {
      setupDone: true,
      name: "Tost",
      language: "it",
      theme: THEME,
      level: "expert",
      welcomed: stage ? version : null,
      modelPick: { ai: "claude", model: "capture", effort: "medium" },
    },
    { unconfined: true },
  );
  try {
    await m.page.waitForSelector("text=Tost", { timeout: 20000 });
    await m.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("menu:action", "settings"),
    );
    await m.page.waitForSelector(".snav");
    await m.page
      .locator(".snav > button, .snav > a")
      .filter({ hasText: /Account/ })
      .first()
      .click();
    await shot(m.page, "windows-settings-claude-note");
    await m.page.click("[data-nav=home]");
    await m.page.locator(".composer textarea").first().fill("Scrivi l'offerta per il corso di dicembre");
    await m.page.keyboard.press("Enter");
    await m.page.getByRole("alertdialog").waitFor({ timeout: 4000 });
    await shot(m.page, "windows-first-claude-task-card");
    await m.page.getByRole("alertdialog").getByRole("button", { name: "Annulla" }).click();
  } finally {
    kill(m.app);
  }
});

console.log(`captured ${manifest.length} screens`);
process.exit(0);
