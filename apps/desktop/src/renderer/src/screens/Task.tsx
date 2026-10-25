import { useState } from "react";
import { Composer } from "@/components/Composer";
import { TaskTag } from "@/components/TaskTag";
import { Icon } from "@/lib/Icon";
import { keyed } from "@/lib/keys";
import { useT } from "@/lib/useT";
import type { FileChange, Project, ReviewItem, Task as TaskT } from "../../../shared/model";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const isSheet = (path: string) => /\.(xlsx|xls|csv)$/i.test(path);
const CELLS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

function Thumb({ path }: { path: string }) {
  return isSheet(path) ? (
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

function FileLine({ file }: { file: FileChange }) {
  return (
    <div className="fileline" title={file.path}>
      <Thumb path={file.path} />
      <span className="grow">
        <span className="nm truncate" style={{ display: "block" }}>
          {fileName(file.path)}
        </span>
      </span>
    </div>
  );
}

function Checks({ title, items, icon }: { title: string; items: ReviewItem[]; icon: string }) {
  if (!items.length) return null;
  return (
    <>
      <div className="grp-k">{title}</div>
      {keyed(items, (item) => item.text).map(([key, item]) => (
        <div className="chk" key={key}>
          <Icon name={icon} className={icon === "check" ? "ok" : undefined} />
          <span>
            {item.text}
            {item.detail && <span className="sub">{item.detail}</span>}
          </span>
          <span />
        </div>
      ))}
    </>
  );
}

export function Task({
  task,
  project,
  onAnswer,
  onStop,
  onOpenProject,
}: {
  task: TaskT;
  project: Project | null;
  /** Resolves true once the answer is sent, false when it failed and the draft should stay. */
  onAnswer: (answer: string) => Promise<boolean>;
  onStop: () => void;
  onOpenProject: () => void;
}) {
  const t = useT();
  const [answer, setAnswer] = useState("");
  const made = task.files.filter((f) => f.role === "made");
  const used = task.files.filter((f) => f.role === "used");
  const current = task.steps.findIndex((s) => s.status === "in_progress");
  const live = task.status === "running" || task.status === "needs-you";
  const agentNotes = task.messages.slice(1);

  return (
    <div className="main">
      <div className="top">
        <span className="crumb">
          {project && (
            <>
              <button type="button" className="link" onClick={onOpenProject}>
                {project.name}
              </button>
              <span className="t3">/</span>
            </>
          )}
          <b>{task.title}</b>
        </span>
        <span className="grow" />
        <TaskTag task={task} />
        {live && (
          <button type="button" className="tbtn" onClick={onStop}>
            <Icon name="stop" />
            {t("task.stop")}
          </button>
        )}
      </div>
      <div className="task">
        <div className="mid">
          <div className="scroll">
            <div className="col">
              <div className="you">{task.brief}</div>
              {task.steps.length > 0 && (
                <div className="steps">
                  {live && current >= 0 && (
                    <p className="t3" style={{ fontSize: 13, margin: 0 }}>
                      {t("task.step", { n: String(current + 1), total: String(task.steps.length) })}
                    </p>
                  )}
                  {keyed(task.steps, (s) => s.text).map(([key, s]) => (
                    <div key={key} className={s.status === "in_progress" ? "now" : undefined}>
                      <Icon name={s.status === "done" ? "check" : s.status === "in_progress" ? "pencil" : "time"} />
                      {s.text}
                    </div>
                  ))}
                </div>
              )}
              {keyed(agentNotes, (m) => `${m.from}:${m.at}`).map(([key, m]) =>
                m.from === "user" ? (
                  <div className="you" style={{ marginTop: 18 }} key={key}>
                    {m.text}
                  </div>
                ) : (
                  <p className="agent" key={key}>
                    {m.text}
                  </p>
                ),
              )}
              {task.status === "stopped" && <p className="agent t3">{t("task.stopped")}</p>}
              {task.status === "failed" && <p className="agent">{t("task.failed", { error: task.error ?? "" })}</p>}
              {task.review && (
                <>
                  <div className="check-h">
                    <b>{t("task.review")}</b>
                  </div>
                  <Checks title={t("task.asked")} items={task.review.asked} icon="check" />
                  <Checks title={t("task.decided")} items={task.review.decided} icon="question" />
                  <Checks title={t("task.checkYourself")} items={task.review.checkYourself} icon="eye-2" />
                </>
              )}
            </div>
          </div>
          <div className="foot">
            <div className="col">
              {task.question ? (
                <Composer
                  className="asking"
                  value={answer}
                  onChange={setAnswer}
                  onSubmit={() => {
                    void onAnswer(answer.trim()).then((sent) => sent && setAnswer(""));
                  }}
                  placeholder={t("composer.answer")}
                  sendLabel={t("composer.start")}
                  minHeight={44}
                >
                  <div className="q">{task.question.text}</div>
                  {task.question.options.map((option, i) => (
                    <button type="button" key={option} className="o" onClick={() => void onAnswer(option)}>
                      <span className="n">{i + 1}</span>
                      {option}
                    </button>
                  ))}
                </Composer>
              ) : (
                <Composer
                  value=""
                  onChange={() => {}}
                  onSubmit={() => {}}
                  placeholder={t("composer.followup")}
                  sendLabel={t("composer.start")}
                  disabled
                  minHeight={44}
                />
              )}
            </div>
          </div>
        </div>
        <aside className="rp">
          <div className="body">
            <h3>{t("task.made")}</h3>
            {made.length === 0 && (
              <p className="t3" style={{ fontSize: 13 }}>
                {t("task.noFiles")}
              </p>
            )}
            {made.map((f) => (
              <FileLine key={f.path} file={f} />
            ))}
            {used.length > 0 && <h3>{t("task.used")}</h3>}
            {used.map((f) => (
              <FileLine key={f.path} file={f} />
            ))}
            <h3>{t("task.settings")}</h3>
            <div className="setrow">
              <Icon name="chip" />
              <span className="grow">
                <span className="k">{t("task.model")}</span>
                <span className="v">
                  {task.model} · {task.effort}
                </span>
              </span>
            </div>
            <div className="setrow">
              <Icon name="folder" />
              <span className="grow">
                <span className="k">{t("task.savesTo")}</span>
                <span className="v">{project?.folder ?? t("task.tempFolder")}</span>
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
