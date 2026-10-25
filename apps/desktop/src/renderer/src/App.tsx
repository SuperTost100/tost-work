import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Attachments } from "@/components/Composer";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import { Home } from "@/screens/Home";
import { Project } from "@/screens/Project";
import { Projects } from "@/screens/Projects";
import { Soon } from "@/screens/Soon";
import { Task } from "@/screens/Task";
import { type Section, Sidebar } from "@/shell/Sidebar";
import { useData } from "@/state/useData";
import type { TostWorkApi } from "../../shared/api";

/** The main process accepts up to 20 attachments per task. */
const MAX_FILES = 20;

type Route =
  | { name: "home" }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "task"; id: string }
  | { name: "soon"; section: "skills" | "jobs" | "board" | "settings" };

export function App({ userName = "Giulia", api = window.tostWork }: { userName?: string; api?: TostWorkApi }) {
  const t = useT();
  const { projects, tasks, addProject, loadProject } = useData(api);
  const [route, setRoute] = useState<Route>({ name: "home" });
  // The briefs live here so they survive a trip to another section.
  const [brief, setBrief] = useState("");
  const [projectBrief, setProjectBrief] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);
  const report = useCallback((err: unknown) => setError(err instanceof Error ? err.message : String(err)), []);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const isMac = api?.platform === "darwin";

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
      default:
        return null;
    }
  }, [route]);

  const navigate = (s: Section) => {
    if (s === "home") setRoute({ name: "home" });
    else if (s === "projects") setRoute({ name: "projects" });
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
        void api.files.pick().then((picked) => set((prev) => [...new Set([...prev, ...picked])].slice(0, MAX_FILES))),
      onRemove: (path) => set((prev) => prev.filter((p) => p !== path)),
    };

  const sectionTitle: Record<"skills" | "jobs" | "board" | "settings", string> = {
    skills: t("nav.skills"),
    jobs: t("nav.jobs"),
    board: t("nav.board"),
    settings: t("nav.settings"),
  };

  let screen: React.ReactNode;
  if (route.name === "home") {
    screen = (
      <Home
        userName={userName}
        brief={brief}
        onBriefChange={setBrief}
        projectId={projectId}
        onProjectChange={setProjectId}
        projects={projects}
        tasks={tasks}
        onStart={() =>
          void start(brief, projectId, files, () => {
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
        />
      ) : null;
  } else {
    screen = <Soon section={sectionTitle[route.section]} />;
  }

  return (
    <div className="app">
      <Sidebar
        current={section}
        onNavigate={navigate}
        userName={userName}
        isMac={isMac}
        tasks={tasks}
        openTaskId={route.name === "task" ? route.id : null}
        onOpenTask={(id) => setRoute({ name: "task", id })}
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
