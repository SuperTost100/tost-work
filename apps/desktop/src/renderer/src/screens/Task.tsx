import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApprovalCard } from "@/components/Approval";
import { type Attachments, Composer } from "@/components/Composer";
import { FileLine, fileName } from "@/components/FileLine";
import { Preview } from "@/components/Preview";
import { ProjectPicker } from "@/components/ProjectPicker";
import { TaskTag } from "@/components/TaskTag";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { keyed } from "@/lib/keys";
import { withShortcut } from "@/lib/shortcut";
import { useT } from "@/lib/useT";
import { RenameField } from "@/shell/Sidebar";
import type { NewTaskInput, SaveResult, TostWorkApi } from "../../../shared/api";
import type { MessageKey } from "../../../shared/i18n";
import {
  type Activity,
  type ActivityKind,
  type AnsweredQuestion,
  ATTACH_MAX,
  answersText,
  BRIEF_MAX,
  type FileChange,
  type Project,
  type Question,
  questionItems,
  type ReviewItem,
  type Task as TaskT,
  toReview,
} from "../../../shared/model";
import { AgentMessage, CopyButton, TypedMessage } from "../components/AgentMessage";
import { WorkingDots } from "../components/TaskTag";

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
  const [restoring, setRestoring] = useState(false);
  const copies = (task.kept ?? []).filter((k) => k.path === path);
  if (copies.length === 0) return null;
  // Each restore swaps the file with its last kept copy, so an odd number of restores since the agent's last
  // overwrite means the older version is in place.
  const sinceOverwrite = copies.length - 1 - copies.map((k) => k.reason).lastIndexOf("overwrite");
  const restored = sinceOverwrite % 2 === 1;
  const busy = restoring || task.status === "running" || task.status === "needs-you";
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
          setRestoring(true);
          onRestore(path)
            .catch((err: unknown) => setError(errorText(err)))
            .finally(() => setRestoring(false));
        }}
      >
        {restored ? t("kept.undo") : t("kept.restore")}
      </button>
    </div>
  );
}

/** The skills a task read, by title; nothing when it read none. */
function SkillsFollowed({ names = [], titles }: { names?: string[]; titles: Map<string, string> }) {
  const t = useT();
  if (names.length === 0) return null;
  return (
    <>
      <h3>{t("task.skills")}</h3>
      {names.map((name) => (
        <div className="setrow" key={name}>
          <Icon name="magic-2" />
          <span className="grow truncate">{titles.get(name) ?? name.replace(/^@/, "")}</span>
        </div>
      ))}
    </>
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
  skillTitles,
}: {
  api: TostWorkApi;
  task: TaskT;
  made: FileChange[];
  live: boolean;
  onSaveCopy: () => Promise<SaveResult | null>;
  onError: (err: unknown) => void;
  onRestore: (path: string) => Promise<unknown>;
  /** Titles of the skills the task read, by name. */
  skillTitles: Map<string, string>;
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
      setError(errorText(err));
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
            <FileLine path={f.path} onOpen={() => void api.files.open(task.id, f.path).catch(onError)} />
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
          <p className="empty" style={{ marginTop: 14 }}>
            {t("task.noFiles")}
          </p>
        )}
        {group(t("quick.edited"), edited)}
        {group(t("quick.new"), added)}
        <SkillsFollowed names={task.skillsUsed} titles={skillTitles} />
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

const ACTIVITY_ICON: Record<ActivityKind, string> = {
  read: "eye-2",
  write: "file-new",
  edit: "pencil",
  folder: "folder-open",
  "search-files": "search",
  web: "world-2",
  page: "web",
  command: "terminal-box",
  work: "file",
  skill: "magic-2",
  pdf: "file",
  helper: "group",
  note: "chat-3",
};
/** Kinds whose line names a file, search or site, and has a plainer line when it doesn't. */
const HAS_TARGET = new Set<ActivityKind>(["read", "write", "edit", "web", "page", "work", "skill", "helper"]);

/** One line of activity in the user's language: "Leggo note.txt". */
function useActivityText() {
  const t = useT();
  return (a: Activity) =>
    HAS_TARGET.has(a.kind) && !a.target
      ? t(`activity.${a.kind}.any` as MessageKey)
      : // A built-in guide is recorded as @word; the line says word.
        t(`activity.${a.kind}` as MessageKey, { target: (a.target ?? "").replace(/^@/, "") });
}

/**
 * The activity split by where it happened: the lines for message `i` came after the message before it, so they show
 * just above it, and the tail came after the last message. Lines from before positions were kept are `older`: they
 * show at the end too, but never as live, since they may be an earlier run's.
 */
export function activityByMessage(
  activity: Activity[],
  messages: number,
): { before: Activity[][]; tail: Activity[]; older: Activity[] } {
  const before: Activity[][] = Array.from({ length: messages }, () => []);
  const tail: Activity[] = [];
  const older: Activity[] = [];
  for (const a of activity) {
    if (a.msg === undefined) older.push(a);
    else if (a.msg >= messages) tail.push(a);
    // The brief is message 0, so nothing can come before it.
    else before[Math.max(1, a.msg)]?.push(a);
  }
  return { before, tail, older };
}

/**
 * What the agent has written of its next answer so far, while it runs. It starts from what the main process has
 * gathered, so a task opened mid-answer shows the start too, and ends when the answer arrives as a message.
 */
function useDraft(api: TostWorkApi, taskId: string, messages: number, running: boolean): string {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    let alive = true;
    // Through the same channel as the words, so the words after a note can't arrive before the clearing.
    const off = api.tasks.onText((id, text, restart) => id === taskId && setDraft((d) => (restart ? text : d + text)));
    void api.tasks.draft(taskId).then((d) => alive && setDraft(d));
    return () => {
      alive = false;
      off();
    };
  }, [api, taskId]);
  // A new message, or the run ending, clears it.
  const [ended, setEnded] = useState({ messages, running });
  if (ended.messages !== messages || ended.running !== running) {
    setEnded({ messages, running });
    setDraft("");
  }
  return running ? draft : "";
}

/** Lines of activity shown while the agent works; the rest are counted above them. */
const LIVE_LINES = 5;

/**
 * What the agent is doing, a line per action, so the user can see it's at work. While it runs the latest lines show;
 * afterwards they fold into one line, like an answered round, that opens onto all of them.
 */
function ActivityLog({
  activity,
  live,
  waiting,
}: {
  activity: Activity[];
  live: boolean;
  /** What the agent waits for from the user, as the last line: it's what it's doing now. */
  waiting?: "question" | "approval";
}) {
  const t = useT();
  const say = useActivityText();
  // Unless the user chose, it's open while the agent works and folded once it's done.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? live;
  const lines = live ? activity.slice(-LIVE_LINES) : activity;
  const earlier = activity.length - lines.length;
  return (
    <div className="answered activity">
      <button type="button" aria-expanded={open} onClick={() => setChosen(!open)}>
        <Icon name="history" />
        {live ? t("activity.live") : t("activity.done", { n: String(activity.length) })}
        <Icon name="down" className="chev" />
      </button>
      {open && (
        <ol aria-live={live ? "polite" : undefined}>
          {earlier > 0 && <li className="t3">{t("activity.earlier", { n: String(earlier) })}</li>}
          {keyed(lines, (a) => `${a.kind} ${a.target ?? ""} ${a.at}`).map(([key, a]) => (
            <li key={key}>
              <Icon name={ACTIVITY_ICON[a.kind]} />
              {a.kind === "note" ? (
                <span className="note" title={a.target}>
                  {a.target}
                </span>
              ) : (
                <span className="truncate">{say(a)}</span>
              )}
            </li>
          ))}
          {/* Screen readers hear this from the announcement above the composer, so once is enough. */}
          {waiting && (
            <li aria-hidden="true">
              <Icon name={waiting === "question" ? "question" : "shield"} />
              <span className="truncate">{t(waiting === "question" ? "activity.asking" : "activity.approval")}</span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

/**
 * Shows that the agent is still at work, above the composer, where it stays in view however far the user scrolled.
 * What it's doing is in the log above, so it isn't repeated here.
 */
function Working() {
  const t = useT();
  return (
    <div className="working" role="status">
      <WorkingDots />
      <span className="truncate">{t("task.working")}</span>
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

/**
 * A round of questions, one at a time: an option or the user's own words answers it and moves on, and the last answer
 * sends the whole round as one message. A single question sends at once, as before rounds.
 */
function QuestionCard({
  question,
  draft,
  onDraft,
  onSend,
  attach,
}: {
  question: Question;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (answers: string[]) => void;
  /** Files sent with the round's answers. */
  attach: Attachments;
}) {
  const t = useT();
  const items = questionItems(question);
  const [answers, setAnswers] = useState<string[]>([]);
  // What's in the box for each question, so stepping back and forth never loses text not sent yet.
  const [drafts, setDrafts] = useState<string[]>([]);
  const [at, setAt] = useState(0);
  const [tooLong, setTooLong] = useState(false);
  // After Next or Back the old question's buttons are gone, so keyboard focus moves to the new question: its block
  // is keyed by the question, so it mounts again and takes focus. The callback is stable, so typing (which renders
  // the card again) doesn't pull focus out of the box.
  const moved = useRef(false);
  const takeFocus = useCallback((el: HTMLDivElement | null) => {
    if (el && moved.current) el.focus();
  }, []);
  const item = items[at] ?? items[0];
  if (!item) return null;
  const go = (to: number, given: string[], picked = false) => {
    const kept = [...drafts];
    // An option picked replaces what was typed for that question.
    kept[at] = picked ? "" : draft;
    moved.current = true;
    setDrafts(kept);
    setAt(to);
    // An answer in the user's own words goes back in the box; a picked option shows as picked instead.
    const before = given[to] ?? "";
    onDraft(kept[to] ?? (items[to]?.options.includes(before) ? "" : before));
  };
  // Stepping away with new words in the box makes them that question's answer, as the send button would, so a changed
  // answer is never left behind in the box while the old one goes.
  const step = (to: number) => {
    const typed = draft.trim();
    if (!typed || typed === answers[at]) return go(to, answers);
    const next = [...answers];
    next[at] = typed;
    setAnswers(next);
    go(to, next);
  };
  const answer = (text: string, picked = false) => {
    const next = [...answers];
    next[at] = text;
    setAnswers(next);
    if (at < items.length - 1) return go(at + 1, next, picked);
    const message = answersText(question, next);
    // Each box has the message limit, but a round's answers go together, so the whole has to fit too.
    setTooLong(message.length > BRIEF_MAX);
    if (message.length > BRIEF_MAX) return;
    // A picked option replaces what was typed, so a retry after a failed send can't bring the old text back.
    if (picked) onDraft("");
    onSend(next);
  };
  return (
    <Composer
      className="asking"
      value={draft}
      onChange={onDraft}
      onSubmit={() => answer(draft.trim())}
      placeholder={t("composer.answer")}
      sendLabel={t(at < items.length - 1 ? "task.nextQuestion" : "composer.start")}
      minHeight={44}
      attach={attach}
    >
      <div className="q" key={at} ref={takeFocus} tabIndex={-1}>
        {items.length > 1 && (
          <span className="qnav">
            <span className="grow">{t("task.questionOf", { n: String(at + 1), total: String(items.length) })}</span>
            <button
              type="button"
              className="iconbtn"
              aria-label={t("task.questionBack")}
              title={t("task.questionBack")}
              disabled={at === 0}
              onClick={() => step(at - 1)}
            >
              <Icon name="left" />
            </button>
            {/* Forward only over questions already answered: an open one is answered with the box or an option. */}
            <button
              type="button"
              className="iconbtn"
              aria-label={t("task.questionForward")}
              title={t("task.questionForward")}
              disabled={at === items.length - 1 || answers[at] === undefined}
              onClick={() => step(at + 1)}
            >
              <Icon name="right" />
            </button>
          </span>
        )}
        {item.text}
        {tooLong && (
          <span className="d err" role="alert">
            {t("task.roundTooLong", { max: BRIEF_MAX.toLocaleString() })}
          </span>
        )}
      </div>
      {item.options.map((option, i) => (
        <button
          type="button"
          key={option}
          className={answers[at] === option ? "o on" : "o"}
          aria-pressed={items.length > 1 ? answers[at] === option : undefined}
          onClick={() => answer(option, true)}
        >
          <span className="n">{i + 1}</span>
          {option}
        </button>
      ))}
    </Composer>
  );
}

/**
 * A round of questions the user answered: one grey line between the agent's messages, like the steps, that opens to
 * show each question with its answer.
 */
/** The files attached to one of the user's messages, under its text. */
function AttachedFiles({ paths = [] }: { paths?: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div className="outs" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
      {paths.map((path) => (
        <span className="out" key={path}>
          <Icon name="file" />
          {fileName(path)}
        </span>
      ))}
    </div>
  );
}

/** The files the brief came with, for tasks made before the first message kept its own: the task's, less those
 * attached to later messages. */
const firstFiles = (task: TaskT) => {
  const later = new Set(task.messages.flatMap((m) => m.attachments ?? []));
  return task.attachments.filter((p) => !later.has(p));
};

function AnswerLine({ answers, files }: { answers: AnsweredQuestion[]; files?: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="answered">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="question" />
        {answers.length === 1 ? t("task.answeredOne") : t("task.answered", { n: String(answers.length) })}
        <Icon name="down" className="chev" />
      </button>
      {open && (
        <ol>
          {keyed(answers, (a) => a.question).map(([key, a]) => (
            <li key={key}>
              <span className="q">{a.question}</span>
              <span className="a">
                <LongText text={a.answer} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <AttachedFiles paths={files} />
    </div>
  );
}

/** Characters of a message shown before the rest folds away behind "Show all". */
const FOLD_AT = 1200;

/** A message the user wrote, folded when it's long, such as a pasted email. */
function LongText({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (text.length <= FOLD_AT) return <>{text}</>;
  return (
    <>
      {open ? text : `${text.slice(0, FOLD_AT).trimEnd()}…`}{" "}
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t(open ? "task.showLess" : "task.showAll")}
      </button>
    </>
  );
}

function Artifact({
  api,
  task,
  files,
  picked,
  onPick,
  onError,
}: {
  api: TostWorkApi;
  task: TaskT;
  files: FileChange[];
  /** The file the user chose, here or in the side panel; null follows the newest. */
  picked: string | null;
  onPick: (path: string) => void;
  onError: (err: unknown) => void;
}) {
  const t = useT();
  const setPicked = onPick;
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
                // The whole path, so two files with the same name in different folders can be told apart.
                title={f.path}
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
        <Preview
          api={api}
          taskId={task.id}
          path={current.path}
          version={task.updatedAt}
          writing={task.status === "running"}
        />
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
  onResume,
  onStartSaved,
  onMarkReviewed,
  onOpenProject,
  onError,
  renaming = false,
  onRenamed,
  projects,
  allowNoProject,
  onNewProject,
  onSaveDraft,
}: {
  api: TostWorkApi;
  task: TaskT;
  project: Project | null;
  /** Resolves true once the answer is sent, false when it failed and the draft should stay. */
  onAnswer: (answers: string[], files: string[]) => Promise<boolean>;
  /** Resolves true once the instruction is sent, false when it failed and the box should keep it. */
  onFollowUp: (text: string, files: string[]) => Promise<boolean>;
  onSaveCopy: () => Promise<SaveResult | null>;
  onDecide: (allow: boolean) => Promise<unknown>;
  onRestore: (path: string) => Promise<unknown>;
  onStop: () => void;
  /** Carries on with a task that stopped when Tost Work closed. */
  onResume: () => void;
  /** Starts a task the user saved for later. */
  onStartSaved: () => void;
  /** Marks the finished work as looked at, so it's no longer "to review". */
  onMarkReviewed: () => void;
  onOpenProject: () => void;
  /** Shows a failed action, such as a file that was moved before Open, in the app's alert. */
  onError: (err: unknown) => void;
  /** The menu bar's Rename, for a task Recent doesn't show: its title in the header becomes the field. */
  renaming?: boolean;
  onRenamed?: (title: string | null) => void;
  /** For a task saved for later, the projects its box can move it to, as on the home. */
  projects: Project[];
  allowNoProject: boolean;
  onNewProject: () => void;
  /** Saves the edits to a task saved for later. Resolves true once saved, false when it failed. */
  onSaveDraft: (edit: NewTaskInput) => Promise<boolean>;
}) {
  const t = useT();
  const [answer, setAnswer] = useState("");
  // Files for the answers and for the next instruction, each sent with its own message.
  const [answerFiles, setAnswerFiles] = useState<string[]>([]);
  const [messageFiles, setMessageFiles] = useState<string[]>([]);
  const attach = (files: string[], set: (update: (prev: string[]) => string[]) => void): Attachments => ({
    files,
    onAdd: () =>
      void api.files
        .pick()
        .then((picked) => set((prev) => [...new Set([...prev, ...picked])].slice(0, ATTACH_MAX)))
        .catch(onError),
    onRemove: (path) => set((prev) => prev.filter((p) => p !== path)),
  });
  // One answer at a time: a second click before the first returns would be refused and shown as an error.
  const sending = useRef(false);
  const send = (answers: string[]) => {
    if (sending.current) return;
    sending.current = true;
    // Once the answer is in, the draft and files go, unless they changed while the answer was sending.
    const draft = answer;
    const files = answerFiles;
    void onAnswer(answers, files).then((sent) => {
      sending.current = false;
      if (!sent) return;
      setAnswer((current) => (current === draft ? "" : current));
      setAnswerFiles((current) => (current === files ? [] : current));
    });
  };
  const [message, setMessage] = useState("");
  const followSending = useRef(false);
  // A task without a project is a quick edit: it works on copies in a temporary folder until the user saves.
  const quick = task.projectId === null;
  const made = task.files.filter((f) => f.role === "made");
  const draft = useDraft(api, task.id, task.messages.length, task.status === "running");
  // How much of the draft shows, for the message it becomes: that one types on from there instead of starting over.
  const draftShown = useRef({ at: -1, n: 0 });
  // The newest answer, when it came while the task was open: it types out rather than appearing at once.
  const [seen, setSeen] = useState(task.messages.length);
  const [typing, setTyping] = useState<{ index: number; from: number } | null>(null);
  if (seen !== task.messages.length) {
    const index = task.messages.length - 1;
    const last = task.messages[index];
    setSeen(task.messages.length);
    setTyping(
      task.messages.length > seen && last?.from === "agent" && !last.answers
        ? { index, from: draftShown.current.at === index ? draftShown.current.n : 0 }
        : null,
    );
  }
  // Typing follows the text down the page while the user is at the bottom; scrolling up leaves them there.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // Set when a run ends with the user at the bottom: the page then holds the start of the last answer at its top.
  const settled = useRef(false);
  const follow = useCallback(() => {
    const el = scroller.current;
    if (el && pinned.current && !settled.current) el.scrollTop = el.scrollHeight;
  }, []);
  const followDraft = useCallback(
    (n: number) => {
      draftShown.current = { at: task.messages.length, n };
      follow();
    },
    [task.messages.length, follow],
  );
  // What the task worked from: the files the user attached, then any other file it reports reading, unless it
  // changed them. Only the attached ones say so.
  const notMade = (path: string) => !made.some((f) => f.path === path);
  const used = [
    ...task.attachments.filter(notMade).map((path) => ({ path, attached: true })),
    ...task.files
      .filter((f) => f.role === "used" && !task.attachments.includes(f.path) && notMade(f.path))
      .map((f) => ({ path: f.path, attached: false })),
  ];
  const [picked, setPicked] = useState<string | null>(null);
  // The skills the task read, by folder name, shown by their titles.
  // A Map, so a folder named like an object property ("constructor") isn't taken for a title.
  const [skillTitles, setSkillTitles] = useState(() => new Map<string, string>());
  const usedCount = task.skillsUsed?.length ?? 0;
  useEffect(() => {
    if (usedCount === 0) return;
    let alive = true;
    api.skills.list().then(
      (list) => alive && setSkillTitles(new Map(list.map((s) => [s.id, s.title]))),
      // Without the list, the folder names show instead.
      () => alive && setSkillTitles(new Map()),
    );
    return () => {
      alive = false;
    };
  }, [api, usedCount]);
  const showFile = (path: string) => {
    setPicked(path);
    document.querySelector(".artifact")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };
  const current = task.steps.findIndex((s) => s.status === "in_progress");
  const live = task.status === "running" || task.status === "needs-you";
  // When a run ends, its file and review come in under its last answer, and the bottom of the page would show them
  // first. The answer is what to read first, so its start goes to the top of the page, unless the user scrolled away.
  // A run can end in the same update that brings its last messages, so either counts.
  const lastSeen = useRef({ live, messages: task.messages.length });
  // Before the browser paints, so the file never shows first and then jumps away.
  useLayoutEffect(() => {
    const ended = !live && (lastSeen.current.live || task.messages.length > lastSeen.current.messages);
    lastSeen.current = { live, messages: task.messages.length };
    settled.current = !live && settled.current;
    const el = scroller.current;
    if (!ended || !el) return;
    const last = [...el.querySelectorAll<HTMLElement>(".col > :is(.msg, .answered:not(.activity))")].at(-1);
    // A run that ended without an answer has the user's own message or answers last.
    if (!last || last.matches(".mine, .answered")) return;
    const top = last.getBoundingClientRect().top;
    const box = el.getBoundingClientRect();
    // Only from the end of the page: a user reading further up stays where they are.
    if (!pinned.current && top > box.bottom) return;
    settled.current = true;
    el.scrollTop += top - box.top - 16;
  }, [live, task.messages.length]);
  const { before, tail, older } = activityByMessage(task.activity ?? [], task.messages.length);
  const waiting = task.question ? "question" : task.approval ? "approval" : undefined;
  // The check is on finished work: while it runs or waits on the user, it isn't finished. An answer in the chat has
  // nothing to check against the brief: the check is for files it made.
  const checked = task.review && !live && made.length > 0 ? task.review : null;
  // Opening the task doesn't count as looking at it: the user says when they have.
  const reviewButton = toReview(task) && (
    <button type="button" className="btn dark" onClick={onMarkReviewed}>
      <Icon name="check" />
      {t("review.mark")}
    </button>
  );
  // The steps belong to the latest run, so after a follow-up they show under that instruction.
  const runStart = task.messages.findLastIndex((m) => m.followUp);
  const note = (i: number) => {
    const m = task.messages[i];
    if (!m) return null;
    const done = before[i] ?? [];
    return (
      <Fragment key={i}>
        {done.length > 0 && <ActivityLog activity={done} live={false} />}
        {m.answers ? (
          <AnswerLine answers={m.answers} files={m.attachments} />
        ) : m.from === "user" ? (
          <div className="msg mine" style={{ marginTop: 18 }}>
            <div className="you">
              <LongText text={m.text} />
              <AttachedFiles paths={m.attachments} />
            </div>
            <CopyButton text={() => m.text} />
          </div>
        ) : typing?.index === i ? (
          <TypedMessage text={m.text} from={typing.from} onShown={follow} />
        ) : (
          <AgentMessage text={m.text} />
        )}
      </Fragment>
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
          {renaming ? (
            <RenameField title={task.title} label={t("menu.rename")} onDone={(title) => onRenamed?.(title)} />
          ) : (
            !quick && <b>{task.title}</b>
          )}
        </span>
        <span className="grow" />
        {/* While it runs, the line above the composer and Recent already say so: a third sign would be noise. */}
        {task.status !== "running" && <TaskTag task={task} />}
        {live && (
          <button type="button" className="tbtn" title={withShortcut(t("task.stop"), ".")} onClick={onStop}>
            <Icon name="stop" />
            {t("task.stop")}
          </button>
        )}
      </div>
      {task.status === "draft" ? (
        <DraftEditor
          task={task}
          projects={projects}
          allowNoProject={allowNoProject}
          onNewProject={onNewProject}
          attach={attach}
          onSave={onSaveDraft}
          onStart={onStartSaved}
        />
      ) : (
        <div className={quick ? "qe" : "task"}>
          <div className="mid">
            <div
              className="scroll"
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              }}
            >
              <div className="col">
                <div className="msg mine">
                  <div className="you">
                    <LongText text={task.brief} />
                    <AttachedFiles paths={task.messages[0]?.attachments ?? firstFiles(task)} />
                  </div>
                  <CopyButton text={() => task.brief} />
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
                {older.length > 0 && <ActivityLog key="older" activity={older} live={false} />}
                {(tail.length > 0 || waiting) && (
                  <ActivityLog key="tail" activity={tail} live={live} waiting={waiting} />
                )}
                {draft && <TypedMessage key={`draft-${end}`} text={draft} onShown={followDraft} />}
                {made.length > 0 && (
                  <Artifact api={api} task={task} files={made} picked={picked} onPick={setPicked} onError={onError} />
                )}
                {task.status === "stopped" &&
                  (task.interrupted ? (
                    <div className="agent row">
                      {/* Only the note is grey: Resume is a normal button. */}
                      <span className="grow t3">
                        {t("task.interrupted")}
                        {/* A resume that failed, for example offline, says why; Resume stays to try again. */}
                        {task.error && (
                          <>
                            <br />
                            {t("task.failed", { error: task.error })}
                          </>
                        )}
                      </span>
                      <button type="button" className="btn" onClick={onResume}>
                        {t("task.resume")}
                      </button>
                    </div>
                  ) : (
                    <p className="agent t3">{t("task.stopped")}</p>
                  ))}
                {task.status === "failed" && <p className="agent">{t("task.failed", { error: task.error ?? "" })}</p>}
                {checked ? (
                  <>
                    <div className="check-h">
                      <b>{t("task.review")}</b>
                      <span className="grow" />
                      {reviewButton}
                    </div>
                    <Checks title={t("task.asked")} items={checked.asked} icon="check" />
                    <Checks title={t("task.decided")} items={checked.decided} icon="question" />
                    <Checks title={t("task.checkYourself")} items={checked.checkYourself} icon="eye-2" />
                  </>
                ) : (
                  // Work with no check to read, such as an answer in the chat, is marked reviewed at its end.
                  reviewButton && <div className="agent row reviewed-row">{reviewButton}</div>
                )}
              </div>
              {/* In the scroller, held at its bottom: the page scrolls under the composer, and so does the scrollbar. */}
              <div className="foot">
                <div className="col">
                  {task.status === "running" && <Working />}
                  {/* Always there, so a screen reader hears when a question or approval starts waiting, log open or
                    not. */}
                  <span className="sr-only" aria-live="polite">
                    {waiting && t(waiting === "question" ? "activity.asking" : "activity.approval")}
                  </span>
                  {task.question ? (
                    <QuestionCard
                      key={task.question.id}
                      question={task.question}
                      draft={answer}
                      onDraft={setAnswer}
                      onSend={send}
                      attach={attach(answerFiles, setAnswerFiles)}
                    />
                  ) : task.approval ? (
                    <ApprovalCard approval={task.approval} t={t} onDecide={onDecide} />
                  ) : (
                    <Composer
                      value={live ? "" : message}
                      onChange={setMessage}
                      onSubmit={() => {
                        // One at a time: copying the files takes a moment, and a second Send would run it twice.
                        if (followSending.current) return;
                        followSending.current = true;
                        // Cleared once it's sent, unless the user changed them meanwhile, so a failed send keeps both.
                        const text = message;
                        const files = messageFiles;
                        void onFollowUp(text.trim(), files).then((sent) => {
                          followSending.current = false;
                          if (!sent) return;
                          setMessage((current) => (current === text ? "" : current));
                          setMessageFiles((current) => (current === files ? [] : current));
                        });
                      }}
                      placeholder={live ? t("composer.busy") : quick ? t("composer.another") : t("composer.followup")}
                      sendLabel={t("composer.send")}
                      disabled={live}
                      minHeight={44}
                      attach={attach(messageFiles, setMessageFiles)}
                    />
                  )}
                </div>
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
              skillTitles={skillTitles}
            />
          ) : (
            <aside className="rp">
              <div className="body">
                <h3>{t("task.made")}</h3>
                {made.length === 0 && <p className="empty">{t("task.noFiles")}</p>}
                {made.map((f) => (
                  <Fragment key={f.path}>
                    <FileLine path={f.path} onSelect={f.kind === "delete" ? undefined : () => showFile(f.path)} />
                    <KeptRow task={task} path={f.path} onRestore={onRestore} />
                  </Fragment>
                ))}
                {used.length > 0 && <h3>{t("task.used")}</h3>}
                {used.map(({ path, attached }) => (
                  <FileLine key={path} path={path} sub={attached ? t("task.attachedFile") : undefined} />
                ))}
                <SkillsFollowed names={task.skillsUsed} titles={skillTitles} />
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
      )}
    </div>
  );
}

/**
 * A task saved for later, open to change before it starts: the task box the home has, with the brief, its files and
 * its project. Save changes keeps them for later; Start keeps them and starts the task.
 */
function DraftEditor({
  task,
  projects,
  allowNoProject,
  onNewProject,
  attach,
  onSave,
  onStart,
}: {
  task: TaskT;
  projects: Project[];
  allowNoProject: boolean;
  onNewProject: () => void;
  attach: (files: string[], set: (update: (prev: string[]) => string[]) => void) => Attachments;
  /** Resolves true once the edit is saved, false when it failed and the box should keep it. */
  onSave: (edit: NewTaskInput) => Promise<boolean>;
  onStart: () => void;
}) {
  const t = useT();
  const [brief, setBrief] = useState(task.brief);
  const [files, setFiles] = useState(task.attachments);
  const [projectId, setProjectId] = useState(task.projectId);
  const changed =
    brief.trim() !== task.brief ||
    projectId !== task.projectId ||
    files.length !== task.attachments.length ||
    files.some((f, i) => f !== task.attachments[i]);
  // One save at a time: a second click before the first returns would save, or start, twice.
  const busy = useRef(false);
  const save = async (): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    try {
      return await onSave({ brief: brief.trim(), projectId, attachments: files });
    } finally {
      busy.current = false;
    }
  };
  // The edits go first, so the task starts with the brief as it reads now.
  const start = async () => {
    if (busy.current || (changed && !(await save()))) return;
    onStart();
  };
  return (
    <div className="scroll">
      <div className="col draft-col">
        <p className="t2 draft-note">{t("task.notStarted")}</p>
        <Composer
          value={brief}
          onChange={setBrief}
          onSubmit={() => void start()}
          placeholder={t("composer.placeholder")}
          attach={attach(files, setFiles)}
          sendLabel={t("board.start")}
          onSaveLater={() => void save()}
          laterLabel={t("draft.save")}
          laterDisabled={!changed}
        />
        <div className="under">
          <ProjectPicker
            projects={projects}
            value={projectId}
            onChange={setProjectId}
            onNewProject={onNewProject}
            allowNone={allowNoProject}
          />
        </div>
      </div>
    </div>
  );
}
