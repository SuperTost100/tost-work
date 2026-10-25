import { useCallback, useEffect, useState } from "react";
import type { TostWorkApi } from "../../../shared/api";
import type { Project, Task } from "../../../shared/model";

/**
 * Merges task lists by id, keeping the most recently updated copy of each task. The first `list()` can resolve after
 * a change event has already arrived, so replacing the state with it would lose that change.
 */
export function mergeTasks(current: Task[], incoming: Task[]): Task[] {
  const byId = new Map(current.map((t) => [t.id, t]));
  for (const t of incoming) {
    const known = byId.get(t.id);
    if (!known || t.updatedAt >= known.updatedAt) byId.set(t.id, t);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Projects and tasks from the main process, kept up to date as tasks change. */
export function useData(api: TostWorkApi | undefined) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    const off = api.tasks.onChange((task) => setTasks((list) => mergeTasks(list, [task])));
    void api.projects
      .list()
      .then((p) => alive && setProjects((list) => [...p, ...list.filter((x) => !p.some((y) => y.id === x.id))]));
    void api.tasks.list().then((t) => alive && setTasks((list) => mergeTasks(list, t)));
    return () => {
      alive = false;
      off();
    };
  }, [api]);

  const addProject = useCallback(
    (p: Project) => setProjects((list) => (list.some((x) => x.id === p.id) ? list : [...list, p])),
    [],
  );
  // The recent list stops at 50 tasks, so a project page loads its whole history when it opens.
  const loadProject = useCallback(
    (projectId: string) => {
      if (!api) return;
      void api.tasks.listForProject(projectId).then((t) => setTasks((list) => mergeTasks(list, t)));
    },
    [api],
  );
  return { projects, tasks, addProject, loadProject };
}
