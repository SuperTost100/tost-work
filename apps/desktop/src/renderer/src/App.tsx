import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Attachments, attachments } from "@/components/Composer";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { ModelPicker } from "@/components/ModelPicker";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { ProjectInstructionsDialog } from "@/components/ProjectInstructionsDialog";
import { SavedToast } from "@/components/SavedToast";
import { SearchDialog } from "@/components/SearchDialog";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { useConfirm } from "@/lib/useConfirm";
import { useT } from "@/lib/useT";
import { About, type AboutPage } from "@/screens/About";
import { Board } from "@/screens/Board";
import { Home } from "@/screens/Home";
import { Jobs } from "@/screens/Jobs";
import { Profile } from "@/screens/Profile";
import { Project } from "@/screens/Project";
import { Projects } from "@/screens/Projects";
import { Settings as SettingsScreen } from "@/screens/Settings";
import { Skills } from "@/screens/Skills";
import { Soon } from "@/screens/Soon";
import { Task } from "@/screens/Task";
import { RECENT, type Section, Sidebar, SidebarRail } from "@/shell/Sidebar";
import { useData } from "@/state/useData";
import type { MenuAction, ProjectMenuAction, TaskMenuAction, TostWorkApi } from "../../shared/api";
import {
  ATTACH_MAX,
  DEFAULT_SETTINGS,
  type ProjectOverview,
  type Settings,
  sectionOn,
  type Task as TaskT,
} from "../../shared/model";
import type { ModelPick } from "../../shared/modelChoice";

/** The main process accepts up to 20 attachments per task. */

/** Where typing happens: Cmd+B belongs to the text there, not to the sidebar. */
// Only an editor that makes text bold keeps Cmd+B; in a plain field, such as the task box, it toggles the sidebar.
const BOLDS = '[contenteditable]:not([contenteditable="false"])';

type Route =
  | { name: "home" }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "task"; id: string }
  | { name: "profile" }
  | { name: "settings" }
  | { name: "about"; page: AboutPage }
  | { name: "soon"; section: "skills" | "jobs" | "board" };

interface AppProps {
  userName?: string;
  api?: TostWorkApi;
  /** The saved settings. Without them the app uses the defaults with this user's name. */
  settings?: Settings;
  onSettings?: (settings: Settings) => void;
}

/** The app, with the card that asks before anything that can't be undone mounted once above it. */
export function App(props: AppProps) {
  return (
    <ConfirmProvider>
      <AppScreens {...props} />
    </ConfirmProvider>
  );
}

function AppScreens({ userName = "Giulia", api = window.tostWork, settings, onSettings }: AppProps) {
  const t = useT();
  const confirm = useConfirm();
  const current = settings ?? { ...DEFAULT_SETTINGS, name: userName, setupDone: true };
  const quickEdit = sectionOn(current, "quickEdit");
  const boardOn = sectionOn(current, "board");
  const {
    projects,
    tasks,
    addProject,
    updateProject,
    removeProject,
    loadProject,
    loadAll,
    loadTask,
    addTask,
    removeTask,
  } = useData(api);
  const [route, setRoute] = useState<Route>({ name: "home" });
  // While debug is on, the app log gets a line for each screen: its name and ids, never a title or a file.
  const debugOn = current.debug;
  useEffect(() => {
    if (!debugOn) return;
    const { name, ...ids } = route;
    api?.debug.screen({ name, ...ids });
  }, [route, debugOn, api]);
  // The project whose "Add job" opened Jobs, so the builder starts in it.
  const [jobFor, setJobFor] = useState<string | null>(null);
  const clearJobFor = useCallback(() => setJobFor(null), []);
  // The briefs live here so they survive a trip to another section.
  const [brief, setBrief] = useState("");
  const [projectBrief, setProjectBrief] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  // undefined until the user picks: then Home offers the project used last. null is "No project", picked on purpose.
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);
  // What the next new task runs on. Settings remembers it; it changes here at once and is saved behind it.
  const [pick, setPick] = useState<ModelPick>(current.modelPick);
  const remembered = JSON.stringify(current.modelPick);
  useEffect(() => setPick(JSON.parse(remembered) as ModelPick), [remembered]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  // The project whose description is being edited in place.
  const [describingProject, setDescribingProject] = useState<string | null>(null);
  // The project whose instructions are being edited in the dialog.
  const [instructionsFor, setInstructionsFor] = useState<string | null>(null);
  // useT gives a new function on each render; through a ref, report stays the same function and effects that use it
  // don't run again.
  const words = useRef(t);
  words.current = t;
  const report = useCallback((err: unknown) => setError(errorText(err, words.current)), []);
  // Only the latest save is applied: an earlier one answering late would bring back the pick it saved.
  const pickSave = useRef(0);
  const changePick = (next: ModelPick) => {
    setPick(next);
    const save = ++pickSave.current;
    void api?.settings.update({ modelPick: next }).then((saved) => {
      if (save === pickSave.current) onSettings?.(saved);
    }, report);
  };
  const modelPicker = api && <ModelPicker api={api} pick={pick} onChange={changePick} />;
  const [overviews, setOverviews] = useState<Record<string, ProjectOverview>>({});
  const isMac = api?.platform === "darwin";
  const renameProject = (id: string, name: string | null) => {
    setRenamingProject(null);
    if (name && api) void api.projects.update(id, { name }).then(updateProject, report);
  };
  const describeProject = (id: string, description: string | null) => {
    setDescribingProject(null);
    if (description !== null && api) void api.projects.update(id, { description }).then(updateProject, report);
  };
  const dropProject = (id: string) => {
    // Its tasks and jobs go with it, so whatever of them is open, or picked, must not stay.
    const taskIds = tasks.filter((x) => x.projectId === id).map((x) => x.id);
    void (async () => {
      if (!api) return;
      const { message, detail } = await api.projects.removalText(id);
      if (!(await confirm({ message, detail, yes: t("project.removeYes"), danger: true }))) return;
      await api.projects.remove(id);
      removeProject(id, taskIds);
      setOverviews(({ [id]: _removed, ...rest }) => rest);
      setProjectId((picked) => (picked === id ? undefined : picked));
      setJobFor((job) => (job === id ? null : job));
      setRoute((r) =>
        (r.name === "project" && r.id === id) || (r.name === "task" && taskIds.includes(r.id)) ? { name: "home" } : r,
      );
    })().catch(report);
  };
  const deleteTask = async (id: string) => {
    const task = tasks.find((x) => x.id === id);
    if (!api || !task) return;
    try {
      const sure = await confirm({
        message: t("delete.confirm", { name: task.title }),
        detail: t("delete.detail"),
        yes: t("delete.yes"),
        danger: true,
      });
      if (!sure) return;
      await api.tasks.remove(id);
      removeTask(id);
      setRoute((r) => (r.name === "task" && r.id === id ? { name: "home" } : r));
    } catch (err) {
      report(err);
    }
  };
  const openProjectMenu = async (id: string) => {
    let action: ProjectMenuAction | null = null;
    try {
      action = (await api?.projects.menu(id)) ?? null;
    } catch (err) {
      report(err);
    }
    if (action === "rename") setRenamingProject(id);
    else if (action === "describe") setDescribingProject(id);
    else if (action === "instructions") setInstructionsFor(id);
    else if (action === "reveal") void api?.projects.reveal(id).catch(report);
    else if (action === "remove") dropProject(id);
  };
  // Starting a saved task opens it, to watch it work, as starting a new one does.
  const startSaved = (id: string) =>
    void api?.tasks.startSaved(id, pick).then((task) => {
      addTask(task);
      setRoute({ name: "task", id: task.id });
    }, report);
  // The task menu, the same in Recent and on the Board. Rename is the one item carried out where the menu opened,
  // since the title there turns into the field.
  const taskMenu = async (id: string, rename: () => void) => {
    if (!api) return;
    let action: TaskMenuAction | null = null;
    try {
      action = await api.tasks.menu(id);
    } catch (err) {
      report(err);
    }
    if (action === "rename") rename();
    else if (action === "reveal") void api.tasks.reveal(id).catch(report);
    else if (action === "start") startSaved(id);
    else if (action === "review") void api.tasks.markReviewed(id).then(addTask, report);
    else if (action === "unreview") void api.tasks.markUnreviewed(id).then(addTask, report);
    else if (action === "delete") void deleteTask(id);
    else if (action === "log-open") void api.debug.revealTaskLog(id).catch(report);
    else if (action === "log-copy") void api.debug.copyTaskLog(id).catch(report);
  };
  // The task just saved for later, which the message at the bottom of the window can open.
  const [savedId, setSavedId] = useState<string | null>(null);
  const closeSaved = useCallback(() => setSavedId(null), []);
  const savedForLater = (task: TaskT) => {
    addTask(task);
    setSavedId(task.id);
  };

  const openProjectId = route.name === "project" ? route.id : null;
  useEffect(() => {
    if (openProjectId) loadProject(openProjectId).catch(report);
  }, [openProjectId, loadProject, report]);
  // Counted in the store, because the task list here holds only the recent ones. Asked again as tasks change, so a
  // card's tag follows its tasks while the page is open.
  useEffect(() => {
    if (route.name === "projects" && tasks) void api?.projects.overviews().then(setOverviews, report);
  }, [route.name, api, report, tasks]);
  // The board lists every task, past the recent ones the window keeps.
  const boardOpen = route.name === "soon" && route.section === "board";
  useEffect(() => {
    if (boardOpen) loadAll().catch(report);
  }, [boardOpen, loadAll, report]);

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
      case "about":
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
    if (!api || (!text.trim() && !attachments.length) || starting.current) return;
    starting.current = true;
    setError(null);
    try {
      const task = await api.tasks.start({ projectId: inProject, brief: text.trim(), attachments, pick });
      clear();
      setRoute({ name: "task", id: task.id });
    } catch (err) {
      report(err);
    } finally {
      starting.current = false;
    }
  };
  // Saved without starting, to wait in the board's Drafts. The user stays where they are, with an empty box.
  const saveLater = async (text: string, inProject: string | null, attachments: string[], clear: () => void) => {
    if (!api || (!text.trim() && !attachments.length) || starting.current) return;
    starting.current = true;
    setError(null);
    try {
      savedForLater(await api.tasks.saveForLater({ projectId: inProject, brief: text.trim(), attachments }));
      clear();
    } catch (err) {
      report(err);
    } finally {
      starting.current = false;
    }
  };

  const attach = (list: string[], set: (update: (prev: string[]) => string[]) => void): Attachments | undefined =>
    api && attachments(api, list, set, report);

  // A section turned off in Settings while it's open goes back to Home, so nothing of it stays usable.
  const shownSection = route.name === "soon" ? route.section : null;
  const sectionStillOn = shownSection === null || sectionOn(current, shownSection);
  useEffect(() => {
    if (!sectionStillOn) setRoute({ name: "home" });
  }, [sectionStillOn]);

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
  const sidebarHidden = current.sidebarHidden;
  // The value asked for last, so a second press before the first is saved undoes it rather than asking the same.
  const wantedHidden = useRef<boolean | null>(null);
  const toggleSidebar = () => {
    const hidden = !(wantedHidden.current ?? sidebarHidden);
    wantedHidden.current = hidden;
    // A press that fails is forgotten only while it's still the latest, so a newer one keeps its place.
    const settled = () => {
      if (wantedHidden.current === hidden) wantedHidden.current = null;
    };
    void api?.settings.update({ sidebarHidden: hidden }).then(
      (next) => {
        settled();
        onSettings?.(next);
      },
      (err: unknown) => {
        settled();
        report(err);
      },
    );
  };
  const onMenu = (action: MenuAction) => {
    if (action === "toggle-sidebar") toggleSidebar();
    else if (action === "new-task") {
      setRoute({ name: "home" });
      focusComposer();
    } else if (action === "new-project") setDialogOpen(true);
    else if (action === "settings") setRoute({ name: "settings" });
    else if (action === "about") setRoute({ name: "about", page: "home" });
    else if (action === "quick-edit") {
      if (!api || !quickEdit) return;
      void api.files.pick().then((picked) => {
        if (!picked.length) return;
        setFiles(picked.slice(0, ATTACH_MAX));
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
  // Cmd+B is no menu shortcut, because a menu would take the key from the Skills editor, where it makes text bold.
  // The window handles it, and leaves it to the editors where it makes text bold.
  const toggleHandler = useRef(toggleSidebar);
  toggleHandler.current = toggleSidebar;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((key !== "b" && key !== "k") || e.shiftKey || e.altKey || e.defaultPrevented) return;
      if (isMac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return;
      // Cmd+K opens the search from anywhere, the composer included, and closes it again.
      if (key === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }
      if (e.target instanceof Element && e.target.closest(BOLDS)) return;
      e.preventDefault();
      toggleHandler.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMac]);
  // The task may be older than the recent list, so it's loaded before the route turns to it. Only the latest click
  // counts, and only while the user hasn't gone elsewhere meanwhile; a task that's gone says so and stays put.
  const routeNow = useRef(route);
  // After the route is shown, not during a render React may throw away.
  useLayoutEffect(() => {
    routeNow.current = route;
  }, [route]);
  const opening = useRef(0);
  const openLoaded = useCallback(
    (id: string) => {
      const ticket = ++opening.current;
      const from = routeNow.current;
      loadTask(id).then(
        (found) => {
          if (ticket !== opening.current || routeNow.current !== from) return;
          if (found) setRoute({ name: "task", id });
          else setError(t("task.gone"));
        },
        (err: unknown) => ticket === opening.current && report(err),
      );
    },
    [loadTask, report, t],
  );
  useEffect(() => api?.onOpenTask(openLoaded), [api, openLoaded]);
  // A task the search found may be older than the recent list too. One that's in it opens at once, and a click
  // still loading is dropped.
  const openFound = (id: string) => {
    if (!tasks.some((x) => x.id === id)) return openLoaded(id);
    opening.current++;
    setRoute({ name: "task", id });
  };

  const instructionsProject = projects.find((p) => p.id === instructionsFor);
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
        onSaveLater={
          boardOn
            ? () =>
                !quickEdit && homeProjectId === null
                  ? setDialogOpen(true)
                  : void saveLater(brief, homeProjectId, files, () => {
                      setBrief("");
                      setFiles([]);
                    })
            : undefined
        }
        attach={attach(files, setFiles)}
        onOpenTask={(id) => setRoute({ name: "task", id })}
        onStartSaved={startSaved}
        onNewProject={() => setDialogOpen(true)}
        modelPicker={modelPicker}
      />
    );
  } else if (route.name === "projects") {
    screen = (
      <Projects
        projects={projects}
        overviews={overviews}
        onOpen={(id) => setRoute({ name: "project", id })}
        onNew={() => setDialogOpen(true)}
        onMenu={(id) => void openProjectMenu(id)}
        renaming={renamingProject}
        onRenamed={renameProject}
        describing={describingProject}
        onDescribed={describeProject}
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
        onSaveLater={
          boardOn
            ? () =>
                void saveLater(projectBrief, project.id, projectFiles, () => {
                  setProjectBrief("");
                  setProjectFiles([]);
                })
            : undefined
        }
        attach={attach(projectFiles, setProjectFiles)}
        onOpenTask={(id) => setRoute({ name: "task", id })}
        onAddJob={
          sectionOn(current, "jobs")
            ? () => {
                setJobFor(project.id);
                setRoute({ name: "soon", section: "jobs" });
              }
            : undefined
        }
        onBack={() => setRoute({ name: "projects" })}
        onMenu={() => void openProjectMenu(project.id)}
        renaming={renamingProject === project.id}
        onRenamed={(name) => renameProject(project.id, name)}
        describing={describingProject === project.id}
        onDescribed={(description) => describeProject(project.id, description)}
        onEditInstructions={() => setInstructionsFor(project.id)}
        modelPicker={modelPicker}
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
          debug={current.debug}
          onAnswer={(answers, files) =>
            api.tasks.answer(task.id, answers, files).then(
              () => true,
              (err: unknown) => {
                report(err);
                return false;
              },
            )
          }
          onFollowUp={(text, files) =>
            api.tasks.followUp(task.id, text, files).then(
              () => true,
              (err: unknown) => {
                report(err);
                return false;
              },
            )
          }
          onSaveCopy={() => api.tasks.saveCopy(task.id)}
          onDecide={(allow) => api.tasks.decide(task.id, allow)}
          onRestore={(path) => api.files.restore(task.id, path)}
          onStop={() => void api.tasks.stop(task.id).catch(report)}
          onResume={() => void api.tasks.resume(task.id).catch(report)}
          onStartSaved={() => void api.tasks.startSaved(task.id, pick).then(addTask, report)}
          modelPicker={modelPicker}
          projects={projects}
          allowNoProject={quickEdit}
          onNewProject={() => setDialogOpen(true)}
          onSaveDraft={(edit) =>
            api.tasks.updateDraft(task.id, edit).then(
              (next) => {
                addTask(next);
                return true;
              },
              (err: unknown) => {
                report(err);
                return false;
              },
            )
          }
          onMarkReviewed={() => void api.tasks.markReviewed(task.id).then(addTask, report)}
          onOpenProject={() => project && setRoute({ name: "project", id: project.id })}
          onError={report}
          // Recent tasks are renamed in the sidebar; with the sidebar hidden, here.
          renaming={renaming === task.id && (sidebarHidden || !tasks.slice(0, RECENT).some((x) => x.id === task.id))}
          onRenamed={(title) => {
            setRenaming(null);
            if (title && title !== task.title) void api.tasks.rename(task.id, title).catch(report);
          }}
        />
      ) : null;
  } else if (route.name === "profile") {
    screen = <Profile api={api} settings={current} onSaved={(next) => onSettings?.(next)} />;
  } else if (route.name === "settings") {
    screen = api ? (
      <SettingsScreen
        api={api}
        settings={current}
        onChange={(next) => onSettings?.(next)}
        onAbout={() => setRoute({ name: "about", page: "home" })}
        onNews={() => setRoute({ name: "about", page: "news" })}
      />
    ) : null;
  } else if (route.name === "about") {
    screen = api ? (
      <About
        api={api}
        page={route.page}
        onPage={(page) => setRoute({ name: "about", page })}
        onSettings={() => setRoute({ name: "settings" })}
      />
    ) : null;
  } else if (route.section === "skills" && api) {
    screen = <Skills api={api} tasks={tasks} />;
  } else if (route.section === "jobs" && api && sectionStillOn) {
    screen = (
      <Jobs
        api={api}
        projects={projects}
        tasks={tasks}
        newFor={jobFor}
        onNewHandled={clearJobFor}
        onOpenTask={(id) => setRoute({ name: "task", id })}
        onError={report}
      />
    );
  } else if (route.section === "board" && api && sectionStillOn) {
    screen = (
      <Board
        api={api}
        tasks={tasks}
        projects={projects}
        settings={current}
        onSettings={(next) => onSettings?.(next)}
        allowNoProject={quickEdit}
        onOpenTask={(id) => setRoute({ name: "task", id })}
        onTaskChanged={addTask}
        onSavedForLater={savedForLater}
        onTaskMenu={(id, rename) => void taskMenu(id, rename)}
        onError={report}
      />
    );
  } else {
    screen = <Soon section={sectionTitle[route.section]} />;
  }

  // The sidebar, in place or, from the rail, over the page.
  const sidebar = (pinned: boolean) => (
    <Sidebar
      onCollapse={toggleSidebar}
      pinned={pinned}
      current={section}
      onNavigate={navigate}
      showSection={(key) => sectionOn(current, key)}
      userName={userName}
      isMac={isMac}
      tasks={tasks}
      openTaskId={route.name === "task" ? route.id : null}
      onOpenTask={(id) => setRoute({ name: "task", id })}
      onTaskMenu={(id, rename) => void taskMenu(id, rename)}
      onRenameTask={(id, title) => void api?.tasks.rename(id, title).catch(report)}
      // Over the page, a task is renamed in its header, as with the sidebar hidden: the sidebar may close meanwhile.
      renaming={pinned ? renaming : null}
      // So the task opens first, to be renamed in its header.
      onRenamingChange={(id) => {
        if (id && !pinned) setRoute({ name: "task", id });
        setRenaming(id);
      }}
      search={
        api && {
          api,
          projects,
          recent: tasks,
          onOpenTask: openFound,
          onOpenProject: (id) => setRoute({ name: "project", id }),
        }
      }
    />
  );
  return (
    <div className={`app${sidebarHidden ? " side-hidden" : ""}${isMac ? " mac" : ""}`}>
      {sidebarHidden ? (
        <SidebarRail
          current={section}
          onNavigate={navigate}
          showSection={(key) => sectionOn(current, key)}
          userName={userName}
          isMac={isMac}
          onExpand={toggleSidebar}
          onSearch={() => setSearchOpen(true)}
        >
          {sidebar(false)}
        </SidebarRail>
      ) : (
        sidebar(true)
      )}
      {screen ?? <div className="main" />}
      <div className="toasts">
        {error && (
          <div className="toast" role="alert">
            <span className="grow">{error}</span>
            <button type="button" className="iconbtn" aria-label={t("common.dismiss")} onClick={() => setError(null)}>
              <Icon name="close" />
            </button>
          </div>
        )}
        {/* Always there and empty until a task is saved, so screen readers announce the message when it comes. */}
        <div role="status">
          {savedId && (
            <SavedToast
              key={savedId}
              onOpen={() => {
                setSavedId(null);
                openFound(savedId);
              }}
              onClose={closeSaved}
            />
          )}
        </div>
      </div>
      {api && instructionsProject && (
        <ProjectInstructionsDialog
          key={instructionsProject.id}
          project={instructionsProject}
          onSave={async (instructions) =>
            updateProject(await api.projects.update(instructionsProject.id, { instructions }))
          }
          onClose={() => setInstructionsFor(null)}
        />
      )}
      {api && (
        <SearchDialog
          api={api}
          open={searchOpen}
          onOpenChange={setSearchOpen}
          projects={projects}
          recent={tasks}
          onOpenTask={openFound}
          onOpenProject={(id) => setRoute({ name: "project", id })}
        />
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
