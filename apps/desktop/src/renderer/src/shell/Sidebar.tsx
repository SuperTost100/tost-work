import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
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
  pinned = true,
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
  /** Hides the sidebar, or keeps it open when it's shown over the page from the rail. */
  onCollapse: () => void;
  /** False while it's shown over the page from the rail: its top button then keeps it open. */
  pinned?: boolean;
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
        {/* Over the page, the logo keeps it open, as it does on the rail. */}
        {pinned && (
          <button
            type="button"
            className="iconbtn"
            title={withShortcut(t("nav.collapse"), "B", isMac)}
            aria-label={t("nav.collapse")}
            onClick={onCollapse}
          >
            <Icon name="layout-leftbar-close" />
          </button>
        )}
      </div>
      <div className="brand">
        {pinned ? <Logo /> : <LogoButton label={t("nav.keepOpen")} isMac={isMac} onClick={onCollapse} />}
        <b>Tost Work</b>
      </div>
      <button type="button" className="search" data-nav="search">
        <Icon name="search" />
        {t("nav.search")}
        <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <nav aria-label="Sections">
        {NAV.filter((n) => !n.section || showSection(n.section)).map((n) => (
          <button
            type="button"
            key={n.id}
            data-nav={n.id}
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
          data-nav="profile"
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
          data-nav="settings"
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

/** The logo, which turns into the sidebar button under the pointer or the keyboard's focus. */
function LogoButton({ label, isMac, onClick }: { label: string; isMac: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="logo-btn"
      data-nav="logo"
      title={withShortcut(label, "B", isMac)}
      aria-label={label}
      onClick={onClick}
    >
      <Logo />
      <Icon name="layout-leftbar-open" />
    </button>
  );
}

/** Whether the user asked for less motion, so the sidebar goes without folding. */
const stillMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** How long the pointer rests on the rail before the sidebar opens over the page, and stays once it's gone. */
const PEEK_OPEN_MS = 200;
const PEEK_CLOSE_MS = 300;
/** How long the sidebar takes to fold back into the rail, as in the CSS. */
export const PEEK_FOLD_MS = 120;

/**
 * The collapsed sidebar: a rail of the sections' icons, which opens the whole sidebar over the page when the pointer
 * rests on it or the keyboard reaches it, without moving the page. The wait keeps a pointer passing by from opening
 * it. `children` is that whole sidebar.
 */
export function SidebarRail({
  current,
  onNavigate,
  showSection = () => true,
  userName,
  isMac,
  onExpand,
  children,
}: {
  current: Section | null;
  onNavigate: (s: Section) => void;
  showSection?: (key: SectionKey) => boolean;
  userName: string;
  isMac: boolean;
  /** Brings the sidebar back in its place. */
  onExpand: () => void;
  children: ReactNode;
}) {
  const t = useT();
  // Open grows the rail into the whole sidebar over the page; folding shrinks it back before it goes.
  const [phase, setPhase] = useState<"closed" | "open" | "folding">("closed");
  const open = phase === "open";
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The item the keyboard was on in the rail, which takes the focus in the sidebar once it's open.
  const focusNext = useRef<string | null>(null);
  // Set while Escape hands the focus back to the rail, so that focus doesn't open the sidebar again.
  const quiet = useRef(false);
  // Listened to on the box itself, which only times the opening: its buttons are what the user acts on.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const setOpen = (next: boolean) =>
      setPhase((now) => (next ? "open" : now === "open" ? (stillMotion() ? "closed" : "folding") : now));
    const later = (ms: number, next: boolean) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOpen(next), ms);
    };
    // Whether the pointer is over the rail or the sidebar, which then closes only once it leaves.
    let over = false;
    const enter = () => {
      over = true;
      // Back while it folds: it opens again at once, rather than vanishing and growing anew.
      later(el.querySelector(".peek.folding") ? 0 : PEEK_OPEN_MS, true);
    };
    const leave = () => {
      over = false;
      later(PEEK_CLOSE_MS, false);
    };
    const focusIn = (e: Event) => {
      // A click focuses its button too, but only the keyboard's focus shows a ring; the pointer has its own timing.
      const target = e.target as HTMLElement;
      if (quiet.current) {
        quiet.current = false;
        return;
      }
      if (el.querySelector(".peek:not(.folding)") || !target.matches(":focus-visible")) return;
      clearTimeout(timer.current);
      focusNext.current = target.getAttribute("data-nav");
      setOpen(true);
    };
    // Focus going elsewhere closes it, but not focus going nowhere, as a click on the sidebar's blank space does.
    const focusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to ? !el.contains(to) : !over) later(0, false);
    };
    // Escape closes it and puts the focus back on the same item in the rail, where the keyboard came in.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !el.querySelector(".peek")) return;
      clearTimeout(timer.current);
      const id = (e.target as HTMLElement).closest("[data-nav]")?.getAttribute("data-nav");
      // At once: the focus goes back to the rail, which the folding sidebar would still cover.
      setPhase("closed");
      const back = el.querySelector<HTMLElement>(`.rail [data-nav="${id ?? "home"}"]`);
      // The focus event comes during focus(), so the flag covers only that one; on a button that already has the
      // focus, none comes, and the flag mustn't wait for the next.
      quiet.current = true;
      back?.focus();
      quiet.current = false;
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("focusin", focusIn);
    el.addEventListener("focusout", focusOut);
    el.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer.current);
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("focusin", focusIn);
      el.removeEventListener("focusout", focusOut);
      el.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    if (phase !== "folding") return;
    const done = setTimeout(() => setPhase("closed"), PEEK_FOLD_MS);
    return () => clearTimeout(done);
  }, [phase]);
  useEffect(() => {
    if (!open || !focusNext.current) return;
    box.current?.querySelector<HTMLElement>(`.peek [data-nav="${focusNext.current}"]`)?.focus();
    focusNext.current = null;
  }, [open]);
  const item = (id: Section | "search", icon: string, label: string, onClick?: () => void) => (
    <button
      type="button"
      key={id}
      data-nav={id}
      className={current === id ? "railbtn on" : "railbtn"}
      aria-current={current === id ? "page" : undefined}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
  return (
    <div className="railbox" ref={box}>
      <nav className="rail" aria-label="Sections">
        <span className="rail-chrome" />
        <span className="rail-logo">
          <LogoButton label={t("nav.expand")} isMac={isMac} onClick={onExpand} />
        </span>
        {item("search", "search", t("nav.search"))}
        {NAV.filter((n) => !n.section || showSection(n.section)).map((n) =>
          item(n.id, n.icon, t(n.key), () => onNavigate(n.id)),
        )}
        <span className="spacer" />
        <button
          type="button"
          data-nav="profile"
          className={current === "profile" ? "railbtn on" : "railbtn"}
          aria-current={current === "profile" ? "page" : undefined}
          aria-label={`${userName}, ${t("nav.profile")}`}
          title={t("nav.profile")}
          onClick={() => onNavigate("profile")}
        >
          <span className="avatar">{userName.slice(0, 1).toUpperCase()}</span>
        </button>
        {item("settings", "settings-3", t("nav.settings"), () => onNavigate("settings"))}
      </nav>
      {phase !== "closed" && <div className={open ? "peek" : "peek folding"}>{children}</div>}
    </div>
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
