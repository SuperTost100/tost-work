import { Dialog } from "@base-ui/react/dialog";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { Switch } from "@/components/Switch";
import { TaskTag } from "@/components/TaskTag";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { useConfirm } from "@/lib/useConfirm";
import { LanguageContext, useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { MessageKey } from "../../../shared/i18n";
import { JOB_GROUPS, type JobGroup, jobGroup, scheduleText, WEEK, weekday, whenText } from "../../../shared/jobText";
import type { Job, JobDraft, Project, Task } from "../../../shared/model";
import { JOB_REPEATS, type JobRepeat, upcoming } from "../../../shared/schedule";

/** How often the list works out its groups and next runs again, so "today" doesn't stay today past midnight. */
const CLOCK_MS = 60_000;

const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** The folder as a path from the project's folder, or null when it isn't inside it. "" is the project folder itself. */
export function insideProject(project: string, folder: string): string | null {
  // A drive letter or a network share: a Windows path, where a backslash separates folders and case doesn't matter.
  // Elsewhere a backslash is part of a folder's name.
  const windows = /^[A-Za-z]:|^\\\\/.test(project);
  const slashes = (p: string) => (windows ? p.replace(/\\/g, "/") : p).replace(/\/+$/, "");
  const root = slashes(project);
  const picked = slashes(folder);
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(picked, root)) return "";
  return same(picked.slice(0, root.length + 1), `${root}/`) ? picked.slice(root.length + 1) : null;
}

/** Where the picker should open: the project's folder, or the subfolder already chosen in it. */
const joinPath = (project: string, sub: string) => (sub ? `${project.replace(/[\\/]+$/, "")}/${sub}` : project);

/** The task the job's latest run started, if it's among the ones loaded. */
function lastTaskOf(job: Job, tasks: Task[]): Task | undefined {
  const last = job.last;
  return last && "taskId" in last ? tasks.find((x) => x.id === last.taskId) : undefined;
}

/** Jobs: every job grouped by its next run, with Skip once, on and off, and the builder to make and change them. */
export function Jobs({
  api,
  projects,
  tasks,
  newFor,
  onNewHandled,
  onOpenTask,
  onError,
}: {
  api: TostWorkApi;
  projects: Project[];
  tasks: Task[];
  /** A project whose "Add job" opened this screen: the builder starts in it. */
  newFor?: string | null;
  onNewHandled?: () => void;
  onOpenTask: (id: string) => void;
  onError: (err: unknown) => void;
}) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  // null: closed; a job: editing it; "new": making one, in the project given.
  const [editing, setEditing] = useState<Job | { projectId: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    api.jobs.list().then(
      (list) => alive && setJobs(list),
      (err: unknown) => {
        if (alive) setJobs([]);
        onError(err);
      },
    );
    const off = api.jobs.onChange((change) =>
      setJobs((list) => {
        const rest = (list ?? []).filter((j) => j.id !== change.id);
        return "removed" in change ? rest : [...rest, change].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      }),
    );
    const clock = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => {
      alive = false;
      off();
      clearInterval(clock);
    };
  }, [api, onError]);

  useEffect(() => {
    if (newFor === undefined || newFor === null) return;
    setEditing({ projectId: newFor });
    onNewHandled?.();
  }, [newFor, onNewHandled]);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";
  const groups = new Map<JobGroup, { job: Job; next: Date | null }[]>();
  for (const job of jobs ?? []) {
    const next = upcoming(job, now);
    const group = jobGroup(next, now);
    groups.set(group, [...(groups.get(group) ?? []), { job, next }]);
  }
  for (const list of groups.values()) list.sort((a, b) => (a.next?.getTime() ?? 0) - (b.next?.getTime() ?? 0));

  const act = (work: Promise<unknown>) => void work.catch(onError);

  return (
    <div className="main">
      <div className="top" />
      <div className="scroll">
        <div className="wcol">
          <div className="phead">
            <h1 className="grow">{t("nav.jobs")}</h1>
            <button
              type="button"
              className="btn dark"
              disabled={projects.length === 0}
              title={projects.length === 0 ? t("jobs.needProject") : undefined}
              onClick={() => setEditing({ projectId: null })}
            >
              <Icon name="add" />
              {t("jobs.new")}
            </button>
          </div>
          {jobs?.length === 0 && (
            <div className="jempty">
              <b>{t("jobs.empty")}</b>
              <p>{projects.length === 0 ? t("jobs.needProject") : t("jobs.emptyBody")}</p>
            </div>
          )}
          {JOB_GROUPS.filter((g) => groups.has(g)).map((group) => (
            <section key={group} aria-label={t(`jobs.group.${group}` as MessageKey)}>
              <div className="jgh">{t(`jobs.group.${group}` as MessageKey)}</div>
              {(groups.get(group) ?? []).map(({ job, next }) => (
                <JobRow
                  key={job.id}
                  job={job}
                  next={next}
                  now={now}
                  project={projectName(job.projectId)}
                  lastTask={lastTaskOf(job, tasks)}
                  onEdit={() => setEditing(job)}
                  onSkip={() => act(api.jobs.skipOnce(job.id))}
                  onToggle={(on) => act(api.jobs.setOn(job.id, on))}
                  onOpenTask={onOpenTask}
                  lang={lang}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
      {editing && (
        <JobBuilder
          api={api}
          projects={projects}
          job={"id" in editing ? editing : null}
          projectId={"id" in editing ? editing.projectId : (editing.projectId ?? projects[0]?.id ?? "")}
          onClose={() => setEditing(null)}
          onOpenTask={(id) => {
            setEditing(null);
            onOpenTask(id);
          }}
        />
      )}
    </div>
  );
}

function JobRow({
  job,
  next,
  now,
  project,
  lastTask,
  onEdit,
  onSkip,
  onToggle,
  onOpenTask,
  lang,
}: {
  job: Job;
  next: Date | null;
  now: Date;
  project: string;
  lastTask: Task | undefined;
  onEdit: () => void;
  onSkip: () => void;
  onToggle: (on: boolean) => void;
  onOpenTask: (id: string) => void;
  lang: "en" | "it";
}) {
  const t = useT();
  const last = job.last;
  // A skip whose time has passed, such as one left from before the job was off, is no longer in force.
  const skipping = job.skip && new Date(job.skip) > now ? new Date(job.skip) : null;
  const made = lastTask?.files.filter((f) => f.role === "made" && f.kind !== "delete") ?? [];
  return (
    <div className={job.on ? "jrow" : "jrow off"}>
      <button type="button" className="jmain" onClick={onEdit} aria-label={`${t("jobs.edit")}: ${job.title}`}>
        <span className="when">{scheduleText(lang, job.schedule)}</span>
        <span className="what">{job.title}</span>
        <span className="meta">{project}</span>
      </button>
      <div className="col2">
        {next ? (
          <>
            <span>{t("jobs.next", { when: whenText(lang, next, now) })}</span>
            {skipping && <span className="t3">{t("jobs.skipping", { when: whenText(lang, skipping, now) })}</span>}
            <button type="button" className="tbtn" onClick={onSkip}>
              <Icon name="skip-forward" />
              {skipping ? t("jobs.unskip") : t("jobs.skipOnce")}
            </button>
          </>
        ) : null}
      </div>
      <div className="col3">
        {!last ? (
          <span className="t3">{t("jobs.last.never")}</span>
        ) : "taskId" in last ? (
          <button type="button" className="jlast" onClick={() => onOpenTask(last.taskId)}>
            {lastTask && <TaskTag task={lastTask} />}
            <span>{whenText(lang, new Date(last.at), now)}</span>
          </button>
        ) : (
          <span className="row" title={"error" in last ? last.error : undefined}>
            <span className="tag">
              {"error" in last ? t("jobs.last.error") : t(`jobs.last.${last.skipped}` as MessageKey)}
            </span>
            {whenText(lang, new Date(last.at), now)}
          </span>
        )}
        {made[0] && last && "taskId" in last && (
          <button type="button" className="out" title={fileName(made[0].path)} onClick={() => onOpenTask(last.taskId)}>
            <Icon name="file" />
            <span className="truncate">{fileName(made[0].path)}</span>
          </button>
        )}
      </div>
      <Switch label={`${t("jobs.on")}: ${job.title}`} on={job.on} onChange={onToggle} />
    </div>
  );
}

type Step = 0 | 1 | 2 | 3;

/** The four-step builder from the mockup: what, when, result, try it. Every step can be opened from the list. */
function JobBuilder({
  api,
  projects,
  job,
  projectId,
  onClose,
  onOpenTask,
}: {
  api: TostWorkApi;
  projects: Project[];
  job: Job | null;
  projectId: string;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const lang = useContext(LanguageContext);
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<JobDraft>(
    job ?? {
      projectId,
      title: "",
      brief: "",
      schedule: { repeat: "weekly", time: "09:00", days: [1] },
      missed: "run",
      output: "",
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  // The ref stops a double click in the same tick; the state greys the buttons out.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const saved = useRef<Job | null>(job);

  const s = draft.schedule;
  const set = (patch: Partial<JobDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setSchedule = (patch: Partial<JobDraft["schedule"]>) =>
    setDraft((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }));
  const repeat = (r: JobRepeat) =>
    setSchedule({
      repeat: r,
      days: r === "weekly" ? (s.days?.length ? s.days : [1]) : undefined,
      day: r === "monthly" ? (s.day ?? 1) : undefined,
    });
  const toggleDay = (d: number) => {
    const days = s.days ?? [];
    setSchedule({ days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d] });
  };
  const project = projects.find((p) => p.id === draft.projectId)?.name ?? "";
  const problem =
    !draft.title.trim() || !draft.brief.trim()
      ? t("jobs.missingFields")
      : s.repeat === "weekly" && !s.days?.length
        ? t("jobs.noDays")
        : null;

  const projectFolder = projects.find((p) => p.id === draft.projectId)?.folder;
  const chooseFolder = async () => {
    if (!projectFolder) return;
    try {
      const picked = await api.projects.pickFolder(joinPath(projectFolder, draft.output));
      if (!picked) return;
      const inside = insideProject(projectFolder, picked);
      if (inside === null) {
        setFolderError(t("jobs.output.outside"));
        return;
      }
      setFolderError(null);
      // The project folder itself is the empty output.
      set({ output: inside });
    } catch (err) {
      setFolderError(errorText(err));
    }
  };

  /** Saves, making the job the first time; later saves change it. */
  const save = async (): Promise<Job | null> => {
    if (saving.current) return null;
    if (problem) {
      setError(problem);
      return null;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = saved.current ? await api.jobs.update(saved.current.id, draft) : await api.jobs.create(draft);
      saved.current = next;
      return next;
    } catch (err) {
      setError(errorText(err));
      return null;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const saveAndClose = async () => {
    if (await save()) onClose();
  };
  const tryIt = async () => {
    const made = await save();
    if (!made) return;
    try {
      setStarted(await api.jobs.runNow(made.id));
    } catch (err) {
      setError(errorText(err));
    }
  };
  const remove = async () => {
    if (!job) return;
    try {
      const sure = await confirm({
        message: t("jobs.deleteConfirm"),
        detail: t("jobs.deleteDetail"),
        yes: t("jobs.delete"),
        danger: true,
      });
      if (!sure) return;
      await api.jobs.remove(job.id);
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const steps: { icon: string; name: MessageKey; sub: string }[] = [
    { icon: "edit-2", name: "jobs.step.what", sub: draft.title.trim() || "…" },
    { icon: "time", name: "jobs.step.when", sub: scheduleText(lang, s) },
    {
      icon: "folder",
      name: "jobs.step.result",
      sub: draft.output || t("jobs.output.project"),
    },
    { icon: "play", name: "jobs.step.try", sub: t("jobs.step.try.d") },
  ];

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-backdrop" />
        <Dialog.Popup className="modal jobmodal">
          <div className="mh">
            <Dialog.Title render={<b className="grow" />}>{job ? t("jobs.edit") : t("jobs.new")}</Dialog.Title>
            <Dialog.Close className="iconbtn" aria-label={t("dialog.cancel")}>
              <Icon name="close" />
            </Dialog.Close>
          </div>
          <div className="mb">
            <ol className="msteps">
              {steps.map((st, i) => (
                <li key={st.name} className={step === i ? "on" : undefined}>
                  <button
                    type="button"
                    aria-current={step === i ? "step" : undefined}
                    onClick={() => setStep(i as Step)}
                  >
                    <b>
                      <Icon name={st.icon} />
                      {t(st.name)}
                    </b>
                    <span className="truncate">{st.sub}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="mform">
              {step === 0 && (
                <>
                  <label className="fld">
                    <span>{t("jobs.name")}</span>
                    <input
                      className="input"
                      value={draft.title}
                      maxLength={120}
                      placeholder={t("jobs.nameHint")}
                      onChange={(e) => set({ title: e.target.value })}
                    />
                  </label>
                  <label className="fld">
                    <span>{t("jobs.project")}</span>
                    <select
                      className="input"
                      value={draft.projectId}
                      // A folder picked in the old project isn't one of the new project's: the choice starts over.
                      onChange={(e) => {
                        set({ projectId: e.target.value, output: "" });
                        setFolderError(null);
                      }}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="fld">
                    <span>{t("jobs.brief")}</span>
                    <textarea
                      className="input area"
                      value={draft.brief}
                      maxLength={20_000}
                      placeholder={t("jobs.briefHint")}
                      onChange={(e) => set({ brief: e.target.value })}
                    />
                  </label>
                </>
              )}
              {step === 1 && (
                <>
                  <Choices
                    label={t("jobs.repeat")}
                    options={JOB_REPEATS.map((r) => ({ value: r, text: t(`jobs.repeat.${r}` as MessageKey) }))}
                    selected={(r) => s.repeat === r}
                    onPick={repeat}
                  />
                  {s.repeat === "weekly" && (
                    <Choices
                      label={t("jobs.days")}
                      multi
                      options={WEEK.map((d) => ({ value: d, text: weekday(lang, d, "short") }))}
                      selected={(d) => (s.days ?? []).includes(d)}
                      onPick={toggleDay}
                    />
                  )}
                  <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                    {s.repeat === "monthly" && (
                      <label className="fld">
                        <span>{t("jobs.day")}</span>
                        <select
                          className="input"
                          value={s.day ?? 1}
                          onChange={(e) => setSchedule({ day: Number(e.target.value) })}
                        >
                          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="fld">
                      <span>{t("jobs.time")}</span>
                      <input
                        className="input"
                        type="time"
                        value={s.time}
                        required
                        onChange={(e) => e.target.value && setSchedule({ time: e.target.value })}
                      />
                    </label>
                    <label className="fld">
                      <span>{t("jobs.missed")}</span>
                      <select
                        className="input"
                        value={draft.missed}
                        onChange={(e) => set({ missed: e.target.value as JobDraft["missed"] })}
                      >
                        <option value="run">{t("jobs.missed.run")}</option>
                        <option value="skip">{t("jobs.missed.skip")}</option>
                      </select>
                    </label>
                  </div>
                  <p className="summary">
                    {t("jobs.summary", {
                      when: scheduleText(lang, s),
                      project,
                      title: draft.title.trim() || "…",
                    })}
                  </p>
                </>
              )}
              {step === 2 && (
                <fieldset className="fld">
                  <legend>{t("jobs.output")}</legend>
                  <div className="input outfield">
                    <Icon name="folder" />
                    <span className="truncate grow" title={draft.output}>
                      {draft.output || t("jobs.output.project")}
                    </span>
                    {draft.output && (
                      <button
                        type="button"
                        className="iconbtn"
                        aria-label={t("jobs.output.reset")}
                        onClick={() => {
                          set({ output: "" });
                          setFolderError(null);
                        }}
                      >
                        <Icon name="close" />
                      </button>
                    )}
                    <button type="button" className="btn" onClick={() => void chooseFolder()}>
                      {t("jobs.output.choose")}
                    </button>
                  </div>
                  {folderError && (
                    <p className="fld-error" role="alert">
                      {folderError}
                    </p>
                  )}
                  <p className="t3 note">{t("jobs.output.d")}</p>
                </fieldset>
              )}
              {step === 3 && (
                <>
                  <p>{t("jobs.try.body")}</p>
                  {started ? (
                    <p className="row">
                      <span className="grow">{t("jobs.try.started")}</span>
                      <button type="button" className="btn" onClick={() => onOpenTask(started)}>
                        {t("jobs.try.open")}
                      </button>
                    </p>
                  ) : (
                    <p>
                      <button type="button" className="btn" disabled={busy} onClick={() => void tryIt()}>
                        <Icon name="play" />
                        {t("jobs.try.run")}
                      </button>
                    </p>
                  )}
                </>
              )}
              {error && (
                <p className="fld-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
          <div className="mf">
            {job ? (
              <button type="button" className="btn danger" onClick={() => void remove()}>
                {t("jobs.delete")}
              </button>
            ) : (
              step > 0 && (
                <button type="button" className="btn" onClick={() => setStep((step - 1) as Step)}>
                  {t("setup.back")}
                </button>
              )
            )}
            <span className="grow" />
            {!job && step < 3 ? (
              <button type="button" className="btn dark" onClick={() => setStep((step + 1) as Step)}>
                {t("setup.next")}
                <Icon name="arrow-right" />
              </button>
            ) : (
              <button type="button" className="btn dark" disabled={busy} onClick={() => void saveAndClose()}>
                {job ? t("jobs.save") : t("jobs.saveNew")}
              </button>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A row of pills to pick one option, or several with `multi`, kept as radios or checkboxes for the keyboard. */
function Choices<T extends string | number>({
  label,
  options,
  selected,
  onPick,
  multi = false,
}: {
  label: string;
  options: { value: T; text: string }[];
  selected: (value: T) => boolean;
  onPick: (value: T) => void;
  multi?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="fld">
      <legend>{label}</legend>
      {/* The fieldset and its legend name the group, for radios and checkboxes alike. */}
      <div className="choice">
        {options.map((o) => (
          <label key={String(o.value)}>
            <input
              type={multi ? "checkbox" : "radio"}
              className="sr"
              name={name}
              checked={selected(o.value)}
              onChange={() => onPick(o.value)}
            />
            <span className={selected(o.value) ? "on" : undefined}>{o.text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
