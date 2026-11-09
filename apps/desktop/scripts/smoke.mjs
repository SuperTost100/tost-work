// Opens a packaged build the way a new user does, on the fake engine, and fails if any step breaks: setup, Home, a task
// in a project folder that answers its question, asks for approval and makes its files there. CI runs it on the Windows
// and Linux apps, which no one on the team opens day to day.
// Usage, from apps/desktop after packaging: node scripts/smoke.mjs <app executable> <folder for screenshots> [<data>].
// Without <data> the app keeps its data in a throwaway folder. With it, the app uses its own default data folder, which
// must be <data>, and the test checks from outside the app that the data landed there: inside a Microsoft Store
// package, AppData writes the manifest doesn't exclude go to a copy only the app can see.
// On Linux without a display, run it under xvfb-run.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron } from "playwright-core";

const [exe, shots, ownData] = process.argv.slice(2);
if (!exe || !shots) throw new Error("usage: smoke.mjs <app executable> <folder for screenshots> [<data>]");
mkdirSync(shots, { recursive: true });
const data = ownData ? resolve(ownData) : mkdtempSync(join(tmpdir(), "tost-work-smoke-"));
// The project folder sits in the home folder, as a user's would, outside AppData and the temporary folder.
const folder = mkdtempSync(join(homedir(), "tost-work-smoke-project-"));
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });

const app = await _electron.launch({
  executablePath: resolve(exe),
  // The unpacked Linux app has no setuid sandbox helper, and Ubuntu's runners don't allow the user-namespace one.
  args: [...(ownData ? [] : [`--user-data-dir=${data}`]), ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
  env: { ...process.env, TOST_WORK_ENGINE: "fake" },
  timeout: 60_000,
});
let failed = false;
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. Setup, step by step, skipping what needs an account or a folder picker.
  await page.waitForSelector(".setup", { timeout: 30_000 });
  await shot(page, "1-setup");
  for (let i = 0; i < 10 && (await page.locator(".setup").count()); i++) {
    const name = page.locator(".setup input[type=text], .setup input:not([type])").first();
    if ((await name.count()) && !(await name.inputValue())) await name.fill(i === 0 ? "Smoke" : "Smoke test");
    const area = page.locator(".setup textarea").first();
    if ((await area.count()) && !(await area.inputValue())) await area.fill("I test the app before a release.");
    const skip = page.getByRole("button", { name: /^(Skip for now|Salta per ora)$/ });
    const next = page.getByRole("button", { name: /^(Next|Avanti|Start working|Inizia a lavorare)$/ });
    if (await skip.isVisible()) await skip.click();
    else await next.click({ timeout: 5000 });
    await page.waitForTimeout(500);
  }
  if (await page.locator(".setup").count()) throw new Error("Setup didn't finish");

  // 2. Home, past the test build's welcome card.
  const welcome = page.getByRole("dialog");
  if (await welcome.isVisible()) {
    await shot(page, "2-welcome");
    await page.keyboard.press("Escape");
  }
  await page.locator(".composer textarea").first().waitFor({ timeout: 10_000 });
  await shot(page, "3-home");

  // With SMOKE_LOGIN=1, starting at login goes on, and CI checks afterwards that the system recorded it.
  if (process.env.SMOKE_LOGIN === "1") {
    await page.evaluate(() => window.tostWork.settings.update({ openAtLogin: true }));
    await page.waitForTimeout(10_000);
  }

  // 3. A task in a project folder, answered and approved until it ends.
  const project = await page.evaluate(
    (f) => window.tostWork.projects.create({ name: "Smoke", description: "", folder: f }),
    folder,
  );
  const task = await page.evaluate(
    (p) => window.tostWork.tasks.start({ projectId: p, brief: "Prepare the 2027 price list" }),
    project.id,
  );
  let state;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    state = await page.evaluate((id) => window.tostWork.tasks.get(id), task.id);
    if (["done", "failed", "stopped"].includes(state.status)) break;
    if (state.question) await page.evaluate((id) => window.tostWork.tasks.answer(id, ["The client pays it"]), task.id);
    else if (state.approval) await page.evaluate((id) => window.tostWork.tasks.decide(id, "allow"), task.id);
    await page.waitForTimeout(400);
  }
  // The project was made behind the window's back, so it reloads to list it.
  await page.reload();
  await page.locator(".composer textarea").first().waitFor({ timeout: 10_000 });
  await app.evaluate(
    ({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0].webContents.send("window:open-task", id),
    task.id,
  );
  await page.waitForTimeout(800);
  await shot(page, "4-task");
  if (state.status !== "done")
    throw new Error(
      state.status === "failed" || state.status === "stopped"
        ? `The task ended as "${state.status}"`
        : `The task didn't end in 60 s: it's still "${state.status}"`,
    );
  const made = state.files.filter((f) => f.role === "made" && f.kind !== "delete");
  if (!made.length) throw new Error("The task made no files");
  for (const f of made) if (!existsSync(f.path)) throw new Error(`The task listed a file it didn't write: ${f.path}`);
  console.log(`Task ${state.status}, made ${made.length} files in ${readdirSync(folder).length} entries of its folder`);

  // 4. The app's data is where other programs, such as the AI tools, can see it. A Windows run with its own data folder
  // is the Store package's, so it must really run inside the package, or the check above proves nothing.
  if (ownData && process.platform === "win32" && !(await app.evaluate(() => process.windowsStore)))
    throw new Error("The app didn't run inside its Microsoft Store package");
  if (!existsSync(join(data, "tost-work.db"))) throw new Error(`The app's database isn't in ${data}`);

  // 5. Nothing failed along the way: no error in the page, none in the events log a test build keeps.
  if (errors.length) throw new Error(`The page threw: ${errors.join("; ")}`);
  const log = join(data, "logs", "events.log");
  const logged = existsSync(log) ? readFileSync(log, "utf8") : "";
  const logErrors = logged.split("\n").filter((l) => / error /.test(l));
  if (logErrors.length) throw new Error(`The events log has errors:\n${logErrors.join("\n")}`);
  console.log("Smoke test passed");
} catch (err) {
  failed = true;
  console.error(err);
  await app
    .firstWindow()
    .then((p) => shot(p, "failure"))
    .catch(() => {});
} finally {
  await app.close().catch(() => {});
  if (!ownData) rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
process.exit(failed ? 1 : 0);
