import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { BrowserWindow, session } from "electron";
import caladeaBold from "../renderer/src/assets/fonts/Caladea-Bold.ttf?asset";
import caladeaBoldItalic from "../renderer/src/assets/fonts/Caladea-BoldItalic.ttf?asset";
import caladeaItalic from "../renderer/src/assets/fonts/Caladea-Italic.ttf?asset";
import caladeaRegular from "../renderer/src/assets/fonts/Caladea-Regular.ttf?asset";
import carlitoBold from "../renderer/src/assets/fonts/Carlito-Bold.ttf?asset";
import carlitoBoldItalic from "../renderer/src/assets/fonts/Carlito-BoldItalic.ttf?asset";
import carlitoItalic from "../renderer/src/assets/fonts/Carlito-Italic.ttf?asset";
import carlitoRegular from "../renderer/src/assets/fonts/Carlito-Regular.ttf?asset";

import { officeKind, pageSize, printable } from "./pdf-page";
import { UserError } from "./userError";

const run = promisify(execFile);

/** Calibri and Cambria as Carlito and Caladea, which have the same letter widths, unless they're installed. */
function fontFaces(): string {
  const faces: [string, string[], string, number, string][] = [
    ["Calibri", ["Calibri"], carlitoRegular, 400, "normal"],
    ["Calibri", ["Calibri Bold"], carlitoBold, 700, "normal"],
    ["Calibri", ["Calibri Italic"], carlitoItalic, 400, "italic"],
    ["Calibri", ["Calibri Bold Italic"], carlitoBoldItalic, 700, "italic"],
    ["Cambria", ["Cambria"], caladeaRegular, 400, "normal"],
    ["Cambria", ["Cambria Bold"], caladeaBold, 700, "normal"],
    ["Cambria", ["Cambria Italic"], caladeaItalic, 400, "italic"],
    ["Cambria", ["Cambria Bold Italic"], caladeaBoldItalic, 700, "italic"],
  ];
  return faces
    .map(
      ([family, locals, file, weight, style]) =>
        `@font-face { font-family: "${family}"; src: ${locals.map((l) => `local("${l}")`).join(", ")}, url("${pathToFileURL(file).href}"); font-weight: ${weight}; font-style: ${style}; }`,
    )
    .join("\n");
}

let offline = false;
/** The print window's own session, which can load nothing but files and inline data. */
function printSession() {
  const ses = session.fromPartition("tost-work-pdf");
  if (!offline) {
    ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file|data):/.test(details.url) }));
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    offline = true;
  }
  return ses;
}

/**
 * Makes a PDF of a Word, Excel or PowerPoint file: OfficeCLI draws it as HTML, and Electron's Chromium prints that.
 * Nothing else needs installing, and the print window can't reach the network.
 */
export async function makePdf(officecli: string, env: NodeJS.ProcessEnv, source: string, target: string) {
  const kind = officeKind(source);
  if (!kind) throw new UserError("error.pdfKinds");
  const dir = await mkdtemp(join(tmpdir(), "tost-work-pdf-"));
  try {
    const page = join(dir, "page.html");
    await run(officecli, ["view", source, "html", "-o", page], { env, timeout: 120_000 });
    const html = await readFile(page, "utf8");
    await writeFile(page, printable(html, kind, fontFaces()));
    const win = new BrowserWindow({
      show: false,
      webPreferences: { session: printSession(), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    try {
      await win.loadFile(page);
      await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
      const pdf = await win.webContents.printToPDF({
        pageSize: pageSize(html, kind),
        margins:
          kind === "xlsx" ? { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } : { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true,
      });
      // Exclusive: if the free name was taken or turned into a link since it was picked, this fails instead of
      // writing through it.
      await writeFile(target, pdf, { flag: "wx" });
    } finally {
      win.destroy();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
