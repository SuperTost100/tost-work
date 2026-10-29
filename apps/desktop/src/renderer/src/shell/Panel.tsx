import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/Icon";
import { Logo } from "@/lib/Logo";
import { useLook } from "@/lib/useLook";
import { LanguageContext, useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import { type Language, languageFrom } from "../../../shared/i18n";
import { whenText } from "../../../shared/jobText";
import { busyStatus, type Job, type Project, type Settings, type Task } from "../../../shared/model";
import { upcoming } from "../../../shared/schedule";
import { WorkingDots } from "../components/TaskTag";

/** How many upcoming runs the panel lists. */
const NEXT_RUNS = 3;

/**
 * The panel the menu-bar icon opens: what needs the user, what's working, the next job runs, and a way into the app.
 * It's a window of its own, so it loads its own settings and keeps its lists up to date like the main window.
 */
export function Panel({ api }: { api: TostWorkApi }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void api.settings.get().then(setSettings);
    return api.settings.onChange(setSettings);
  }, [api]);
  const lang: Language = settings?.language ?? languageFrom(navigator.language);
  useLook(lang, settings?.theme);
  return (
    <LanguageContext.Provider value={lang}>
      <PanelBody api={api} lang={lang} />
    </LanguageContext.Provider>
  );
}

function PanelBody({ api, lang }: { api: TostWorkApi; lang: Language }) {
  const t = useT();
  // Every working or waiting task, however old, kept up to date as tasks change.
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  // The panel is hidden, not closed, between clicks, so it reads the projects again each time it opens: one may have
  // been added or renamed meanwhile.
  useEffect(() => {
    const load = () => void api.projects.list().then(setProjects);
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [api]);
  useEffect(() => {
    void api.tasks.listActive().then((active) =>
      // A change that came while the list loaded is newer than the list's copy.
      setTasks((seen) => [...seen, ...active.filter((t) => !seen.some((s) => s.id === t.id))]),
    );
    return api.tasks.onChange((task) => setTasks((list) => [...list.filter((t) => t.id !== task.id), task]));
  }, [api]);
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    void api.jobs.list().then(setJobs);
    return api.jobs.onChange((change) =>
      setJobs((list) =>
        "removed" in change
          ? list.filter((j) => j.id !== change.id)
          : [...list.filter((j) => j.id !== change.id), change],
      ),
    );
  }, [api]);
  // The next runs' times move on by themselves, so the panel looks again every minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // The window takes the height of what's in it, so there's never empty space or a scrollbar for a short list.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fitToContent = () => api.panel.fit(Math.ceil(el.getBoundingClientRect().height));
    fitToContent();
    const watch = new ResizeObserver(fitToContent);
    watch.observe(el);
    return () => watch.disconnect();
  }, [api]);

  const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name : undefined);
  const needs = tasks.filter((x) => x.status === "needs-you");
  const working = tasks.filter((x) => busyStatus(x.status) && x.status !== "needs-you");
  const next = jobs
    .map((job) => ({ job, at: upcoming(job, now) }))
    .filter((x): x is { job: Job; at: Date } => x.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, NEXT_RUNS);

  return (
    <div className="panel" ref={box}>
      <header className="ph">
        <span className="brand">
          <Logo size={20} />
          <b>Tost Work</b>
        </span>
        <button type="button" className="btn" onClick={() => api.panel.open({ action: "new-task" })}>
          <Icon name="add" />
          {t("nav.newTask")}
        </button>
      </header>

      {needs.length > 0 && (
        <section className="psec">
          <h3>
            {t("panel.needsYou")}
            <span className="count">{needs.length}</span>
          </h3>
          {needs.map((task) => (
            <button key={task.id} type="button" className="prow" onClick={() => api.panel.open({ taskId: task.id })}>
              <span className="dot need" aria-hidden="true" />
              <span className="ptext">
                <span className="truncate">{task.title}</span>
                {projectName(task.projectId) && <span className="pmeta truncate">{projectName(task.projectId)}</span>}
              </span>
              <Icon name="right" className="chev" />
            </button>
          ))}
        </section>
      )}

      {working.length > 0 && (
        <section className="psec">
          <h3>{t("panel.working")}</h3>
          {working.map((task) => (
            <button key={task.id} type="button" className="prow" onClick={() => api.panel.open({ taskId: task.id })}>
              <WorkingDots />
              <span className="ptext">
                <span className="truncate">{task.title}</span>
                {projectName(task.projectId) && <span className="pmeta truncate">{projectName(task.projectId)}</span>}
              </span>
              <Icon name="right" className="chev" />
            </button>
          ))}
        </section>
      )}

      {next.length > 0 && (
        <section className="psec">
          <h3>{t("panel.next")}</h3>
          {next.map(({ job, at }) => (
            <div key={job.id} className="prow still">
              <Icon name="time" />
              <span className="ptext">
                <span className="truncate">{job.title}</span>
                <span className="pmeta truncate">{projectName(job.projectId)}</span>
              </span>
              <span className="pwhen">{whenText(lang, at, now)}</span>
            </div>
          ))}
        </section>
      )}

      {needs.length === 0 && working.length === 0 && (
        <section className="psec quiet">
          <p>{t("panel.quiet")}</p>
        </section>
      )}

      <footer className="pfoot">
        <button type="button" className="tbtn" onClick={() => api.panel.open()}>
          <Icon name="layout" />
          {t("tray.open")}
        </button>
        <span className="grow" />
        <button
          type="button"
          className="iconbtn"
          title={t("nav.settings")}
          aria-label={t("nav.settings")}
          onClick={() => api.panel.open({ action: "settings" })}
        >
          <Icon name="settings-3" />
        </button>
        <button type="button" className="tbtn" onClick={() => api.panel.quit()}>
          {t("panel.quit")}
        </button>
      </footer>
    </div>
  );
}
