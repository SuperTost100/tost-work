import { type MouseEvent, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/Icon";
import { Logo } from "@/lib/Logo";
import { withShortcut } from "@/lib/shortcut";
import { useT } from "@/lib/useT";
import type { TaskMenuAction } from "../../../shared/api";
import type { SectionKey, Task } from "../../../shared/model";
import { WorkingDots } from "../components/TaskTag";

/** How many tasks Recent shows. */
export const RECENT = 8;

export type Section = "home" | "projects" | "skills" | "jobs" | "board" | "settings" | "profile";

const NAV: {
  id: Section;
  icon: string;
  key: "nav.newTask" | "nav.projects" | "nav.skills" | "nav.jobs" | "nav.board";
  /** The switch in Settings that hides it. */
  section?: SectionKey;
}[] = [
  { id: "home", icon: "edit", key: "nav.newTask" },
  { id: "projects", icon: "folder", key: "nav.projects" },
  { id: "skills", icon: "magic-2", key: "nav.skills", section: "skills" },
  { id: "jobs", icon: "calendar", key: "nav.jobs", section: "jobs" },
  { id: "board", icon: "task", key: "nav.board", section: "board" },
];

export function Sidebar({
  current,
  onNavigate,
  showSection = () => true,
  userName,
  isMac,
  onCollapse,
  tasks,
  openTaskId,
  onOpenTask,
  onTaskMenu,
  onRenameTask,
  onRevealTask,
  onDeleteTask,
  renaming: renamingProp,
  onRenamingChange,
}: {
  current: Section | null;
  onNavigate: (s: Section) => void;
  /** Whether the level and the user's switches show a section. */
  showSection?: (key: SectionKey) => boolean;
  userName: string;
  isMac: boolean;
  /** Hides the sidebar. */
  onCollapse: () => void;
  tasks: Task[];
  openTaskId: string | null;
  onOpenTask: (id: string) => void;
  /** Shows the native task menu and resolves with the pick. */
  onTaskMenu: (id: string) => Promise<TaskMenuAction | null>;
  onRenameTask: (id: string, title: string) => void;
  onRevealTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  /** The task whose title is being edited, when the parent holds that state. */
  renaming?: string | null;
  onRenamingChange?: (id: string | null) => void;
}) {
  const t = useT();
  const [ownRenaming, setOwnRenaming] = useState<string | null>(null);
  // The menu bar's Rename starts it from outside, so the parent may hold this state.
  const renaming = renamingProp === undefined ? ownRenaming : renamingProp;
  const setRenaming = onRenamingChange ?? setOwnRenaming;
  const menu = async (id: string) => {
    const action = await onTaskMenu(id);
    if (action === "rename") setRenaming(id);
    else if (action === "reveal") onRevealTask(id);
    else if (action === "delete") onDeleteTask(id);
  };
  // Right-click opens the same menu as the … button, as in Finder.
  const contextMenu = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    void menu(id);
  };
  return (
    <aside className="side">
      <div className="chrome">
        {isMac && <span className="lights-space" />}
        <span className="grow" />
        <button
          type="button"
          className="iconbtn"
          title={withShortcut(t("nav.collapse"), "B", isMac)}
          aria-label={t("nav.collapse")}
          onClick={onCollapse}
        >
          <Icon name="layout-leftbar-close" />
        </button>
      </div>
      <div className="brand">
        <Logo />
        <b>Tost Work</b>
      </div>
      <button type="button" className="search">
        <Icon name="search" />
        {t("nav.search")}
        <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <nav aria-label="Sections">
        {NAV.filter((n) => !n.section || showSection(n.section)).map((n) => (
          <button
            type="button"
            key={n.id}
            className={current === n.id ? "nav on" : "nav"}
            aria-current={current === n.id ? "page" : undefined}
            title={n.id === "home" ? withShortcut(t(n.key), "N", isMac) : undefined}
            onClick={() => onNavigate(n.id)}
          >
            <Icon name={n.icon} />
            {t(n.key)}
          </button>
        ))}
      </nav>
      <h4>{t("nav.recent")}</h4>
      {tasks.length === 0 && (
        <p className="t3" style={{ fontSize: 13, padding: "0 8px" }}>
          {t("recent.empty")}
        </p>
      )}
      {tasks.slice(0, RECENT).map((task) => (
        <div key={task.id} className={`rec split${openTaskId === task.id ? " on" : ""}`}>
          {renaming === task.id ? (
            <RenameField
              title={task.title}
              label={t("menu.rename")}
              onDone={(title) => {
                setRenaming(null);
                if (title && title !== task.title) onRenameTask(task.id, title);
              }}
            />
          ) : (
            <button
              type="button"
              className="open"
              aria-current={openTaskId === task.id ? "page" : undefined}
              onClick={() => onOpenTask(task.id)}
              onContextMenu={contextMenu(task.id)}
            >
              <span className="truncate grow">{task.title}</span>
              {task.status === "needs-you" && <span className="tag mine">{t("tag.needsYou")}</span>}
              {task.status === "running" && (
                <span className="tag">
                  <WorkingDots />
                  {t("tag.working")}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            className="more"
            aria-label={t("recent.more", { name: task.title })}
            title={t("recent.more", { name: task.title })}
            onClick={() => void menu(task.id)}
            onContextMenu={contextMenu(task.id)}
          >
            <Icon name="more-1" />
          </button>
        </div>
      ))}
      <span className="spacer" />
      <div className="me">
        <button
          type="button"
          className={`who-btn${current === "profile" ? " on" : ""}`}
          aria-current={current === "profile" ? "page" : undefined}
          title={t("nav.profile")}
          aria-label={`${userName}, ${t("nav.profile")}`}
          onClick={() => onNavigate("profile")}
        >
          <span className="avatar">{userName.slice(0, 1).toUpperCase()}</span>
          <span className="who grow truncate">{userName}</span>
        </button>
        <button
          type="button"
          className={`iconbtn${current === "settings" ? " on" : ""}`}
          aria-current={current === "settings" ? "page" : undefined}
          title={withShortcut(t("nav.settings"), ",", isMac)}
          aria-label={t("nav.settings")}
          onClick={() => onNavigate("settings")}
        >
          <Icon name="settings-3" />
        </button>
      </div>
    </aside>
  );
}

/** The task's name, editable in place. Enter or leaving the field keeps the new name; Escape keeps the old one. */
/** A title being renamed: Enter or leaving the field saves, Escape cancels. */
export function RenameField({
  title,
  label,
  onDone,
  className = "rename",
  placeholder,
  allowEmpty = false,
  maxLength = 200,
}: {
  title: string;
  label: string;
  /** The new text, or null when the user kept the old one with Escape (or, unless `allowEmpty`, emptied it). */
  onDone: (title: string | null) => void;
  className?: string;
  placeholder?: string;
  /** Whether an empty field counts, as for a description that can be cleared. */
  allowEmpty?: boolean;
  maxLength?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    const trimmed = value?.trim() ?? null;
    onDone(trimmed === null ? null : trimmed || (allowEmpty ? "" : null));
  };
  return (
    <input
      ref={ref}
      className={className}
      aria-label={label}
      placeholder={placeholder}
      defaultValue={title}
      maxLength={maxLength}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
