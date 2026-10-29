import { type MouseEvent, useContext } from "react";
import { Icon } from "@/lib/Icon";
import { LanguageContext, useT } from "@/lib/useT";
import { RenameField } from "@/shell/Sidebar";
import { DESCRIPTION_MAX, type Project, type ProjectOverview } from "../../../shared/model";
import { WorkingDots } from "../components/TaskTag";

export function Projects({
  projects,
  overviews,
  onOpen,
  onNew,
  onMenu,
  renaming,
  onRenamed,
  describing,
  onDescribed,
}: {
  projects: Project[];
  /** Each project's tasks in numbers, by project id. */
  overviews: Record<string, ProjectOverview>;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Shows the project's menu. */
  onMenu: (id: string) => void;
  /** The project whose name is being edited. */
  renaming: string | null;
  /** The new name, or null when the user kept the old one. */
  onRenamed: (id: string, name: string | null) => void;
  /** The project whose description is being edited. */
  describing: string | null;
  /** The new description, possibly empty, or null when the user kept the old one. */
  onDescribed: (id: string, description: string | null) => void;
}) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const day = (at: string) => new Date(at).toLocaleDateString(lang, { day: "numeric", month: "short" });
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
              const o = overviews[p.id];
              const count = o?.tasks ?? 0;
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
                  {describing === p.id ? (
                    <RenameField
                      title={p.description}
                      label={t("project.description")}
                      placeholder={t("project.describeHint")}
                      className="describe"
                      allowEmpty
                      maxLength={DESCRIPTION_MAX}
                      onDone={(text) => onDescribed(p.id, text !== null && text !== p.description ? text : null)}
                    />
                  ) : (
                    p.description && <p>{p.description}</p>
                  )}
                  <div className="meta">
                    {/* What needs the user comes first, as in the sidebar; then what's working. */}
                    {o?.needsYou ? (
                      <span className="tag mine">{t("tag.needsYou")}</span>
                    ) : o?.working ? (
                      <span className="tag">
                        <WorkingDots />
                        {t("projects.working", { n: String(o.working) })}
                      </span>
                    ) : null}
                    <span className="grow">
                      {o?.lastResult &&
                        t("projects.lastResult", { name: o.lastResult.name, when: day(o.lastResult.at) })}
                    </span>
                    <span>{count === 1 ? t("projects.oneTask") : t("projects.tasks", { n: String(count) })}</span>
                  </div>
                </>
              );
              return (
                // The card is a div holding the open button and the … button, which can't nest.
                <div key={p.id} className="pcard">
                  {renaming === p.id || describing === p.id ? (
                    <div className="open">{body}</div>
                  ) : (
                    <button
                      type="button"
                      className="open"
                      title={p.folder}
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
