import type { MouseEvent } from "react";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import { RenameField } from "@/shell/Sidebar";
import type { Project } from "../../../shared/model";

export function Projects({
  projects,
  counts,
  onOpen,
  onNew,
  onMenu,
  renaming,
  onRenamed,
}: {
  projects: Project[];
  /** Tasks per project id. */
  counts: Record<string, number>;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Shows the project's menu. */
  onMenu: (id: string) => void;
  /** The project whose name is being edited. */
  renaming: string | null;
  /** The new name, or null when the user kept the old one. */
  onRenamed: (id: string, name: string | null) => void;
}) {
  const t = useT();
  // Right-click opens the same menu as the … button, as in Finder.
  const contextMenu = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    onMenu(id);
  };
  return (
    <div className="main">
      <div className="top" />
      <div className="scroll">
        <div className="wcol">
          <div className="phead">
            <h1 className="grow">{t("projects.title")}</h1>
            <button type="button" className="btn dark" onClick={onNew}>
              <Icon name="add" />
              {t("projects.new")}
            </button>
          </div>
          {projects.length === 0 && <p className="t2">{t("projects.empty")}</p>}
          <div className="pgrid" style={{ marginTop: 16 }}>
            {projects.map((p) => {
              const count = counts[p.id] ?? 0;
              const body = (
                <>
                  {renaming === p.id ? (
                    <RenameField
                      title={p.name}
                      label={t("menu.rename")}
                      onDone={(name) => onRenamed(p.id, name && name !== p.name ? name : null)}
                    />
                  ) : (
                    <h3>{p.name}</h3>
                  )}
                  {p.description && <p>{p.description}</p>}
                  <div className="meta">
                    <span className="grow">{p.folder}</span>
                    <span>{count === 1 ? t("projects.oneTask") : t("projects.tasks", { n: String(count) })}</span>
                  </div>
                </>
              );
              return (
                // The card is a div holding the open button and the … button, which can't nest.
                <div key={p.id} className="pcard">
                  {renaming === p.id ? (
                    <div className="open">{body}</div>
                  ) : (
                    <button
                      type="button"
                      className="open"
                      onClick={() => onOpen(p.id)}
                      onContextMenu={contextMenu(p.id)}
                    >
                      {body}
                    </button>
                  )}
                  <button
                    type="button"
                    className="more"
                    aria-label={t("recent.more", { name: p.name })}
                    title={t("recent.more", { name: p.name })}
                    onClick={() => onMenu(p.id)}
                    onContextMenu={contextMenu(p.id)}
                  >
                    <Icon name="more-1" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
