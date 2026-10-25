import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import type { Project, Task } from "../../../shared/model";

export function Projects({
  projects,
  tasks,
  onOpen,
  onNew,
}: {
  projects: Project[];
  tasks: Task[];
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const t = useT();
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
              const count = tasks.filter((x) => x.projectId === p.id).length;
              return (
                <button type="button" key={p.id} className="pcard" onClick={() => onOpen(p.id)}>
                  <h3>{p.name}</h3>
                  {p.description && <p>{p.description}</p>}
                  <div className="meta">
                    <span className="grow">{p.folder}</span>
                    <span>{t("projects.tasks", { n: String(count) })}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
