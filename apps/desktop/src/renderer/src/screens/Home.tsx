import { useContext, useState } from "react";
import { approvalTitle } from "@/components/Approval";
import { type Attachments, Composer } from "@/components/Composer";
import { ProjectPicker } from "@/components/ProjectPicker";
import { TaskTag } from "@/components/TaskTag";
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
  attach,
  onOpenTask,
  onNewProject,
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
  attach?: Attachments;
  onOpenTask: (id: string) => void;
  onNewProject: () => void;
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
  const recent = tasks.slice(0, 6);
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
          />
          <div className="under">
            <ProjectPicker
              projects={projects}
              value={projectId}
              onChange={onProjectChange}
              onNewProject={onNewProject}
              allowNone={allowNoProject}
            />
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
          {recent.length > 0 && (
            <>
              <div className="sec">
                <span>{t("nav.recent")}</span>
              </div>
              {recent.map((task) => (
                <button type="button" key={task.id} className="item" onClick={() => onOpenTask(task.id)}>
                  <div className="r1">
                    <span className="ttl">{task.title}</span>
                    <TaskTag task={task} />
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
