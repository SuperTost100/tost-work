import {
  type DragEvent,
  type MouseEvent,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Clipped } from "@/components/Clipped";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { useConfirm } from "@/lib/useConfirm";
import { LanguageContext, useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { Skill, SkillDraft, SkillVersion, Task } from "../../../shared/model";

const draftOf = (s: Skill): SkillDraft => ({ title: s.title, description: s.description, steps: s.steps });
const same = (a: SkillDraft, b: SkillDraft) =>
  a.title.trim() === b.title.trim() &&
  a.description.trim() === b.description.trim() &&
  a.steps.trim() === b.steps.trim();
const byTitle = (a: Skill, b: Skill) => a.title.localeCompare(b.title);

/** The name a task records when it reads a skill: its id, the folder's name, or @ and the folder's for a guide. */
export const usedName = (s: Skill) => s.id;

/**
 * Skills, as in the mockup: the list, the open skill's editor and a side column. A skill is a SKILL.md folder in
 * Documents/Tost Work/Skills; "When to use it" is its description, which the agent reads to pick it. The guides Tost
 * Work comes with are listed under them, read-only, and Duplicate makes an editable copy.
 */
export function Skills({ api, tasks = [] }: { api: TostWorkApi; tasks?: Task[] }) {
  const t = useT();
  const confirm = useConfirm();
  const lang = useContext(LanguageContext);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mine = (skills ?? []).filter((s) => !s.builtIn);
  const guides = (skills ?? []).filter((s) => s.builtIn);
  const open = skills?.find((s) => s.id === openId) ?? null;
  const dirty = open !== null && !open.builtIn && draft !== null && !same(draft, draftOf(open));

  const show = useCallback((skill: Skill | null) => {
    setOpenId(skill?.id ?? null);
    setDraft(skill ? draftOf(skill) : null);
  }, []);

  // Each list asked for takes the next number, so one that comes back after a newer one is dropped.
  const listing = useRef(0);
  useEffect(() => {
    let alive = true;
    const mine = ++listing.current;
    api.skills.list().then(
      (list) => {
        if (!alive || mine !== listing.current) return;
        setSkills(list);
        // The user's own first; with none yet, the page invites them to make one.
        show(list.find((s) => !s.builtIn) ?? null);
      },
      (err: unknown) => alive && setError(errorText(err)),
    );
    return () => {
      alive = false;
    };
  }, [api, show]);

  // The versions of the open skill, again after each save or restore.
  const version = open?.version ?? 0;
  useEffect(() => {
    let alive = true;
    if (!openId || openId.startsWith("@") || version === 0) {
      setVersions([]);
      return;
    }
    api.skills.history(openId).then(
      (list) => alive && setVersions(list),
      () => alive && setVersions([]),
    );
    return () => {
      alive = false;
    };
  }, [api, openId, version]);

  // Unsaved changes ask first, so switching skills can't lose them without a word.
  const leave = async () =>
    !dirty ||
    (await confirm({
      message: t("skills.discard"),
      detail: t("skills.discardDetail"),
      yes: t("skills.discardYes"),
      danger: true,
    }));
  const put = (skill: Skill, replacing = openId) => {
    setSkills((list) => {
      const rest = (list ?? []).filter((s) => s.id !== replacing && s.id !== skill.id);
      return [...rest.filter((s) => !s.builtIn), skill].sort(byTitle).concat(rest.filter((s) => s.builtIn));
    });
  };
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const create = () =>
    void run(async () => {
      if (!(await leave())) return;
      const skill = await api.skills.create(t("skills.untitled"));
      put(skill, null);
      show(skill);
    });
  const save = () => {
    if (!open || !draft?.title.trim()) return;
    setSaving(true);
    void run(async () => {
      const saved = await api.skills.save(open.id, draft);
      put(saved);
      show(saved);
    }).finally(() => setSaving(false));
  };
  // One copy per click: a second click while the first is on its way does nothing.
  const [duplicating, setDuplicating] = useState(false);
  const copying = useRef(false);
  const duplicate = (guide: Skill) => {
    if (copying.current) return;
    copying.current = true;
    setDuplicating(true);
    void run(async () => {
      const copy = await api.skills.duplicate(guide.id);
      put(copy, null);
      show(copy);
    }).finally(() => {
      copying.current = false;
      setDuplicating(false);
    });
  };
  const importSkill = (dropped: File[] = []) =>
    void run(async () => {
      if (!(await leave())) return;
      // One at a time, as the folder takes them one at a time; the last one in opens. One that can't come in doesn't
      // stop the others: the error names it.
      let last: Skill | null = null;
      const failed: string[] = [];
      for (const file of dropped.length ? dropped : [undefined]) {
        try {
          const skill = await api.skills.import(file);
          if (!skill) continue;
          put(skill, null);
          last = skill;
        } catch (err) {
          if (!file) throw err;
          failed.push(`${file.name}: ${errorText(err)}`);
        }
      }
      if (last) show(last);
      if (failed.length) setError(failed.join(" · "));
    });
  // Files dragged from the Finder can be dropped anywhere on the page to import them.
  const [dropping, setDropping] = useState(false);
  const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const dropZone = {
    onDragOver: (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropping(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
    },
    onDrop: (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      setDropping(false);
      importSkill([...e.dataTransfer.files]);
    },
  };
  const restore = (n: number) => {
    if (!open) return;
    void run(async () => {
      if (!(await leave())) return;
      const sure = await confirm({
        message: t("skills.restoreConfirm", { n: String(n) }),
        detail: t("skills.restoreDetail"),
        yes: t("skills.restore"),
        danger: true,
      });
      if (!sure) return;
      const back = await api.skills.restore(open.id, n);
      put(back);
      show(back);
    });
  };
  const addFiles = () =>
    open &&
    void run(async () => {
      const saved = await api.skills.addFiles(open.id);
      put(saved);
    });
  // The list and the open skill as they are now, for work that finishes after the user moved on.
  const current = useRef({ skills, openId });
  // Updated once a render is on screen, so a render React drops can't leave its state here.
  useLayoutEffect(() => {
    current.current = { skills, openId };
  });
  // The guides come in the app's language, so a language changed in Settings lists them again. The user's own skills and
  // whatever is typed in the open one stay as they are; an open guide is read-only, so showing it again loses nothing.
  const listedIn = useRef(lang);
  useEffect(() => {
    if (listedIn.current === lang) return;
    listedIn.current = lang;
    let alive = true;
    const mine = ++listing.current;
    api.skills.list().then(
      (list) => {
        if (!alive || mine !== listing.current) return;
        // The first list never came, as this one overtook it: this one is the first.
        if (!current.current.skills) {
          setSkills(list);
          return show(list.find((s) => !s.builtIn) ?? null);
        }
        const guides = list.filter((s) => s.builtIn);
        setSkills((before) => before && [...before.filter((s) => !s.builtIn), ...guides]);
        const open = guides.find((s) => s.id === current.current.openId);
        if (open) show(open);
      },
      (err: unknown) => alive && setError(errorText(err)),
    );
    return () => {
      alive = false;
    };
  }, [api, lang, show]);
  const remove = (skill: Skill) => {
    void run(async () => {
      const sure = await confirm({
        message: t("skills.removeConfirm", { title: skill.title }),
        detail: t("skills.removeDetail"),
        yes: t("delete.yes"),
        danger: true,
      });
      if (!sure) return;
      await api.skills.remove(skill.id);
      const rest = (current.current.skills ?? []).filter((s) => s.id !== skill.id);
      // The user may have opened the skill while it was going: then the editor moves to another one.
      const moved = current.current.openId === skill.id;
      // To one of the user's own: a built-in guide isn't where they were working.
      const next = moved ? (rest.find((s) => !s.builtIn) ?? null) : null;
      // Set now, not after the render, so another delete finishing in the same moment sees this one.
      current.current = { skills: rest, openId: moved ? (next?.id ?? null) : current.current.openId };
      setSkills((list) => (list ?? []).filter((s) => s.id !== skill.id));
      if (moved) show(next);
    });
  };

  // Rename puts the cursor in the name, which saves with the rest of the skill.
  const nameField = useRef<HTMLInputElement>(null);
  const renameNext = useRef(false);
  const focusName = useCallback((el: HTMLInputElement | null) => {
    nameField.current = el;
    if (el && renameNext.current) {
      renameNext.current = false;
      el.focus();
      el.select();
    }
  }, []);
  // The … button and a right-click open the same menu as a task's in the sidebar.
  const menu = async (skill: Skill) => {
    const action = await api.skills.menu(skill.id);
    if (action === "reveal") void run(() => api.skills.reveal(skill.id));
    else if (action === "export") void run(() => api.skills.exportZip(skill.id));
    else if (action === "delete") remove(skill);
    else if (action === "rename") {
      if (skill.id === openId) {
        nameField.current?.focus();
        nameField.current?.select();
      } else if (await leave()) {
        renameNext.current = true;
        show(skill);
      }
    }
  };
  const contextMenu = (skill: Skill) => (e: MouseEvent) => {
    e.preventDefault();
    void menu(skill);
  };

  const used = (s: Skill) => tasks.filter((task) => task.skillsUsed?.includes(usedName(s))).length;
  const usedText = (n: number) =>
    n === 0 ? null : n === 1 ? t("skills.usedOnce") : t("skills.used", { n: String(n) });
  const date = (at: string) => new Date(at).toLocaleDateString(lang, { day: "numeric", month: "short" });

  const row = (s: Skill) => (
    <div key={s.id} className={s.id === openId ? "sitem on" : "sitem"}>
      <button
        type="button"
        className="open"
        aria-current={s.id === openId ? "true" : undefined}
        onClick={() => void (async () => s.id !== openId && (await leave()) && show(s))()}
        onContextMenu={s.builtIn ? undefined : contextMenu(s)}
      >
        <Clipped className="truncate grow" text={s.title} />
        {/* The editor says the version in words, so the list's tag is for the eye only. */}
        {!s.builtIn && (s.version ?? 0) > 0 && (
          <span className="v" aria-hidden="true">
            v{s.version}
          </span>
        )}
      </button>
      {!s.builtIn && (
        <button
          type="button"
          className="more"
          aria-label={t("recent.more", { name: s.title })}
          title={t("recent.more", { name: s.title })}
          onClick={() => void menu(s)}
          onContextMenu={contextMenu(s)}
        >
          <Icon name="more-1" />
        </button>
      )}
    </div>
  );

  const invite = (
    <div className="col" style={{ paddingTop: 96 }}>
      <div className="hello">
        <h1>{t("skills.emptyTitle")}</h1>
      </div>
      <p className="t2" style={{ fontSize: 15 }}>
        {t("skills.emptyBody")}
      </p>
      <div className="row" style={{ marginTop: 18 }}>
        <button type="button" className="btn dark" onClick={create}>
          <Icon name="add" />
          {t("skills.new")}
        </button>
      </div>
    </div>
  );

  return (
    <div className={dropping ? "main dropping" : "main"} {...dropZone}>
      {dropping && (
        <div className="dropzone" aria-hidden="true">
          <Icon name="upload-2" />
          {t("skills.drop")}
        </div>
      )}
      <div className="top">
        <span className="crumb">
          <b>{t("nav.skills")}</b>
        </span>
        <span className="grow" />
        {/* With no skills of their own yet, the page's own button makes the first one. */}
        {mine.length > 0 && (
          <button type="button" className="btn" style={{ height: 30 }} onClick={create}>
            <Icon name="add" />
            {t("skills.new")}
          </button>
        )}
      </div>
      {error && (
        <p className="fld-error" role="alert" style={{ margin: "10px 24px 0" }}>
          {error}
        </p>
      )}
      {skills?.length === 0 ? (
        <div className="scroll">{invite}</div>
      ) : (
        <div className="skills">
          <nav className="slist" aria-label={t("nav.skills")}>
            {mine.map(row)}
            {guides.length > 0 && (
              <>
                <h4 className="sgroup">{t("skills.builtIn")}</h4>
                {guides.map(row)}
              </>
            )}
            <div className="sep" />
            <button type="button" className="sitem action" onClick={() => importSkill()}>
              <Icon name="upload-2" />
              {t("skills.import")}
            </button>
          </nav>
          {open && draft ? (
            <div className="editor">
              <div className="row">
                <input
                  // A new field for each skill, so Rename from the menu can focus it as it appears.
                  key={open.id}
                  ref={focusName}
                  className="title-input grow"
                  aria-label={t("skills.name")}
                  value={draft.title}
                  title={draft.title}
                  maxLength={200}
                  readOnly={open.builtIn}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
                {open.builtIn ? (
                  <button type="button" className="btn dark" disabled={duplicating} onClick={() => duplicate(open)}>
                    <Icon name="copy-2" />
                    {t("skills.duplicate")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn dark"
                    disabled={!dirty || saving || !draft.title.trim()}
                    onClick={save}
                  >
                    {t("skills.save")}
                  </button>
                )}
              </div>
              <p className="t3" style={{ marginTop: 4 }}>
                {open.builtIn
                  ? t("skills.builtInNote")
                  : [
                      version > 0 && t("skills.version", { n: String(version) }),
                      usedText(used(open)),
                      t("skills.everywhere"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
              <label className="doc-h" htmlFor="skill-when">
                {t("skills.when")}
              </label>
              <textarea
                id="skill-when"
                className="editable area"
                rows={2}
                maxLength={1024}
                readOnly={open.builtIn}
                placeholder={t("skills.whenHint")}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
              <div className="doc-h" aria-hidden="true">
                {t("skills.steps")}
              </div>
              {/* A new editor per skill, so undo never reaches into another skill's text. */}
              <MarkdownEditor
                key={open.id}
                id="skill-steps"
                label={t("skills.steps")}
                readOnly={open.builtIn}
                placeholder={t("skills.stepsHint")}
                value={draft.steps}
                onChange={(steps) => setDraft((d) => (d ? { ...d, steps } : d))}
              />
              {!open.builtIn && (
                <>
                  <div className="doc-h">{t("skills.files")}</div>
                  <div className="outs" style={{ marginTop: 0, flexWrap: "wrap" }}>
                    {open.files.map((name) => (
                      <span className="out" key={name}>
                        <Icon name="file" />
                        {name}
                      </span>
                    ))}
                    <button type="button" className="tbtn" onClick={addFiles}>
                      <Icon name="add" />
                      {t("skills.addFile")}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="editor">{mine.length === 0 ? invite : <p className="t3">{t("skills.pickOne")}</p>}</div>
          )}
          <aside className="smeta">
            <h3>{t("skills.whereOn")}</h3>
            <p>{t("skills.whereOnBody")}</p>
            {open && !open.builtIn && versions.length > 0 && (
              <>
                <h3>{t("skills.versions")}</h3>
                <div className="vers">
                  {versions.map((v) => (
                    <div key={v.n} className={v.n === version ? "current" : undefined}>
                      <span className="grow truncate">
                        v{v.n}
                        {v.restoredFrom
                          ? ` · ${t("skills.restoredFrom", { n: String(v.restoredFrom) })}`
                          : v.note
                            ? ` · ${v.note}`
                            : ""}
                      </span>
                      {v.n === version ? (
                        <span className="now">
                          <Icon name="check" />
                          {t("skills.current")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="tbtn"
                          aria-label={`${t("skills.restore")} v${v.n}`}
                          title={date(v.at)}
                          onClick={() => restore(v.n)}
                        >
                          {t("skills.restore")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {open && !open.builtIn && (
              <>
                <h3>{t("skills.folder")}</h3>
                <p className="truncate" title={open.folder}>
                  {open.id}
                </p>
                {/* Rename and Delete are in the skill's … menu, as for a task. */}
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 10 }}
                  onClick={() => void run(() => api.skills.reveal(open.id))}
                >
                  <Icon name="folder-open" />
                  {t("preview.reveal")}
                </button>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
