import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/useT";
import type { FileContent, TostWorkApi } from "../../../shared/api";

type Loaded =
  | { kind: "html"; html: string }
  | { kind: "docx"; bytes: Uint8Array }
  | {
      kind: "table";
      rows: { id: string; cells: { id: string; text: string }[] }[];
      sheet: string;
      /** Rows left out of the preview; null when there are more but the format doesn't say how many (CSV). */
      more: number | null;
    }
  | { kind: "pdf"; bytes: Uint8Array }
  | { kind: "image"; url: string }
  | { kind: "text"; text: string }
  | { kind: "none" };

const MAX_ROWS = 200;
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const TEXT = new Set(["txt", "json", "log", "xml", "html", "csv-raw"]);

/** Turns a file into something the preview can draw. Each library loads only when a file of its kind opens. */
export async function load(file: FileContent): Promise<Loaded> {
  const { ext, bytes } = file;
  if (ext === "docx") return { kind: "docx", bytes };
  if (ext === "pdf") return { kind: "pdf", bytes };
  if (ext === "xlsx" || ext === "xls" || ext === "csv" || ext === "ods") {
    const { read, utils } = await import("xlsx");
    // sheetRows stops parsing after the rows the preview shows; the sheet's full size stays in !fullref.
    const book = read(bytes, { type: "array", sheetRows: MAX_ROWS });
    const sheet = book.SheetNames[0];
    const ws = sheet ? book.Sheets[sheet] : undefined;
    if (!sheet || !ws) return { kind: "none" };
    // XLSX and XLS record their full size; CSV doesn't, so a parse that filled the limit may have stopped early.
    const fullRef = ws["!fullref"];
    const parsed = ws["!ref"] ? utils.decode_range(ws["!ref"]) : null;
    const full = fullRef ? utils.decode_range(fullRef) : null;
    const total = full ? full.e.r - full.s.r + 1 : 0;
    const filled = parsed ? parsed.e.r - parsed.s.r + 1 >= MAX_ROWS : false;
    const rows = utils.sheet_to_json<(string | number | boolean | null)[]>(ws, {
      header: 1,
      raw: false,
      blankrows: false,
    });
    // Rows and cells get ids from their position here, once, so the table can key them.
    const shown = rows.slice(0, MAX_ROWS).map((row, r) => ({
      id: `r${r}`,
      cells: Array.from(row, (cell, c) => ({ id: `r${r}c${c}`, text: cell == null ? "" : String(cell) })),
    }));
    const more = full ? Math.max(0, total - MAX_ROWS) : filled ? null : 0;
    return { kind: "table", rows: shown, sheet, more };
  }
  if (ext === "md" || ext === "markdown") {
    const [{ marked }, { default: DOMPurify }] = await Promise.all([import("marked"), import("dompurify")]);
    // Agents write this Markdown, so its HTML is sanitised before it reaches the page.
    return { kind: "html", html: DOMPurify.sanitize(await marked.parse(new TextDecoder().decode(bytes))) };
  }
  if (IMAGE.has(ext)) return { kind: "image", url: URL.createObjectURL(new Blob([bytes as BlobPart])) };
  if (TEXT.has(ext)) return { kind: "text", text: new TextDecoder().decode(bytes).slice(0, 200_000) };
  return { kind: "none" };
}

/** Called when a file can't be drawn, such as a damaged Word file or a PDF with a password. */
type OnError = (error: unknown) => void;

function Docx({ bytes, onError }: { bytes: Uint8Array; onError: OnError }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    import("docx-preview")
      .then(async ({ renderAsync }) => {
        // docx-preview can't be cancelled, so it draws into a detached container that's attached only if this
        // render is still the current one.
        const staging = document.createElement("div");
        await renderAsync(bytes, staging, undefined, {
          className: "docx",
          inWrapper: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
        });
        if (alive) el.replaceChildren(...staging.childNodes);
      })
      .catch((err: unknown) => alive && onError(err));
    return () => {
      alive = false;
    };
  }, [bytes, onError]);
  return <div className="pv-docx" ref={ref} />;
}

/** PDF pages beyond this many are left out of the preview, with a note to open the file. */
const MAX_PAGES = 20;

function Pdf({ bytes, onError }: { bytes: Uint8Array; onError: OnError }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      // pdf.js takes ownership of the buffer it gets, so it gets a copy.
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      // A newer PDF may have rendered meanwhile; an old load must not clear it.
      if (!alive) return;
      el.replaceChildren();
      setMore(Math.max(0, doc.numPages - MAX_PAGES));
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
        const page = await doc.getPage(n);
        if (!alive) return;
        const viewport = page.getViewport({ scale: 1.4 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        el.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
      }
    })().catch((err: unknown) => alive && onError(err));
    return () => {
      alive = false;
    };
  }, [bytes, onError]);
  return (
    <>
      <div className="pv-pdf" ref={ref} />
      {more > 0 && <p className="pv-note">{t("preview.morePages", { n: String(more) })}</p>}
    </>
  );
}

function Html({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, [html]);
  return <div className="pv-md" ref={ref} />;
}

export function Preview({
  api,
  taskId,
  path,
  version,
}: {
  api: TostWorkApi;
  taskId: string;
  path: string;
  version: string;
}) {
  const t = useT();
  const [state, setState] = useState<{ loaded?: Loaded; error?: string }>({});
  const latest = useRef("");

  // `version` changes whenever the task does, so a file being written is read again. The previous preview stays on
  // screen until the new one is ready, and a read that comes back after a newer one started is dropped.
  useEffect(() => {
    const request = `${taskId}|${path}|${version}`;
    latest.current = request;
    api.files
      .read(taskId, path)
      .then(load)
      .then((loaded) => {
        if (latest.current === request) setState({ loaded });
        // A read that came back after a newer one started is dropped, and so is its image.
        else if (loaded.kind === "image") URL.revokeObjectURL(loaded.url);
      })
      .catch(
        (e: unknown) => latest.current === request && setState({ error: e instanceof Error ? e.message : String(e) }),
      );
  }, [api, taskId, path, version]);

  // An image's URL lives as long as it's on screen: it goes when the next preview replaces it, or on unmount.
  const shown = state.loaded?.kind === "image" ? state.loaded.url : undefined;
  useEffect(() => {
    if (!shown) return;
    return () => URL.revokeObjectURL(shown);
  }, [shown]);

  // A file that loaded but can't be drawn shows the same message as one that couldn't be read.
  const failed = useCallback(
    (err: unknown) => setState({ error: err instanceof Error ? err.message : String(err) }),
    [],
  );

  const { loaded, error } = state;
  if (error) return <p className="pv-note">{error}</p>;
  if (!loaded) return <p className="pv-note">{t("preview.loading")}</p>;
  switch (loaded.kind) {
    case "docx":
      return <Docx bytes={loaded.bytes} onError={failed} />;
    case "pdf":
      return <Pdf bytes={loaded.bytes} onError={failed} />;
    case "html":
      return <Html html={loaded.html} />;
    case "image":
      return <img className="pv-img" src={loaded.url} alt="" />;
    case "text":
      return <pre className="pv-text">{loaded.text}</pre>;
    case "table":
      return (
        <div className="pv-table">
          <table className="tbl">
            <tbody>
              {loaded.rows.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell) => (
                    <td key={cell.id}>{cell.text}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {loaded.more === null ? (
            <p className="pv-note">{t("preview.moreRowsUnknown")}</p>
          ) : (
            loaded.more > 0 && <p className="pv-note">{t("preview.moreRows", { n: String(loaded.more) })}</p>
          )}
        </div>
      );
    default:
      return <p className="pv-note">{t("preview.none")}</p>;
  }
}
