import { Dialog } from "@base-ui/react/dialog";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { TaskTag } from "@/components/TaskTag";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { Project, Task } from "../../../shared/model";
import { matchesWords, searchWords } from "../../../shared/search";

/** How many recent tasks show before the user types. */
const RECENT_SHOWN = 6;
/** How many projects show above the tasks. */
const PROJECTS_SHOWN = 5;

type Hit = { kind: "project"; project: Project } | { kind: "task"; task: Task };

type SearchProps = {
  api: TostWorkApi;
  projects: Project[];
  /** The recent tasks, newest first. */
  recent: Task[];
  onOpenTask: (id: string) => void;
  onOpenProject: (id: string) => void;
};

/**
 * A search field over tasks and projects, with its results under it. The arrows move through the results and Enter
 * opens one, while the typing stays in the field. In the dialog it lists the recent tasks before the user types; in the
 * sidebar the sidebar's own items stay until then, and the results take their place.
 */
export function SearchBox({
  api,
  projects,
  recent,
  onOpenTask,
  onOpenProject,
  onPicked,
  inputRef,
  end,
  inSidebar = false,
  children,
}: SearchProps & {
  /** Called as a result opens, before it does. */
  onPicked?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** After the field, as the dialog's close button. */
  end?: ReactNode;
  /** In the sidebar: Escape empties the field, then leaves it, and a pick empties it. */
  inSidebar?: boolean;
  /** In the sidebar: what shows under the field while nothing is typed. */
  children?: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;
  const [query, setQuery] = useState("");
  // The tasks found, and the query they were found for, so "nothing matches" waits for the answer to this one.
  const [found, setFound] = useState<{ query: string; tasks: Task[]; failed?: boolean }>({ query: "", tasks: [] });
  const [active, setActive] = useState(0);
  const words = searchWords(query);
  // Only the answer to the latest query counts: an earlier one can come back after it.
  useEffect(() => {
    if (searchWords(query).length === 0) {
      setFound({ query, tasks: [] });
      return;
    }
    let latest = true;
    api.tasks.search(query).then(
      (tasks) => latest && setFound({ query, tasks }),
      // Said under the field, which in the dialog covers the app's own error line.
      () => latest && setFound({ query, tasks: [], failed: true }),
    );
    return () => {
      latest = false;
    };
  }, [api, query]);
  const projectName = (task: Task) => projects.find((p) => p.id === task.projectId)?.name;
  const groups: { title: string; hits: Hit[] }[] =
    words.length === 0
      ? inSidebar
        ? []
        : [{ title: t("nav.recent"), hits: recent.slice(0, RECENT_SHOWN).map((task) => ({ kind: "task", task })) }]
      : [
          {
            title: t("nav.projects"),
            hits: projects
              .filter((p) => matchesWords(`${p.name}\n${p.description}`, words))
              .slice(0, PROJECTS_SHOWN)
              .map((project) => ({ kind: "project", project })),
          },
          // Only once they answer this query: an earlier answer would list tasks it doesn't match.
          {
            title: t("search.tasks"),
            hits: found.query === query ? found.tasks.map((task) => ({ kind: "task", task })) : [],
          },
        ];
  const hits = groups.flatMap((g) => g.hits);
  const at = Math.min(active, hits.length - 1);
  const choose = (hit: Hit | undefined) => {
    if (!hit) return;
    onPicked?.();
    if (inSidebar) {
      setQuery("");
      setActive(0);
      input.current?.blur();
    }
    if (hit.kind === "project") onOpenProject(hit.project.id);
    else onOpenTask(hit.task.id);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    // While an input method composes a word, its keys pick among its candidates.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length) setActive((at + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(hits[at]);
    } else if (e.key === "Escape" && inSidebar) {
      // The dialog closes on Escape by itself.
      e.preventDefault();
      if (query) {
        setQuery("");
        setActive(0);
      } else e.currentTarget.blur();
    }
  };
  const optionId = (n: number) => `${id}-hit-${n}`;
  const activeId = hits.length ? optionId(at) : undefined;
  // The arrows can go past the list's visible part: it scrolls to keep the one Enter opens in view.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);
  let n = -1;
  const answered = found.query === query;
  return (
    <>
      <div className={inSidebar ? "search" : "search-field"}>
        <Icon name="search" />
        <input
          ref={input}
          // The rail's search icon hands the keyboard's focus to it, and Escape hands it back.
          data-nav={inSidebar ? "search" : undefined}
          role="combobox"
          aria-label={t("search.label")}
          aria-expanded={hits.length > 0}
          aria-controls={`${id}-hits`}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          placeholder={inSidebar ? t("nav.search") : t("search.label")}
          value={query}
          maxLength={200}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={key}
        />
        {end}
      </div>
      {inSidebar && words.length === 0 ? (
        children
      ) : (
        <div className="search-hits" id={`${id}-hits`} role="listbox" aria-label={t("nav.search")}>
          {groups
            .filter((g) => g.hits.length > 0)
            .map((g) => (
              // The headings are for the eye: each option's own text says what it is.
              <Fragment key={g.title}>
                <div className="search-h" aria-hidden="true">
                  {g.title}
                </div>
                {g.hits.map((hit) => {
                  n += 1;
                  const index = n;
                  const name = hit.kind === "project" ? hit.project.name : hit.task.title;
                  // The sidebar is too narrow for the project's name beside the task's.
                  const where = hit.kind === "task" && !inSidebar ? projectName(hit.task) : undefined;
                  return (
                    <div
                      key={`${hit.kind}-${hit.kind === "project" ? hit.project.id : hit.task.id}`}
                      id={optionId(index)}
                      role="option"
                      tabIndex={-1}
                      aria-selected={index === at}
                      className={index === at ? "search-hit on" : "search-hit"}
                      onPointerMove={() => index !== at && setActive(index)}
                      // Picked on press, which keeps the focus in the field, as the arrows and Enter do.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(hit);
                      }}
                    >
                      <Icon name={hit.kind === "project" ? "folder" : "chat-3"} />
                      <span className="grow truncate">{name}</span>
                      {where && <span className="t3 truncate where">{where}</span>}
                      {hit.kind === "task" && <TaskTag task={hit.task} />}
                    </div>
                  );
                })}
              </Fragment>
            ))}
        </div>
      )}
      {found.failed && answered && (
        <p className="search-none" role="alert">
          {t("search.failed")}
        </p>
      )}
      {words.length > 0 && answered && !found.failed && hits.length === 0 && (
        <p className="search-none t3">{t("search.none", { query: query.trim() })}</p>
      )}
    </>
  );
}

/**
 * Search in a window over the page, opened from the rail or ⌘K. It opens empty, on the recent tasks, however it was
 * last closed, because its field goes with it.
 */
export function SearchDialog({
  open,
  onOpenChange,
  ...search
}: SearchProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-backdrop" />
        <Dialog.Popup className="dlg search-dlg" initialFocus={input}>
          <Dialog.Title className="sr-only">{t("nav.search")}</Dialog.Title>
          <SearchBox
            {...search}
            inputRef={input}
            onPicked={() => onOpenChange(false)}
            end={
              <Dialog.Close className="iconbtn" aria-label={t("common.dismiss")} title={t("common.dismiss")}>
                <Icon name="close" />
              </Dialog.Close>
            }
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
