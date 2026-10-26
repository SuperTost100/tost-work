import { type MouseEvent, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/Icon";
import { Logo } from "@/lib/Logo";
import { useT } from "@/lib/useT";
import type { TaskMenuAction } from "../../../shared/api";
import type { Task } from "../../../shared/model";
import { WorkingDots } from "../components/TaskTag";

export type Section = "home" | "projects" | "skills" | "jobs" | "board" | "settings" | "profile";

const NAV: {
  id: Section;
  icon: string;
  key: "nav.newTask" | "nav.projects" | "nav.skills" | "nav.jobs" | "nav.board";
}[] = [
  { id: "home", icon: "edit", key: "nav.newTask" },
  { id: "projects", icon: "folder", key: "nav.projects" },
  { id: "skills", icon: "magic-2", key: "nav.skills" },
  { id: "jobs", icon: "calendar", key: "nav.jobs" },
  { id: "board", icon: "task", key: "nav.board" },
];

export function Sidebar({
  current,
  onNavigate,
  userName,
  isMac,
  tasks,
  openTaskId,
  onOpenTask,
  onTaskMenu,
  onRenameTask,
  onRevealTask,
  onDeleteTask,
}: {
  current: Section | null;
  onNavigate: (s: Section) => void;
  userName: string;
  isMac: boolean;
  tasks: Task[];
  openTaskId: string | null;
  onOpenTask: (id: string) => void;
  /** Shows the native task menu and resolves with the pick. */
  onTaskMenu: (id: string) => Promise<TaskMenuAction | null>;
  onRenameTask: (id: string, title: string) => void;
  onRevealTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
}) {
  const t = useT();
  const [renaming, setRenaming] = useState<string | null>(null);
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
        <button type="button" className="iconbtn" title={t("nav.collapse")} aria-label={t("nav.collapse")}>
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
        {NAV.map((n) => (
          <button
            type="button"
            key={n.id}
            className={current === n.id ? "nav on" : "nav"}
            aria-current={current === n.id ? "page" : undefined}
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
      {tasks.slice(0, 8).map((task) => (
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
          title={t("nav.settings")}
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
function RenameField({
  title,
  label,
  onDone,
}: {
  title: string;
  label: string;
  onDone: (title: string | null) => void;
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
    onDone(value?.trim() || null);
  };
  return (
    <input
      ref={ref}
      className="rename"
      aria-label={label}
      defaultValue={title}
      maxLength={200}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
