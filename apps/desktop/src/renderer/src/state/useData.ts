import { useCallback, useEffect, useRef, useState } from "react";
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
  // Deleted tasks, so a list that was read before the deletion can't bring one back.
  const removed = useRef(new Set<string>());
  const merge = useCallback(
    (incoming: Task[]) =>
      setTasks((list) =>
        mergeTasks(
          list,
          incoming.filter((t) => !removed.current.has(t.id)),
        ),
      ),
    [],
  );

  useEffect(() => {
    if (!api) return;
    let alive = true;
    const off = api.tasks.onChange((task) => merge([task]));
    void api.projects
      .list()
      .then((p) => alive && setProjects((list) => [...p, ...list.filter((x) => !p.some((y) => y.id === x.id))]));
    void api.tasks.list().then((t) => alive && merge(t));
    return () => {
      alive = false;
      off();
    };
  }, [api, merge]);

  const addProject = useCallback(
    (p: Project) => setProjects((list) => (list.some((x) => x.id === p.id) ? list : [...list, p])),
    [],
  );
  // The recent list stops at 50 tasks, so a project page loads its whole history when it opens.
  const loadProject = useCallback(
    async (projectId: string): Promise<void> => {
      if (!api) return;
      merge(await api.tasks.listForProject(projectId));
    },
    [api, merge],
  );
  const removeTask = useCallback((id: string) => {
    removed.current.add(id);
    setTasks((list) => list.filter((t) => t.id !== id));
  }, []);

  /** Loads one task that may not be among the recent ones, such as the one a notification opens. False if it's gone. */
  const loadTask = useCallback(
    async (id: string): Promise<boolean> => {
      const task = await api?.tasks.get(id);
      if (task) merge([task]);
      return Boolean(task);
    },
    [api, merge],
  );

  return { projects, tasks, addProject, loadProject, loadTask, removeTask };
}
