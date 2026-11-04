import type { ReactNode } from "react";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";

export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const isSheet = (path: string) => /\.(xlsx|xls|csv)$/i.test(path);
const CELLS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

/** A small page for a file: a grid for a spreadsheet, lines of text for the rest, and a folded corner for a brief. */
export function Thumb({ path, brief = false }: { path?: string; brief?: boolean }) {
  if (brief)
    return (
      <span className="thumb brief">
        <i />
        <i />
        <i />
      </span>
    );
  return path && isSheet(path) ? (
    <span className="thumb sheet">
      {CELLS.map((c) => (
        <i key={c} />
      ))}
    </span>
  ) : (
    <span className="thumb">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function FileLine({
  path,
  sub,
  action,
  onOpen,
  onSelect,
}: {
  path: string;
  /** A short line under the name, such as where the file came from. */
  sub?: ReactNode;
  /** A button of the row's own, before Open. */
  action?: ReactNode;
  onOpen?: () => void;
  onSelect?: () => void;
}) {
  const t = useT();
  const name = (
    <>
      <Thumb path={path} />
      <span className="grow">
        <span className="nm truncate" style={{ display: "block" }}>
          {fileName(path)}
        </span>
        {sub && <span className="sb">{sub}</span>}
      </span>
    </>
  );
  return (
    <div className="fileline" title={path}>
      {onSelect ? (
        <button type="button" className="pick-file grow" onClick={onSelect}>
          {name}
        </button>
      ) : (
        name
      )}
      {action}
      {onOpen && (
        <button type="button" className="tbtn" onClick={onOpen}>
          <Icon name="external-link" />
          {t("preview.open")}
        </button>
      )}
    </div>
  );
}
