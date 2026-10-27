import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Attachments } from "@/components/Composer";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import { Home } from "@/screens/Home";
import { Profile } from "@/screens/Profile";
import { Project } from "@/screens/Project";
import { Projects } from "@/screens/Projects";
import { Settings as SettingsScreen } from "@/screens/Settings";
import { Soon } from "@/screens/Soon";
import { Task } from "@/screens/Task";
import { RECENT, type Section, Sidebar } from "@/shell/Sidebar";
import { useData } from "@/state/useData";
import type { MenuAction, TostWorkApi } from "../../shared/api";
import { DEFAULT_SETTINGS, type Settings, sectionOn } from "../../shared/model";

/** The main process accepts up to 20 attachments per task. */
const MAX_FILES = 20;

type Route =
  | { name: "home" }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "task"; id: string }
  | { name: "profile" }
  | { name: "settings" }
  | { name: "soon"; section: "skills" | "jobs" | "board" };

export function App({
  userName = "Giulia",
  api = window.tostWork,
  settings,
  onSettings,
}: {
  userName?: string;
  api?: TostWorkApi;
  /** The saved settings. Without them the app uses the defaults with this user's name. */
  settings?: Settings;
  onSettings?: (settings: Settings) => void;
}) {
  const t = useT();
  const current = settings ?? { ...DEFAULT_SETTINGS, name: userName, setupDone: true };
  const quickEdit = sectionOn(current, "quickEdit");
  const { projects, tasks, addProject, loadProject, removeTask } = useData(api);
  const [route, setRoute] = useState<Route>({ name: "home" });
  // The briefs live here so they survive a trip to another section.
  const [brief, setBrief] = useState("");
  const [projectBrief, setProjectBrief] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  // undefined until the user picks: then Home offers the project used last. null is "No project", picked on purpose.
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const report = useCallback((err: unknown) => setError(errorText(err)), []);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const isMac = api?.platform === "darwin";
  const openTaskMenu = async (id: string) => {
    try {
      return (await api?.tasks.menu(id)) ?? null;
    } catch (err) {
      report(err);
      return null;
    }
  };

  const openProjectId = route.name === "project" ? route.id : null;
  useEffect(() => {
    if (openProjectId) loadProject(openProjectId).catch(report);
  }, [openProjectId, loadProject, report]);
  // Counted in the store, because the task list here holds only the recent ones.
  useEffect(() => {
    if (route.name === "projects") void api?.projects.taskCounts().then(setCounts, report);
  }, [route.name, api, report]);

  const section: Section | null = useMemo(() => {
    switch (route.name) {
      case "home":
        return "home";
      case "projects":
      case "project":
        return "projects";
      case "soon":
        return route.section;
      case "profile":
        return "profile";
      case "settings":
        return "settings";
      default:
        return null;
    }
  }, [route]);

  const navigate = (s: Section) => {
    if (s === "home") setRoute({ name: "home" });
    else if (s === "projects") setRoute({ name: "projects" });
    else if (s === "profile") setRoute({ name: "profile" });
    else if (s === "settings") setRoute({ name: "settings" });
    else setRoute({ name: "soon", section: s });
  };

  const start = async (text: string, inProject: string | null, attachments: string[], clear: () => void) => {
    // Enter and the send button can both fire before the first start returns.
    if (!api || !text.trim() || starting.current) return;
    starting.current = true;
    setError(null);
    try {
      const task = await api.tasks.start({ projectId: inProject, brief: text.trim(), attachments });
      clear();
      setRoute({ name: "task", id: task.id });
    } catch (err) {
      report(err);
    } finally {
      starting.current = false;
    }
  };

  const attach = (list: string[], set: (update: (prev: string[]) => string[]) => void): Attachments | undefined =>
    api && {
      files: list,
      onAdd: () =>
        void api.files
          .pick()
          .then((picked) => set((prev) => [...new Set([...prev, ...picked])].slice(0, MAX_FILES)))
          .catch(report),
      onRemove: (path) => set((prev) => prev.filter((p) => p !== path)),
    };

  const sectionTitle: Record<"skills" | "jobs" | "board", string> = {
    skills: t("nav.skills"),
    jobs: t("nav.jobs"),
    board: t("nav.board"),
  };
  // Home starts on the project of the latest task (tasks come newest first), else the first project. With quick edit
  // turned off, "No project" isn't on offer, so the composer always works in a project.
  const lastUsed =
    tasks.find((x) => x.projectId && projects.some((p) => p.id === x.projectId))?.projectId ?? projects[0]?.id ?? null;
  const homeProjectId = projectId === undefined || (projectId === null && !quickEdit) ? lastUsed : projectId;

  // The menu bar's items. The handler is read through a ref, so the subscription doesn't change with every render.
  const focusComposer = () =>
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus());
  const openTask = route.name === "task" ? tasks.find((x) => x.id === route.id) : undefined;
  const onMenu = (action: MenuAction) => {
    if (action === "new-task") {
      setRoute({ name: "home" });
      focusComposer();
    } else if (action === "new-project") setDialogOpen(true);
    else if (action === "settings") setRoute({ name: "settings" });
    else if (action === "quick-edit") {
      if (!api || !quickEdit) return;
      void api.files.pick().then((picked) => {
        if (!picked.length) return;
        setFiles(picked.slice(0, MAX_FILES));
        setProjectId(null);
        setRoute({ name: "home" });
        focusComposer();
      }, report);
    } else if (action === "send") document.querySelector<HTMLButtonElement>(".composer .send:not(:disabled)")?.click();
    else if (!openTask || !api) return;
    else if (action === "stop") {
      if (openTask.status === "running" || openTask.status === "needs-you")
        void api.tasks.stop(openTask.id).catch(report);
    } else if (action === "rename") setRenaming(openTask.id);
    else if (action === "reveal") {
      // The newest file the task made or changed is selected in the folder; without one, the folder opens.
      const last = openTask.files.filter((f) => f.kind !== "delete" && f.role === "made").at(-1);
      void (last ? api.files.reveal(openTask.id, last.path) : api.tasks.reveal(openTask.id)).catch(report);
    }
  };
  const openStatus = openTask?.status;
  useEffect(() => {
    api?.menuState({ task: openStatus !== undefined, running: openStatus === "running" || openStatus === "needs-you" });
  }, [api, openStatus]);
  const menuHandler = useRef(onMenu);
  menuHandler.current = onMenu;
  useEffect(() => api?.onMenu((action) => menuHandler.current(action)), [api]);

  let screen: React.ReactNode;
  if (route.name === "home") {
    screen = (
      <Home
        userName={userName}
        brief={brief}
        onBriefChange={setBrief}
        projectId={homeProjectId}
        onProjectChange={setProjectId}
        allowNoProject={quickEdit}
        projects={projects}
        tasks={tasks}
        onStart={() =>
          !quickEdit && homeProjectId === null
            ? setDialogOpen(true)
            : void start(brief, homeProjectId, files, () => {
                setBrief("");
                setFiles([]);
              })
        }
        attach={attach(files, setFiles)}
        onOpenTask={(id) => setRoute({ name: "task", id })}
        onNewProject={() => setDialogOpen(true)}
      />
    );
  } else if (route.name === "projects") {
    screen = (
      <Projects
        projects={projects}
        counts={counts}
        onOpen={(id) => setRoute({ name: "project", id })}
        onNew={() => setDialogOpen(true)}
      />
    );
  } else if (route.name === "project") {
    const project = projects.find((p) => p.id === route.id);
    screen = project ? (
      <Project
        project={project}
        tasks={tasks}
        brief={projectBrief}
        onBriefChange={setProjectBrief}
        onStart={() =>
          void start(projectBrief, project.id, projectFiles, () => {
            setProjectBrief("");
            setProjectFiles([]);
          })
        }
        attach={attach(projectFiles, setProjectFiles)}
        onOpenTask={(id) => setRoute({ name: "task", id })}
        onBack={() => setRoute({ name: "projects" })}
      />
    ) : null;
  } else if (route.name === "task") {
    const task = tasks.find((x) => x.id === route.id);
    const project = task?.projectId ? (projects.find((p) => p.id === task.projectId) ?? null) : null;
    screen =
      task && api ? (
        <Task
          key={task.id}
          api={api}
          task={task}
          project={project}
          onAnswer={(answer) =>
            api.tasks.answer(task.id, answer).then(
              () => true,
              (err: unknown) => {
                report(err);
                return false;
              },
            )
          }
          onFollowUp={(text) => void api.tasks.followUp(task.id, text).catch(report)}
          onSaveCopy={() => api.tasks.saveCopy(task.id)}
          onDecide={(allow) => api.tasks.decide(task.id, allow)}
          onRestore={(path) => api.files.restore(task.id, path)}
          onStop={() => void api.tasks.stop(task.id).catch(report)}
          onOpenProject={() => project && setRoute({ name: "project", id: project.id })}
          onError={report}
          renaming={renaming === task.id && !tasks.slice(0, RECENT).some((x) => x.id === task.id)}
          onRenamed={(title) => {
            setRenaming(null);
            if (title && title !== task.title) void api.tasks.rename(task.id, title).catch(report);
          }}
        />
      ) : null;
  } else if (route.name === "profile") {
    screen = <Profile api={api} settings={current} onSaved={(next) => onSettings?.(next)} />;
  } else if (route.name === "settings") {
    screen = api ? <SettingsScreen api={api} settings={current} onChange={(next) => onSettings?.(next)} /> : null;
  } else {
    screen = <Soon section={sectionTitle[route.section]} />;
  }

  return (
    <div className="app">
      <Sidebar
        current={section}
        onNavigate={navigate}
        showSection={(key) => sectionOn(current, key)}
        userName={userName}
        isMac={isMac}
        tasks={tasks}
        openTaskId={route.name === "task" ? route.id : null}
        onOpenTask={(id) => setRoute({ name: "task", id })}
        onTaskMenu={openTaskMenu}
        onRenameTask={(id, title) => void api?.tasks.rename(id, title).catch(report)}
        onRevealTask={(id) => void api?.tasks.reveal(id).catch(report)}
        renaming={renaming}
        onRenamingChange={setRenaming}
        onDeleteTask={(id) =>
          void api?.tasks.remove(id).then((gone) => {
            if (!gone) return;
            removeTask(id);
            // Project cards count tasks in the store, so they ask again.
            void api.projects.taskCounts().then(setCounts, report);
            setRoute((r) => (r.name === "task" && r.id === id ? { name: "home" } : r));
          }, report)
        }
      />
      {screen ?? <div className="main" />}
      {error && (
        <div className="toast" role="alert">
          <span className="grow">{error}</span>
          <button type="button" className="iconbtn" aria-label={t("common.dismiss")} onClick={() => setError(null)}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {api && (
        <NewProjectDialog
          api={api}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onCreated={(p) => {
            addProject(p);
            setProjectId(p.id);
          }}
        />
      )}
    </div>
  );
}
