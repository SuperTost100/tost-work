import { Fragment, useRef, useState } from "react";
import { ApprovalCard } from "@/components/Approval";
import { Composer } from "@/components/Composer";
import { Preview } from "@/components/Preview";
import { TaskTag } from "@/components/TaskTag";
import { Icon } from "@/lib/Icon";
import { keyed } from "@/lib/keys";
import { useT } from "@/lib/useT";
import type { SaveResult, TostWorkApi } from "../../../shared/api";
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

function FileLine({ file, onOpen }: { file: FileChange; onOpen?: () => void }) {
  const t = useT();
  return (
    <div className="fileline" title={file.path}>
      <Thumb path={file.path} />
      <span className="grow">
        <span className="nm truncate" style={{ display: "block" }}>
          {fileName(file.path)}
        </span>
      </span>
      {onOpen && (
        <button type="button" className="tbtn" onClick={onOpen}>
          <Icon name="external-link" />
          {t("preview.open")}
        </button>
      )}
    </div>
  );
}

/** Under a file the task replaced: the kept copy and a button to put it back, or to undo that. */
function KeptRow({
  task,
  path,
  onRestore,
}: {
  task: TaskT;
  path: string;
  onRestore: (path: string) => Promise<unknown>;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const latest = (task.kept ?? []).filter((k) => k.path === path).at(-1);
  if (!latest) return null;
  const restored = latest.reason === "restore";
  const busy = task.status === "running" || task.status === "needs-you";
  return (
    <div className="kept">
      <Icon name="history" />
      <span className="grow" role={error ? "alert" : undefined}>
        {error ?? (restored ? t("kept.restored") : t("kept.note"))}
      </span>
      <button
        type="button"
        className="tbtn"
        disabled={busy}
        onClick={() => {
          setError(null);
          onRestore(path).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
        }}
      >
        {restored ? t("kept.undo") : t("kept.restore")}
      </button>
    </div>
  );
}

/** The quick edit's side panel: the files it changed, and Save a copy, which asks for a folder every time. */
function WhatChanged({
  api,
  task,
  made,
  live,
  onSaveCopy,
  onError,
  onRestore,
}: {
  api: TostWorkApi;
  task: TaskT;
  made: FileChange[];
  live: boolean;
  onSaveCopy: () => Promise<SaveResult | null>;
  onError: (err: unknown) => void;
  onRestore: (path: string) => Promise<unknown>;
}) {
  const t = useT();
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const edited = made.filter((f) => f.kind === "update");
  const added = made.filter((f) => f.kind === "add");
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await onSaveCopy();
      if (result?.saved.length) setSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  const group = (title: string, files: FileChange[]) =>
    files.length > 0 && (
      <>
        <h3>{title}</h3>
        {files.map((f) => (
          <Fragment key={f.path}>
            <FileLine file={f} onOpen={() => void api.files.open(task.id, f.path).catch(onError)} />
            <KeptRow task={task} path={f.path} onRestore={onRestore} />
          </Fragment>
        ))}
      </>
    );
  return (
    <aside className="wc">
      <div className="head">
        <b className="grow">{t("quick.changed")}</b>
      </div>
      <div className="body">
        {made.length === 0 && (
          <p className="t3" style={{ fontSize: 13, marginTop: 14 }}>
            {t("task.noFiles")}
          </p>
        )}
        {group(t("quick.edited"), edited)}
        {group(t("quick.new"), added)}
      </div>
      <div className="foot2">
        <span className="t3 grow truncate" style={{ fontSize: 13 }} role="status" title={saved?.folder}>
          {error ?? (saved ? t("quick.saved", { folder: saved.folder }) : t("quick.original"))}
        </span>
        <button
          type="button"
          className="btn dark"
          disabled={live || saving || made.length === 0}
          onClick={() => void save()}
        >
          <Icon name="download-2" />
          {t("quick.save")}
        </button>
      </div>
    </aside>
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

function Artifact({
  api,
  task,
  files,
  onError,
}: {
  api: TostWorkApi;
  task: TaskT;
  files: FileChange[];
  onError: (err: unknown) => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);
  // Follow the newest file while the task writes, unless the user picked one.
  const current = files.find((f) => f.path === picked) ?? files[files.length - 1];
  if (!current) return null;
  const live = task.status === "running" || task.status === "needs-you";
  return (
    <div className="artifact">
      <div className="head">
        {files.length > 1 ? (
          <div className="ftabs" role="tablist">
            {files.map((f) => (
              <button
                type="button"
                role="tab"
                aria-selected={f.path === current.path}
                key={f.path}
                className={f.path === current.path ? "on" : undefined}
                onClick={() => setPicked(f.path)}
              >
                {fileName(f.path)}
              </button>
            ))}
          </div>
        ) : (
          <>
            {live && <span className="t3">{t("preview.live")}</span>}
            <b>{fileName(current.path)}</b>
          </>
        )}
        <span className="grow" />
        <button
          type="button"
          className="tbtn"
          onClick={() => void api.files.reveal(task.id, current.path).catch(onError)}
        >
          <Icon name="folder-open" />
          {t("preview.reveal")}
        </button>
        <button
          type="button"
          className="tbtn"
          onClick={() => void api.files.open(task.id, current.path).catch(onError)}
        >
          <Icon name="external-link" />
          {t("preview.open")}
        </button>
      </div>
      <div className="page pv">
        <Preview api={api} taskId={task.id} path={current.path} version={task.updatedAt} />
      </div>
    </div>
  );
}

export function Task({
  api,
  task,
  project,
  onAnswer,
  onFollowUp,
  onSaveCopy,
  onDecide,
  onRestore,
  onStop,
  onOpenProject,
  onError,
}: {
  api: TostWorkApi;
  task: TaskT;
  project: Project | null;
  /** Resolves true once the answer is sent, false when it failed and the draft should stay. */
  onAnswer: (answer: string) => Promise<boolean>;
  onFollowUp: (text: string) => void;
  onSaveCopy: () => Promise<SaveResult | null>;
  onDecide: (allow: boolean) => Promise<unknown>;
  onRestore: (path: string) => Promise<unknown>;
  onStop: () => void;
  onOpenProject: () => void;
  /** Shows a failed action, such as a file that was moved before Open, in the app's alert. */
  onError: (err: unknown) => void;
}) {
  const t = useT();
  const [answer, setAnswer] = useState("");
  // One answer at a time: a second click before the first returns would be refused and shown as an error.
  const sending = useRef(false);
  const send = (text: string) => {
    if (sending.current) return;
    sending.current = true;
    // Once the answer is in, the draft goes, unless it was edited while the answer was sending.
    const draft = answer;
    void onAnswer(text).then((sent) => {
      sending.current = false;
      if (sent) setAnswer((current) => (current === draft ? "" : current));
    });
  };
  const [message, setMessage] = useState("");
  // A task without a project is a quick edit: it works on copies in a temporary folder until the user saves.
  const quick = task.projectId === null;
  const made = task.files.filter((f) => f.role === "made");
  const used = task.files.filter((f) => f.role === "used");
  const current = task.steps.findIndex((s) => s.status === "in_progress");
  const live = task.status === "running" || task.status === "needs-you";
  // The steps belong to the latest run, so after a follow-up they show under that instruction.
  const runStart = task.messages.findLastIndex((m) => m.followUp);
  const note = (i: number) => {
    const m = task.messages[i];
    if (!m) return null;
    return m.from === "user" ? (
      <div className="you" style={{ marginTop: 18 }} key={i}>
        {m.text}
      </div>
    ) : (
      <p className="agent" key={i}>
        {m.text}
      </p>
    );
  };
  const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => note(from + k));
  const end = task.messages.length;

  return (
    <div className="main">
      <div className="top">
        <span className="crumb">
          {quick && (
            <>
              <b>{t("quick.title")}</b>
              <span className="t3 truncate">
                · {t("quick.notInProject", { name: task.attachments[0] ? fileName(task.attachments[0]) : task.title })}
              </span>
            </>
          )}
          {project && (
            <>
              <button type="button" className="link" onClick={onOpenProject}>
                {project.name}
              </button>
              <span className="t3">/</span>
            </>
          )}
          {!quick && <b>{task.title}</b>}
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
      <div className={quick ? "qe" : "task"}>
        <div className="mid">
          <div className="scroll">
            <div className="col">
              <div className="you">
                {task.brief}
                {task.attachments.length > 0 && (
                  <div className="outs" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                    {task.attachments.map((path) => (
                      <span className="out" key={path}>
                        <Icon name="file" />
                        {fileName(path)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {runStart > 0 && range(1, runStart + 1)}
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
              {range(runStart > 0 ? runStart + 1 : 1, end)}
              {made.length > 0 && <Artifact api={api} task={task} files={made} onError={onError} />}
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
                    send(answer.trim());
                  }}
                  placeholder={t("composer.answer")}
                  sendLabel={t("composer.start")}
                  minHeight={44}
                >
                  <div className="q">{task.question.text}</div>
                  {task.question.options.map((option, i) => (
                    <button type="button" key={option} className="o" onClick={() => send(option)}>
                      <span className="n">{i + 1}</span>
                      {option}
                    </button>
                  ))}
                </Composer>
              ) : task.approval ? (
                <ApprovalCard approval={task.approval} t={t} onDecide={onDecide} />
              ) : (
                <Composer
                  value={live ? "" : message}
                  onChange={setMessage}
                  onSubmit={() => {
                    onFollowUp(message.trim());
                    setMessage("");
                  }}
                  placeholder={live ? t("composer.busy") : quick ? t("composer.another") : t("composer.followup")}
                  sendLabel={t("composer.send")}
                  disabled={live}
                  minHeight={44}
                />
              )}
            </div>
          </div>
        </div>
        {quick ? (
          <WhatChanged
            api={api}
            task={task}
            made={made}
            live={live}
            onSaveCopy={onSaveCopy}
            onRestore={onRestore}
            onError={onError}
          />
        ) : (
          <aside className="rp">
            <div className="body">
              <h3>{t("task.made")}</h3>
              {made.length === 0 && (
                <p className="t3" style={{ fontSize: 13 }}>
                  {t("task.noFiles")}
                </p>
              )}
              {made.map((f) => (
                <Fragment key={f.path}>
                  <FileLine file={f} />
                  <KeptRow task={task} path={f.path} onRestore={onRestore} />
                </Fragment>
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
        )}
      </div>
    </div>
  );
}
