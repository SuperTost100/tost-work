import { Icon } from "@/lib/Icon";
import { Logo } from "@/lib/Logo";
import { useT } from "@/lib/useT";

export type Section = "home" | "projects" | "skills" | "jobs" | "board" | "settings";

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
}: {
  current: Section;
  onNavigate: (s: Section) => void;
  userName: string;
  isMac: boolean;
}) {
  const t = useT();
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
      <p className="t3" style={{ fontSize: 13, padding: "0 8px" }}>
        {t("recent.empty")}
      </p>
      <span className="spacer" />
      <div className="me">
        <span className="avatar">{userName.slice(0, 1).toUpperCase()}</span>
        <span className="who grow">{userName}</span>
        <button
          type="button"
          className="iconbtn"
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
