import { useCallback, useEffect, useState } from "react";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { Skill, SkillDraft } from "../../../shared/model";

const draftOf = (s: Skill): SkillDraft => ({ title: s.title, description: s.description, steps: s.steps });
const same = (a: SkillDraft, b: SkillDraft) =>
  a.title.trim() === b.title.trim() &&
  a.description.trim() === b.description.trim() &&
  a.steps.trim() === b.steps.trim();

/**
 * Skills, as in the mockup: the list, the open skill's editor and a side column. A skill is a SKILL.md folder in
 * Documents/Tost Work/Skills; "When to use it" is its description, which the agent reads to pick it.
 */
export function Skills({ api }: { api: TostWorkApi }) {
  const t = useT();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const open = skills?.find((s) => s.id === openId) ?? null;
  const dirty = open !== null && draft !== null && !same(draft, draftOf(open));

  const show = useCallback((skill: Skill | null) => {
    setOpenId(skill?.id ?? null);
    setDraft(skill ? draftOf(skill) : null);
  }, []);

  useEffect(() => {
    let alive = true;
    api.skills.list().then(
      (list) => {
        if (!alive) return;
        setSkills(list);
        show(list[0] ?? null);
      },
      (err: unknown) => alive && setError(errorText(err)),
    );
    return () => {
      alive = false;
    };
  }, [api, show]);

  // Unsaved changes ask first, so switching skills can't lose them without a word.
  const leave = () => !dirty || window.confirm(t("skills.discard"));
  const put = (skill: Skill, replacing = openId) => {
    setSkills((list) =>
      [...(list ?? []).filter((s) => s.id !== replacing && s.id !== skill.id), skill].sort((a, b) =>
        a.title.localeCompare(b.title),
      ),
    );
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
    leave() &&
    void run(async () => {
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
  const addFiles = () =>
    open &&
    void run(async () => {
      const saved = await api.skills.addFiles(open.id);
      put(saved);
    });
  const remove = () => {
    if (!open || !window.confirm(t("skills.removeConfirm", { title: open.title }))) return;
    void run(async () => {
      await api.skills.remove(open.id);
      const rest = (skills ?? []).filter((s) => s.id !== open.id);
      setSkills(rest);
      show(rest[0] ?? null);
    });
  };

  return (
    <div className="main">
      <div className="top">
        <span className="crumb">
          <b>{t("nav.skills")}</b>
        </span>
        <span className="grow" />
        {/* With no skills yet, the page's own button makes the first one. */}
        {skills?.length ? (
          <button type="button" className="btn" style={{ height: 30 }} onClick={create}>
            <Icon name="add" />
            {t("skills.new")}
          </button>
        ) : null}
      </div>
      {error && (
        <p className="fld-error" role="alert" style={{ margin: "10px 24px 0" }}>
          {error}
        </p>
      )}
      {skills?.length === 0 ? (
        <div className="scroll">
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
        </div>
      ) : (
        <div className="skills">
          <nav className="slist" aria-label={t("nav.skills")}>
            {skills?.map((s) => (
              <button
                type="button"
                key={s.id}
                className={s.id === openId ? "sitem on" : "sitem"}
                aria-current={s.id === openId ? "true" : undefined}
                onClick={() => s.id !== openId && leave() && show(s)}
              >
                <span className="truncate">{s.title}</span>
              </button>
            ))}
          </nav>
          {open && draft ? (
            <div className="editor">
              <div className="row">
                <input
                  className="title-input grow"
                  aria-label={t("skills.name")}
                  value={draft.title}
                  maxLength={200}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
                <button
                  type="button"
                  className="btn dark"
                  disabled={!dirty || saving || !draft.title.trim()}
                  onClick={save}
                >
                  {t("skills.save")}
                </button>
              </div>
              <p className="t3" style={{ marginTop: 4 }}>
                {t("skills.everywhere")}
              </p>
              <label className="doc-h" htmlFor="skill-when">
                {t("skills.when")}
              </label>
              <textarea
                id="skill-when"
                className="editable area"
                rows={2}
                maxLength={1024}
                placeholder={t("skills.whenHint")}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
              <label className="doc-h" htmlFor="skill-steps">
                {t("skills.steps")}
              </label>
              <textarea
                id="skill-steps"
                className="editable area"
                rows={10}
                placeholder={t("skills.stepsHint")}
                value={draft.steps}
                onChange={(e) => setDraft({ ...draft, steps: e.target.value })}
              />
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
            </div>
          ) : (
            <div className="editor" />
          )}
          <aside className="smeta">
            <h3>{t("skills.whereOn")}</h3>
            <p>{t("skills.whereOnBody")}</p>
            {open && (
              <>
                <h3>{t("skills.folder")}</h3>
                <p className="truncate" title={open.folder}>
                  {open.id}
                </p>
                <div className="row" style={{ marginTop: 10, gap: 8 }}>
                  <button type="button" className="btn" onClick={() => void run(() => api.skills.reveal(open.id))}>
                    <Icon name="folder-open" />
                    {t("preview.reveal")}
                  </button>
                  <button type="button" className="btn" onClick={remove}>
                    {t("skills.remove")}
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
