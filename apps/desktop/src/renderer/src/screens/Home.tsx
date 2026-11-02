import { useContext, useState } from "react";
import { approvalTitle } from "@/components/Approval";
import { type Attachments, Composer } from "@/components/Composer";
import { ProjectPicker } from "@/components/ProjectPicker";
import { Icon } from "@/lib/Icon";
import { LanguageContext, useT } from "@/lib/useT";
import { greeting, homeLine } from "../../../shared/i18n";
import type { Project, Task } from "../../../shared/model";

export function Home({
  userName,
  brief,
  onBriefChange,
  projectId,
  onProjectChange,
  projects,
  tasks,
  onStart,
  onSaveLater,
  attach,
  onOpenTask,
  onStartSaved,
  onNewProject,
  modelPicker,
  allowNoProject = true,
  now = new Date(),
  line,
}: {
  userName: string;
  brief: string;
  onBriefChange: (text: string) => void;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  projects: Project[];
  tasks: Task[];
  onStart: () => void;
  /** Saves the brief to start later; missing while the board, where it would wait, is turned off. */
  onSaveLater?: () => void;
  attach?: Attachments;
  onOpenTask: (id: string) => void;
  /** Starts a task saved for later, from its row in To do. */
  onStartSaved: (id: string) => void;
  onNewProject: () => void;
  /** The AI and model for the task about to start, shown to the right of the project picker. */
  modelPicker?: React.ReactNode;
  /** Whether "No project" (a quick edit) is on offer. */
  allowNoProject?: boolean;
  now?: Date;
  /** Which line shows under the greeting, from 0 up to 1 along the list; random by default, kept while Home is open. */
  line?: number;
}) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const [randomLine] = useState(() => Math.random());
  const waiting = tasks.filter((x) => x.status === "needs-you");
  // shortcut: only the tasks saved for later among the recent ones the window keeps (50, and all of them once the
  // Board has opened); ask the main process for every one if people keep more than that waiting.
  const todo = tasks.filter((x) => x.status === "draft");
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name;
  return (
    <div className="main">
      <div className="top" />
      <div className="scroll">
        <div className="col home-col">
          <div className="hello">
            <h1>
              {greeting(lang, now.getHours(), userName)}
              <br />
              <span>{homeLine(lang, line ?? randomLine, tasks.length === 0)}</span>
            </h1>
          </div>
          <Composer
            value={brief}
            onChange={onBriefChange}
            onSubmit={onStart}
            placeholder={t("composer.placeholder")}
            attach={attach}
            sendLabel={t("composer.start")}
            onSaveLater={onSaveLater}
          />
          <div className="under">
            <ProjectPicker
              projects={projects}
              value={projectId}
              onChange={onProjectChange}
              onNewProject={onNewProject}
              allowNone={allowNoProject}
            />
            {modelPicker}
          </div>
          {waiting.map((task) => (
            <button type="button" key={task.id} className="notice" onClick={() => onOpenTask(task.id)}>
              <span className="k">
                {t("tag.needsYou")}
                {projectName(task.projectId) ? ` · ${projectName(task.projectId)}` : ""}
              </span>
              <div>
                <b>{task.title}</b>
                <p>
                  {task.question
                    ? task.question.more?.length
                      ? t("home.questions", { text: task.question.text, n: String(task.question.more.length) })
                      : task.question.text
                    : task.approval && approvalTitle(t, task.approval)}
                </p>
              </div>
            </button>
          ))}
          {todo.length > 0 && (
            <section aria-labelledby="home-todo">
              <div className="sec">
                <span id="home-todo">{t("board.group.draft")}</span>
              </div>
              {todo.map((task) => (
                <div key={task.id} className="item todo">
                  {/* The row opens the task, to change it first; Start beside it starts it as it is. */}
                  <button type="button" className="open" onClick={() => onOpenTask(task.id)}>
                    <span className="ttl truncate">{task.title}</span>
                    <span className="where t3 truncate">{projectName(task.projectId) ?? t("quick.title")}</span>
                  </button>
                  <button
                    type="button"
                    className="btn"
                    aria-label={`${t("board.start")}: ${task.title}`}
                    onClick={() => onStartSaved(task.id)}
                  >
                    <Icon name="play" />
                    {t("board.start")}
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
