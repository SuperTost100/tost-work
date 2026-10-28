import { type Attachments, Composer } from "@/components/Composer";
import { TaskTag } from "@/components/TaskTag";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import type { Project as ProjectT, Task } from "../../../shared/model";

export function Project({
  project,
  tasks,
  brief,
  onBriefChange,
  onStart,
  attach,
  onOpenTask,
  onBack,
  onAddJob,
}: {
  project: ProjectT;
  tasks: Task[];
  brief: string;
  onBriefChange: (text: string) => void;
  onStart: () => void;
  attach?: Attachments;
  onOpenTask: (id: string) => void;
  onBack: () => void;
  /** Opens the job builder in this project; missing while Jobs is turned off. */
  onAddJob?: () => void;
}) {
  const t = useT();
  const mine = tasks.filter((x) => x.projectId === project.id);
  return (
    <div className="main">
      <div className="top">
        <span className="crumb">
          <button type="button" className="link" onClick={onBack}>
            {t("projects.title")}
          </button>
          <span className="t3">/</span>
          <b>{project.name}</b>
        </span>
      </div>
      <div className="scroll">
        <div className="proj">
          <div>
            <h1>{project.name}</h1>
            {project.description && <p className="lede">{project.description}</p>}
            <Composer
              value={brief}
              onChange={onBriefChange}
              onSubmit={onStart}
              placeholder={t("composer.newIn", { name: project.name })}
              attach={attach}
              sendLabel={t("composer.start")}
              minHeight={56}
            />
            <div className="sec">
              <span>{t("project.tasks")}</span>
            </div>
            {mine.length === 0 && <p className="t3">{t("project.noTasks")}</p>}
            {mine.map((task) => (
              <button type="button" key={task.id} className="item" onClick={() => onOpenTask(task.id)}>
                <div className="r1">
                  <span className="ttl">{task.title}</span>
                  <TaskTag task={task} />
                </div>
              </button>
            ))}
          </div>
          <aside className="sidecol">
            <div className="setrow">
              <Icon name="edit-2" />
              <span className="grow">
                <span className="k">{t("project.instructions")}</span>
                <span className="v">{project.instructions || t("project.instructionsEmpty")}</span>
              </span>
            </div>
            {onAddJob && (
              <div className="setrow">
                <Icon name="calendar" />
                <span className="grow">
                  <span className="k">{t("nav.jobs")}</span>
                  <span className="v">{t("project.jobs")}</span>
                </span>
                <button type="button" className="act" onClick={onAddJob}>
                  {t("project.addJob")}
                </button>
              </div>
            )}
            <div className="setrow">
              <Icon name="folder" />
              <span className="grow">
                <span className="k">{t("project.folder")}</span>
                <span className="v">{project.folder}</span>
              </span>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
