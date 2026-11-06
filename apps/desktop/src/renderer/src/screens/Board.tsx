import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { type DragEvent, type MouseEvent, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { approvalTitle } from "@/components/Approval";
import { FileLine, fileName, Thumb } from "@/components/FileLine";
import { TaskTag } from "@/components/TaskTag";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { LanguageContext, useT } from "@/lib/useT";
import { RenameField } from "@/shell/Sidebar";
import type { TostWorkApi } from "../../../shared/api";
import type { MessageKey } from "../../../shared/i18n";
import { updatedText } from "../../../shared/jobText";
import {
  type BoardGroup,
  type BoardView,
  BRIEF_MAX,
  type Decision,
  type Project,
  type Settings,
  type Task,
  toReview,
} from "../../../shared/model";

/** Finished tasks older than this wait behind "Show older", so the board stays about what's current. */
const RECENT_DAYS = 7;

type Filter = "all" | "needsYou" | "running" | "toReview" | "jobs";
const FILTERS: Filter[] = ["all", "needsYou", "running", "toReview", "jobs"];
const PASSES: Record<Filter, (task: Task) => boolean> = {
  all: () => true,
  needsYou: (x) => x.status === "needs-you",
  running: (x) => x.status === "running",
  toReview,
  jobs: (x) => Boolean(x.jobId),
};

/** Where a task sits on the board. Failed and stopped tasks share one place, after the finished ones. */
type Place = "needs-you" | "running" | "draft" | "toReview" | "done" | "stopped";
const placeOf = (task: Task): Place =>
  task.status === "failed" ? "stopped" : task.status === "done" && toReview(task) ? "toReview" : task.status;

/** The list's status groups. Work to review is finished work, so it sits with the rest of Done. */
const LIST_GROUPS: { places: Place[]; label: MessageKey }[] = [
  { places: ["needs-you"], label: "board.group.needsYou" },
  { places: ["running"], label: "board.group.running" },
  { places: ["draft"], label: "board.group.draft" },
  { places: ["toReview", "done"], label: "board.group.recent" },
  { places: ["stopped"], label: "board.group.stopped" },
];
/**
 * The columns, in the order work moves through them. To review has its own column so a card can be dragged from it
 * onto Done. Stopped shows only when it has something.
 */
const COLUMNS: { place: Place; label: MessageKey }[] = [
  { place: "draft", label: "board.group.draft" },
  { place: "running", label: "board.group.running" },
  { place: "needs-you", label: "board.group.needsYou" },
  { place: "toReview", label: "board.group.toReview" },
  { place: "done", label: "board.group.done" },
  { place: "stopped", label: "board.group.stopped" },
];

/** The only two drops that do something: a draft card on Running starts it, a card to review on Done marks it. */
const accepts = (place: Place, task: Task | undefined): boolean =>
  (place === "running" && task?.status === "draft") || (place === "done" && task !== undefined && toReview(task));

export function Board({
  api,
  tasks,
  projects,
  settings,
  onSettings,
  allowNoProject,
  onOpenTask,
  onTaskChanged,
  onSavedForLater,
  onTaskMenu,
  onError,
  now = new Date(),
}: {
  api: TostWorkApi;
  tasks: Task[];
  projects: Project[];
  settings: Settings;
  onSettings: (settings: Settings) => void;
  /** Whether "No project", a quick edit, is on offer in New. */
  allowNoProject: boolean;
  onOpenTask: (id: string) => void;
  /** A task the board changed, in its new state, so the window shows it before the change event arrives. */
  onTaskChanged: (task: Task) => void;
  /** A task New saved, which the window announces. */
  onSavedForLater: (task: Task) => void;
  /** Shows the task menu, the same as in Recent, and calls `rename` if the user picks Rename. */
  onTaskMenu: (id: string, rename: () => void) => void;
  onError: (err: unknown) => void;
  now?: Date;
}) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [creating, setCreating] = useState(false);
  // The task whose title is a field, and whether that's in the side panel or on its row or card.
  const [renaming, setRenaming] = useState<{ id: string; inPanel: boolean } | null>(null);
  const view = settings.boardView;
  const group = settings.boardGroup;

  const projectName = (task: Task) =>
    task.projectId === null ? t("quick.title") : (projects.find((p) => p.id === task.projectId)?.name ?? "");
  const sorted = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const shown = sorted.filter(PASSES[filter]);
  const cutoff = now.getTime() - RECENT_DAYS * 86_400_000;
  const isOlder = (task: Task) => task.status === "done" && Date.parse(task.updatedAt) < cutoff;
  const count = (f: Filter) => sorted.filter(PASSES[f]).length;
  const open = tasks.find((x) => x.id === selected) ?? null;

  // Escape closes the side panel, unless it's meant for something above it, such as a menu, a dialog or a title being
  // renamed.
  useEffect(() => {
    if (!open || creating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (
        e.target instanceof Element &&
        e.target.closest('[role="menu"], [role="dialog"], [role="alertdialog"], input, textarea')
      )
        return;
      setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, creating]);

  const save = (patch: Partial<Pick<Settings, "boardView" | "boardGroup">>) =>
    void api.settings.update(patch).then(onSettings, onError);
  const act = (work: Promise<Task>, then?: (task: Task) => void) =>
    void work.then((task) => {
      onTaskChanged(task);
      then?.(task);
    }, onError);
  const actions: RowActions = {
    // Starting it from a button goes to the task, to watch it work. A drag keeps the user on the board.
    start: (id, go = true) => act(api.tasks.startSaved(id), (task) => go && onOpenTask(task.id)),
    decide: (id, decision) => act(api.tasks.decide(id, decision)),
    review: (id) => act(api.tasks.markReviewed(id)),
  };
  const select = (id: string) => setSelected((current) => (current === id ? null : id));
  const menu = (id: string, inPanel = false) => onTaskMenu(id, () => setRenaming({ id, inPanel }));
  const renamed = (id: string) => (title: string | null) => {
    setRenaming(null);
    const task = tasks.find((x) => x.id === id);
    if (title && task && title !== task.title) act(api.tasks.rename(id, title));
  };
  const titleField = (task: Task, inPanel = false) =>
    renaming?.id === task.id &&
    renaming.inPanel === inPanel && (
      <RenameField title={task.title} label={t("menu.rename")} onDone={renamed(task.id)} />
    );
  const row = (task: Task) => (
    <Row
      key={task.id}
      task={task}
      project={projectName(task)}
      when={updatedText(lang, new Date(task.updatedAt), now)}
      selected={task.id === selected}
      showTag={group === "project" || ["done", "failed", "stopped"].includes(task.status)}
      onSelect={() => select(task.id)}
      onMenu={() => menu(task.id)}
      titleField={titleField(task)}
      actions={actions}
    />
  );
  const olderButton = (hidden: number) =>
    hidden > 0 && (
      <button type="button" className="tbtn older" onClick={() => setShowOlder(!showOlder)}>
        <Icon name="history" />
        {showOlder
          ? t("board.hideOlder")
          : hidden === 1
            ? t("board.showOlderOne")
            : t("board.showOlder", { n: String(hidden) })}
      </button>
    );

  let body: ReactNode;
  if (tasks.length === 0) body = <p className="board-empty t2">{t("board.emptyAll")}</p>;
  else if (view === "columns")
    body = (
      <Columns
        tasks={shown}
        isOlder={isOlder}
        showOlder={showOlder}
        olderButton={olderButton}
        selected={selected}
        onSelect={select}
        project={projectName}
        when={(task) => updatedText(lang, new Date(task.updatedAt), now)}
        onMenu={menu}
        titleField={titleField}
        actions={actions}
      />
    );
  else {
    const hidden = shown.filter(isOlder);
    const visible = showOlder ? shown : shown.filter((x) => !isOlder(x));
    let groups: { key: string; label: string; tasks: Task[]; older?: boolean }[];
    if (group === "project") {
      // Projects in the order of their newest task, which is the order they first come up in.
      const byProject = new Map<string, Task[]>();
      for (const task of visible) {
        const key = task.projectId ?? "";
        byProject.set(key, [...(byProject.get(key) ?? []), task]);
      }
      groups = [...byProject].map(([key, list]) => ({
        key: key || "quick",
        label: key ? (projects.find((p) => p.id === key)?.name ?? "") : t("board.group.quick"),
        tasks: list,
      }));
    } else
      groups = LIST_GROUPS.map(({ places, label }) => ({
        key: label,
        label: t(label),
        tasks: visible.filter((x) => places.includes(placeOf(x))),
        older: places.includes("done"),
      }));
    const anyShown = groups.some((g) => g.tasks.length > 0);
    body = (
      <div className="board-list">
        <div className="thead" aria-hidden="true">
          <span style={{ gridColumn: "1 / 3" }}>{t("board.col.task")}</span>
          <span className="bproj">{t("board.col.project")}</span>
          <span>{t("board.col.updated")}</span>
        </div>
        {!anyShown && hidden.length === 0 && <p className="board-empty t2">{t("board.empty")}</p>}
        {groups.map(
          (g) =>
            (g.tasks.length > 0 || (g.older && hidden.length > 0)) && (
              <section key={g.key} aria-label={g.label}>
                <h2 className="gh">{g.label}</h2>
                {g.tasks.map(row)}
                {g.older && olderButton(hidden.length)}
              </section>
            ),
        )}
        {group === "project" && olderButton(hidden.length)}
      </div>
    );
  }

  return (
    // The side panel is a sidebar on the right, beside the page rather than over it, so it never covers a task.
    <div className="main board">
      <div className="board-page">
        <div className="top">
          <span className="grow" />
          <button type="button" className="tbtn" onClick={() => setCreating(true)}>
            <Icon name="add" />
            {t("board.new")}
          </button>
          <ViewButton view="list" icon="list-check" label={t("board.list")} current={view} onPick={save} />
          <ViewButton view="columns" icon="layout" label={t("board.columns")} current={view} onPick={save} />
          <DisplayMenu group={group} disabled={view === "columns"} onPick={(boardGroup) => save({ boardGroup })} />
        </div>
        <div className="scroll">
          <div className={view === "columns" ? "board-wrap wide" : "board-wrap"}>
            <div className="bhead">
              <h1>{t("nav.board")}</h1>
              <div className="seg" role="radiogroup" aria-label={t("board.filters")}>
                {FILTERS.map((f) => {
                  const n = f === "all" || f === "jobs" ? null : count(f);
                  return (
                    <label key={f}>
                      <input
                        type="radio"
                        className="sr"
                        name="board-filter"
                        checked={filter === f}
                        onChange={() => setFilter(f)}
                      />
                      <span className={filter === f ? "on" : undefined}>
                        {/* The space keeps the word and the number apart for screen readers. */}
                        {t(`board.filter.${f}` as MessageKey)}
                        {n ? " " : null}
                        {n ? <span className="n">{n}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            {body}
          </div>
        </div>
      </div>
      {open && (
        <SidePanel
          key={open.id}
          api={api}
          task={open}
          project={projectName(open)}
          titleField={titleField(open, true)}
          onMenu={() => menu(open.id, true)}
          onClose={() => setSelected(null)}
          onOpenTask={() => onOpenTask(open.id)}
          actions={actions}
          onError={onError}
        />
      )}
      {creating && (
        <NewDialog
          api={api}
          projects={projects}
          allowNoProject={allowNoProject}
          lastUsed={sorted.find((x) => x.projectId && projects.some((p) => p.id === x.projectId))?.projectId ?? null}
          onClose={() => setCreating(false)}
          onSaved={onSavedForLater}
        />
      )}
    </div>
  );
}

interface RowActions {
  start: (id: string, go?: boolean) => void;
  decide: (id: string, decision: Decision) => void;
  review: (id: string) => void;
}

function ViewButton({
  view,
  icon,
  label,
  current,
  onPick,
}: {
  view: BoardView;
  icon: string;
  label: string;
  current: BoardView;
  onPick: (patch: { boardView: BoardView }) => void;
}) {
  return (
    <button
      type="button"
      className={current === view ? "iconbtn on" : "iconbtn"}
      aria-label={label}
      title={label}
      aria-pressed={current === view}
      onClick={() => current !== view && onPick({ boardView: view })}
    >
      <Icon name={icon} />
    </button>
  );
}

/** Grouping for the list, and how it's sorted, which is always by the latest update. */
function DisplayMenu({
  group,
  disabled,
  onPick,
}: {
  group: BoardGroup;
  /** Columns are always by status. */
  disabled: boolean;
  onPick: (group: BoardGroup) => void;
}) {
  const t = useT();
  return (
    <Menu.Root>
      <Menu.Trigger className="iconbtn" aria-label={t("board.display")} title={t("board.display")}>
        <Icon name="settings-6" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="menu">
            <Menu.RadioGroup value={group} onValueChange={(value: BoardGroup) => onPick(value)} disabled={disabled}>
              <Menu.GroupLabel className="menu-label">{t("board.groupBy")}</Menu.GroupLabel>
              {(["status", "project"] as const).map((g) => (
                <Menu.RadioItem key={g} value={g} className="menu-item" closeOnClick>
                  {t(g === "status" ? "board.byStatus" : "board.byProject")}
                  <Menu.RadioItemIndicator className="menu-check">
                    <Icon name="check" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <div className="menu-sep" />
            <p className="menu-note">{t("board.sorted")}</p>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** What the task is doing, in one line under its name. With its status tag beside it, the line leaves out what the tag
 * already says: that it's working, and which step it's on. */
function useSummary() {
  const t = useT();
  return (task: Task, tagged = false): string => {
    const made = task.files.filter((f) => f.role === "made" && f.kind !== "delete").map((f) => fileName(f.path));
    switch (task.status) {
      case "draft":
        return t("board.notStarted");
      case "needs-you":
        if (task.question) return t("board.asks", { text: task.question.text });
        return task.approval ? approvalTitle(t, task.approval) : t("tag.needsYou");
      case "running": {
        const n = task.steps.findIndex((s) => s.status === "in_progress");
        const step = n >= 0 && !tagged ? t("task.step", { n: String(n + 1), total: String(task.steps.length) }) : "";
        const last = made.at(-1) ?? task.steps[n]?.text ?? "";
        return [step, last].filter(Boolean).join(" · ") || (tagged ? "" : t("task.working"));
      }
      case "done":
        return made.length ? made.join(", ") : t("board.chat");
      case "failed":
        return task.error ? t("task.failed", { error: task.error }) : "";
      case "stopped":
        return t(task.interrupted ? "task.interrupted" : "task.stopped");
    }
  };
}

/** The page drawn for a task: its brief while it waits, else the file it's on or made last. */
function TaskThumb({ task }: { task: Task }) {
  if (task.status === "draft") return <Thumb brief />;
  const path = task.approval?.paths[0] ?? task.files.filter((f) => f.role === "made").at(-1)?.path;
  return <Thumb path={path} />;
}

/** The buttons a row or card answers in place: an approval, or Start for a task saved for later. */
function InlineActions({ task, actions }: { task: Task; actions: RowActions }) {
  const t = useT();
  if (task.approval) {
    const remove = task.approval.action === "delete";
    return (
      <span className="actions">
        <button type="button" className="btn" onClick={() => actions.decide(task.id, "allow")}>
          {remove ? t("approval.trash") : t("approval.allowOverwrite")}
        </button>
        <button type="button" className="btn dark" onClick={() => actions.decide(task.id, "refuse")}>
          {remove ? t("approval.keep") : t("approval.saveNew")}
        </button>
      </span>
    );
  }
  if (task.status === "draft")
    return (
      <span className="actions">
        <button type="button" className="btn" onClick={() => actions.start(task.id)}>
          <Icon name="play" />
          {t("board.start")}
        </button>
      </span>
    );
  return null;
}

/** The small tags before the summary: the status where the group doesn't already say it, and a job's runs. */
function Tags({ task, status }: { task: Task; status: boolean }) {
  const t = useT();
  return (
    <>
      {status && <TaskTag task={task} />}
      {task.jobId && <span className="tag">{t("tag.job")}</span>}
    </>
  );
}

/** The … button of a row, a card or the side panel, which opens the task menu, as right-clicking does. */
function MoreButton({ task, onMenu }: { task: Task; onMenu: () => void }) {
  const t = useT();
  const label = t("recent.more", { name: task.title });
  return (
    <button
      type="button"
      className="more"
      aria-label={label}
      title={label}
      onClick={onMenu}
      onContextMenu={contextMenu(onMenu)}
    >
      <Icon name="more-1" />
    </button>
  );
}

/** Right-click opens the task menu instead of the system's, as in Recent. */
const contextMenu = (onMenu: () => void) => (e: MouseEvent) => {
  e.preventDefault();
  onMenu();
};

function Row({
  task,
  project,
  when,
  selected,
  showTag,
  onSelect,
  onMenu,
  titleField,
  actions,
}: {
  task: Task;
  project: string;
  when: string;
  selected: boolean;
  showTag: boolean;
  onSelect: () => void;
  onMenu: () => void;
  /** The field that takes the title's place while it's renamed. */
  titleField: ReactNode;
  actions: RowActions;
}) {
  const summary = useSummary();
  return (
    <div className={selected ? "brow sel" : "brow"}>
      {/* The whole row is this one button, under the buttons it answers in place with. */}
      <button
        type="button"
        className="hit"
        aria-label={task.title}
        aria-expanded={selected}
        aria-controls={selected ? "board-panel" : undefined}
        onClick={onSelect}
        onContextMenu={contextMenu(onMenu)}
      />
      <TaskThumb task={task} />
      <span className="main-c">
        {titleField || <span className="nm truncate">{task.title}</span>}
        <span className="sn">
          <Tags task={task} status={showTag} />
          <span className="truncate">{summary(task, showTag)}</span>
        </span>
        <InlineActions task={task} actions={actions} />
      </span>
      <span className="c bproj truncate">{project}</span>
      <span className="c t3">{when}</span>
      <MoreButton task={task} onMenu={onMenu} />
    </div>
  );
}

function Columns({
  tasks,
  isOlder,
  showOlder,
  olderButton,
  selected,
  onSelect,
  project,
  when,
  onMenu,
  titleField,
  actions,
}: {
  tasks: Task[];
  isOlder: (task: Task) => boolean;
  showOlder: boolean;
  olderButton: (hidden: number) => ReactNode;
  selected: string | null;
  onSelect: (id: string) => void;
  project: (task: Task) => string;
  when: (task: Task) => string;
  onMenu: (id: string) => void;
  titleField: (task: Task) => ReactNode;
  actions: RowActions;
}) {
  const t = useT();
  const summary = useSummary();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Place | null>(null);
  const dragged = tasks.find((x) => x.id === dragging);
  const columns = COLUMNS.filter((c) => c.place !== "stopped" || tasks.some((x) => placeOf(x) === "stopped"));
  const drop = (place: Place) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    setDragging(null);
    if (!dragged || !accepts(place, dragged)) return;
    if (place === "running") actions.start(dragged.id, false);
    else actions.review(dragged.id);
  };
  return (
    <div className="bcols">
      {columns.map(({ place, label }) => {
        const all = tasks.filter((x) => placeOf(x) === place);
        const hidden = all.filter(isOlder);
        const list = showOlder ? all : all.filter((x) => !isOlder(x));
        const canDrop = accepts(place, dragged);
        return (
          <section
            key={place}
            aria-label={t(label)}
            className={`bcol${canDrop ? " can-drop" : ""}${over === place && canDrop ? " over" : ""}`}
            // Only a column that takes the card being dragged says so, so the pointer shows where a drop does nothing.
            onDragOver={(e) => {
              if (!canDrop) return;
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
              setOver(place);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={drop(place)}
          >
            <h2 className="gh">
              {t(label)}
              <span className="n">{all.length}</span>
            </h2>
            {list.length === 0 && hidden.length === 0 && <p className="bempty t3">{t("board.emptyColumn")}</p>}
            {list.map((task) => {
              const movable = task.status === "draft" || toReview(task);
              const tagged = place === "stopped" || task.status === "running";
              return (
                <div
                  key={task.id}
                  className={`bcard${movable ? " movable" : ""}${task.status === "running" ? " busy" : ""}${task.id === selected ? " sel" : ""}${task.id === dragging ? " lifted" : ""}`}
                >
                  {/* The card's button is what's dragged, since it covers the card, and the card is the picture. */}
                  <button
                    type="button"
                    className="hit"
                    aria-label={task.title}
                    aria-expanded={task.id === selected}
                    aria-controls={task.id === selected ? "board-panel" : undefined}
                    onClick={() => onSelect(task.id)}
                    onContextMenu={contextMenu(() => onMenu(task.id))}
                    draggable={movable}
                    onDragStart={(e) => {
                      if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", task.title);
                        const card = e.currentTarget.parentElement;
                        if (card) e.dataTransfer.setDragImage(card, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                      }
                      setDragging(task.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  />
                  {titleField(task) || <span className="nm">{task.title}</span>}
                  <span className="sn">
                    {/* A running card says it's working, so it doesn't look like one more card to move. */}
                    <Tags task={task} status={tagged} />
                    <span className="clip">{summary(task, tagged)}</span>
                  </span>
                  <InlineActions task={task} actions={actions} />
                  <span className="meta t3">
                    <span className="truncate grow">{project(task)}</span>
                    <span>{when(task)}</span>
                    <MoreButton task={task} onMenu={() => onMenu(task.id)} />
                  </span>
                </div>
              );
            })}
            {olderButton(hidden.length)}
          </section>
        );
      })}
    </div>
  );
}

/** Characters of the brief the side panel shows; the task screen has the rest. */
const EXCERPT = 400;

/** The summary of the selected task, beside the list, with what can be done from here. */
function SidePanel({
  api,
  task,
  project,
  titleField,
  onMenu,
  onClose,
  onOpenTask,
  actions,
  onError,
}: {
  api: TostWorkApi;
  task: Task;
  project: string;
  /** The field that takes the title's place while it's renamed. */
  titleField: ReactNode;
  onMenu: () => void;
  onClose: () => void;
  onOpenTask: () => void;
  actions: RowActions;
  onError: (err: unknown) => void;
}) {
  const t = useT();
  const made = task.files.filter((f) => f.role === "made" && f.kind !== "delete");
  const brief = task.brief.length > EXCERPT ? `${task.brief.slice(0, EXCERPT).trimEnd()}…` : task.brief;
  return (
    <aside className="bpanel" id="board-panel" aria-label={task.title}>
      <div className="head">
        {titleField || <b className="grow">{task.title}</b>}
        <MoreButton task={task} onMenu={onMenu} />
        <button
          type="button"
          className="iconbtn"
          aria-label={t("board.close")}
          title={t("board.close")}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="body">
        <p className="bmeta">
          <span className="truncate">{project}</span>
          <TaskTag task={task} />
        </p>
        {task.approval && <p className="bwait">{approvalTitle(t, task.approval)}</p>}
        <h3>{t("task.asked")}</h3>
        <p className="bbrief">{brief}</p>
        <h3>{t("task.made")}</h3>
        {made.length === 0 && <p className="empty">{t("task.noFiles")}</p>}
        {made.map((f) => (
          <FileLine key={f.path} path={f.path} onOpen={() => void api.files.open(task.id, f.path).catch(onError)} />
        ))}
      </div>
      <div className="foot2">
        <button type="button" className="btn" onClick={onOpenTask}>
          <Icon name="arrow-right" />
          {t("board.open")}
        </button>
        {/* The same choice as on the card, here too: the panel is the larger view of the same task. The footer stacks
            from the bottom, so the safe choice ends up above Open, as the dark button. */}
        {task.approval && (
          <>
            {task.approval.action === "overwrite" && (
              <button type="button" className="btn" onClick={() => actions.decide(task.id, "discard")}>
                {t("approval.discard")}
              </button>
            )}
            <button type="button" className="btn dark" onClick={() => actions.decide(task.id, "refuse")}>
              {task.approval.action === "delete" ? t("approval.keep") : t("approval.saveNew")}
            </button>
            <button type="button" className="btn" onClick={() => actions.decide(task.id, "allow")}>
              {task.approval.action === "delete" ? t("approval.trash") : t("approval.allowOverwrite")}
            </button>
          </>
        )}
        {task.status === "draft" && (
          <button type="button" className="btn dark" onClick={() => actions.start(task.id)}>
            <Icon name="play" />
            {t("board.start")}
          </button>
        )}
        {toReview(task) && (
          <button type="button" className="btn dark" onClick={() => actions.review(task.id)}>
            <Icon name="check" />
            {t("review.mark")}
          </button>
        )}
      </div>
    </aside>
  );
}

/** New on the board: a brief and a project, saved to start later. */
function NewDialog({
  api,
  projects,
  allowNoProject,
  lastUsed,
  onClose,
  onSaved,
}: {
  api: TostWorkApi;
  projects: Project[];
  allowNoProject: boolean;
  /** The project of the newest task, which the picker starts on, as the home's does. */
  lastUsed: string | null;
  onClose: () => void;
  /** The task, once it's saved and the dialog is closing. */
  onSaved: (task: Task) => void;
}) {
  const t = useT();
  const [brief, setBrief] = useState("");
  const [projectId, setProjectId] = useState(lastUsed ?? projects[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  // The ref stops a double click in the same tick; the state greys the button out.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const noProject = !projectId;
  const canSave = !busy && brief.trim().length > 0 && brief.length <= BRIEF_MAX && (allowNoProject || !noProject);
  const save = async () => {
    if (saving.current || !canSave) return;
    saving.current = true;
    setBusy(true);
    try {
      onSaved(await api.tasks.saveForLater({ projectId: projectId || null, brief: brief.trim() }));
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-backdrop" />
        <Dialog.Popup className="dlg">
          <Dialog.Title className="dlg-title">{t("board.newTitle")}</Dialog.Title>
          <label className="fld">
            <span>{t("board.brief")}</span>
            <textarea className="input area" value={brief} onChange={(e) => setBrief(e.target.value)} />
          </label>
          <label className="fld">
            <span>{t("board.project")}</span>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {allowNoProject && <option value="">{t("composer.noProject")}</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {brief.length > BRIEF_MAX && (
            <p className="fld-error">{t("composer.tooLong", { max: BRIEF_MAX.toLocaleString() })}</p>
          )}
          {error && <p className="fld-error">{error}</p>}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}>
            <Dialog.Close className="btn">{t("dialog.cancel")}</Dialog.Close>
            <button type="button" className="btn dark" disabled={!canSave} onClick={() => void save()}>
              {t("board.save")}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
