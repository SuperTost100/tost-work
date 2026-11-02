import type { MouseEvent } from "react";
import { messageHtml, messagePlain } from "@/components/AgentMessage";
import { type Attachments, Composer } from "@/components/Composer";
import { TaskTag } from "@/components/TaskTag";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import { RenameField } from "@/shell/Sidebar";
import { DESCRIPTION_MAX, type Project as ProjectT, type Task } from "../../../shared/model";

export function Project({
  project,
  tasks,
  brief,
  onBriefChange,
  onStart,
  onSaveLater,
  attach,
  onOpenTask,
  onBack,
  onAddJob,
  onMenu,
  renaming,
  onRenamed,
  describing,
  onDescribed,
  onEditInstructions,
  modelPicker,
}: {
  project: ProjectT;
  tasks: Task[];
  brief: string;
  onBriefChange: (text: string) => void;
  onStart: () => void;
  /** Saves the brief to start later; missing while the board, where it would wait, is turned off. */
  onSaveLater?: () => void;
  attach?: Attachments;
  onOpenTask: (id: string) => void;
  onBack: () => void;
  /** Opens the job builder in this project; missing while Jobs is turned off. */
  onAddJob?: () => void;
  /** Shows the project's menu. */
  onMenu: () => void;
  /** Whether the name is being edited. */
  renaming: boolean;
  /** The new name, or null when the user kept the old one. */
  onRenamed: (name: string | null) => void;
  /** Whether the description is being edited. */
  describing: boolean;
  /** The new description, possibly empty, or null when the user kept the old one. */
  onDescribed: (description: string | null) => void;
  onEditInstructions: () => void;
  /** The AI and model for the task about to start, under the task box. */
  modelPicker?: React.ReactNode;
}) {
  const t = useT();
  const mine = tasks.filter((x) => x.projectId === project.id);
  // Right-click opens the same menu as the … button, as in Finder.
  const contextMenu = (e: MouseEvent) => {
    e.preventDefault();
    onMenu();
  };
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
        <span className="grow" />
        <button
          type="button"
          className="iconbtn"
          aria-label={t("recent.more", { name: project.name })}
          title={t("recent.more", { name: project.name })}
          onClick={onMenu}
          onContextMenu={contextMenu}
        >
          <Icon name="more-1" />
        </button>
      </div>
      <div className="scroll">
        <div className="proj">
          <div>
            {renaming ? (
              <RenameField
                title={project.name}
                label={t("menu.rename")}
                onDone={(name) => onRenamed(name && name !== project.name ? name : null)}
              />
            ) : (
              <h1 onContextMenu={contextMenu}>{project.name}</h1>
            )}
            {describing ? (
              <RenameField
                title={project.description}
                label={t("project.description")}
                placeholder={t("project.describeHint")}
                className="describe"
                allowEmpty
                maxLength={DESCRIPTION_MAX}
                onDone={(text) => onDescribed(text !== null && text !== project.description ? text : null)}
              />
            ) : (
              project.description && <p className="lede">{project.description}</p>
            )}
            <Composer
              value={brief}
              onChange={onBriefChange}
              onSubmit={onStart}
              placeholder={t("composer.newIn", { name: project.name })}
              attach={attach}
              sendLabel={t("composer.start")}
              minHeight={56}
              onSaveLater={onSaveLater}
            />
            {modelPicker && <div className="under">{modelPicker}</div>}
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
            <button type="button" className="setrow press" onClick={onEditInstructions}>
              <Icon name="edit-2" />
              <span className="grow">
                <span className="k">{t("project.instructions")}</span>
                {/* The text without its Markdown marks, on one line: "- Cita le fonti" reads as "Cita le fonti". */}
                <span className="v">
                  {project.instructions
                    ? messagePlain(messageHtml(project.instructions))
                        .replace(/^\s*(?:-|\d+\.)\s+/gm, "")
                        .replace(/\s+/g, " ")
                        .trim()
                    : t("project.instructionsEmpty")}
                </span>
              </span>
              <span className="act">{t("project.edit")}</span>
            </button>
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
