import { useMemo, useState } from "react";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { useT } from "@/lib/useT";
import { Home } from "@/screens/Home";
import { Project } from "@/screens/Project";
import { Projects } from "@/screens/Projects";
import { Soon } from "@/screens/Soon";
import { Task } from "@/screens/Task";
import { type Section, Sidebar } from "@/shell/Sidebar";
import { useData } from "@/state/useData";
import type { TostWorkApi } from "../../shared/api";

type Route =
  | { name: "home" }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "task"; id: string }
  | { name: "soon"; section: "skills" | "jobs" | "board" | "settings" };

export function App({ userName = "Giulia", api = window.tostWork }: { userName?: string; api?: TostWorkApi }) {
  const t = useT();
  const { projects, tasks, addProject } = useData(api);
  const [route, setRoute] = useState<Route>({ name: "home" });
  // The briefs live here so they survive a trip to another section.
  const [brief, setBrief] = useState("");
  const [projectBrief, setProjectBrief] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const isMac = api?.platform === "darwin";

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

  const start = async (text: string, inProject: string | null, clear: () => void) => {
    if (!api || !text.trim()) return;
    const task = await api.tasks.start({ projectId: inProject, brief: text.trim() });
    clear();
    setRoute({ name: "task", id: task.id });
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
        onStart={() => void start(brief, projectId, () => setBrief(""))}
        onOpenTask={(id) => setRoute({ name: "task", id })}
        onNewProject={() => setDialogOpen(true)}
      />
    );
  } else if (route.name === "projects") {
    screen = (
      <Projects
        projects={projects}
        tasks={tasks}
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
        onStart={() => void start(projectBrief, project.id, () => setProjectBrief(""))}
        onOpenTask={(id) => setRoute({ name: "task", id })}
        onBack={() => setRoute({ name: "projects" })}
      />
    ) : null;
  } else if (route.name === "task") {
    const task = tasks.find((x) => x.id === route.id);
    const project = task?.projectId ? (projects.find((p) => p.id === task.projectId) ?? null) : null;
    screen = task ? (
      <Task
        task={task}
        project={project}
        onAnswer={(answer) => void api?.tasks.answer(task.id, answer)}
        onStop={() => void api?.tasks.stop(task.id)}
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
