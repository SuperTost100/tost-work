import { extname } from "node:path";

export type OfficeKind = "docx" | "xlsx" | "pptx";

export function officeKind(path: string): OfficeKind | null {
  const ext = extname(path).slice(1).toLowerCase();
  return ext === "docx" || ext === "xlsx" || ext === "pptx" ? ext : null;
}

/** A4, the paper Italian and European offices print on, in inches. */
const A4 = { width: 8.27, height: 11.69 };

/**
 * The PDF's page size in inches, read from the HTML OfficeCLI writes: a Word file's own page size, a deck's slide size,
 * and A4 across for a spreadsheet, whose columns run wide.
 */
export function pageSize(html: string, kind: OfficeKind): { width: number; height: number } {
  const pt = (re: RegExp) => {
    const m = html.match(re);
    return m?.[1] && m[2] ? { width: Number(m[1]) / 72, height: Number(m[2]) / 72 } : null;
  };
  if (kind === "docx") return pt(/class="page"[^>]*style="width:([\d.]+)pt;min-height:([\d.]+)pt/) ?? A4;
  if (kind === "pptx") return pt(/--slide-design-w:([\d.]+)pt;[\s\S]*?--slide-design-h:([\d.]+)pt;/) ?? A4;
  return { width: A4.height, height: A4.width };
}

/** Print rules for OfficeCLI's HTML: one Word page or slide per sheet of paper, without the viewer around it. */
export function printCss(kind: OfficeKind): string {
  const common = "html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }";
  if (kind === "docx")
    return `${common}
.page-wrapper { margin: 0 !important; width: auto !important; height: auto !important; }
.page { box-shadow: none !important; border-radius: 0 !important; margin: 0 !important; transform: none !important; break-after: page; }
.page-wrapper:last-child .page { break-after: auto; }`;
  if (kind === "pptx")
    return `${common}
.sidebar, .sidebar-toggle, .slide-label, .toggle-zone, .file-title, .slide-notes, .page-counter { display: none !important; }
.main, .slides, .slide-list { margin: 0 !important; padding: 0 !important; gap: 0 !important; overflow: visible !important; }
.slide-container { display: block !important; width: auto !important; height: auto !important; gap: 0 !important; break-after: page; }
.slide-container:last-child { break-after: auto; }
.slide-wrapper { display: block !important; width: auto !important; }
.slide { transform: none !important; box-shadow: none !important; border-radius: 0 !important; margin: 0 !important; }`;
  return `${common}
.file-title, .sheet-tabs, .row-header, .col-header, .corner-cell, .row-header-col { display: none !important; }
.sheet-content { display: block !important; break-after: page; }
.sheet-content:last-child { break-after: auto; }`;
}

/**
 * OfficeCLI's HTML with the fonts and print rules put in, and no script allowed to run. Its viewer scripts would
 * rescale the pages, and a document's own text could hold markup. A policy at the top blocks every script and
 * event handler, which no pattern for taking scripts out can promise. The main process can still run its own code
 * in the page, to wait for the fonts.
 */
export function printable(html: string, kind: OfficeKind, fonts: string): string {
  const style = `<style>${fonts}\n${printCss(kind)}</style>`;
  const page = html.includes("</head>") ? html.replace("</head>", `${style}</head>`) : style + html;
  return `${NO_SCRIPTS}${page}`;
}

export const NO_SCRIPTS = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">`;
