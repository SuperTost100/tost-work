import { Menu } from "@base-ui/react/menu";
import { useCallback, useContext, useEffect, useState } from "react";
import { Icon } from "@/lib/Icon";
import { LanguageContext, useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { MessageKey } from "../../../shared/i18n";
import { LEVELS, type Level } from "../../../shared/model";
import {
  EFFORTS,
  type ModelChoices,
  type ModelPick,
  modelName,
  nearestEffort,
  newestOfEachFamily,
  PRESETS,
  type Preset,
  pickOn,
  resolvePreset,
} from "../../../shared/modelChoice";

const PRESET_ICON: Record<Preset, string> = { fast: "flash", balanced: "balance", thorough: "brain" };

/**
 * The AI and model a new task runs on, under the task box: three plain choices, each with a model and reasoning level
 * behind it, and "Choose the model…" for the full list. From Advanced up, each choice names the model behind it.
 */
export function ModelPicker({
  api,
  pick,
  level,
  onChange,
}: {
  api: TostWorkApi;
  pick: ModelPick;
  level: Level;
  onChange: (pick: ModelPick) => void;
}) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const [choices, setChoices] = useState<ModelChoices | null>(null);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  // Read again each time the menu opens, since an AI may have been signed in or out since.
  const load = useCallback(() => api.models.choices().then(setChoices, () => setChoices(null)), [api]);
  useEffect(() => {
    void load();
  }, [load]);

  // A level the app has no word for (cli-funnel may add one) shows as it is.
  const effortWord = (effort: string) =>
    (EFFORTS as readonly string[]).includes(effort) ? t(`model.effort.${effort}` as MessageKey) : effort;
  const showModels = LEVELS.indexOf(level) >= LEVELS.indexOf("advanced");
  const current = choices && pickOn(pick, choices);
  const list = (choices?.lists ?? []).find((l) => l.ai === choices?.ai);
  const modelLine = (preset: Preset) => {
    const resolved = list && resolvePreset(preset, list.provider, list.models);
    return resolved && `${modelName(resolved.model)} · ${effortWord(resolved.effort).toLocaleLowerCase(lang)}`;
  };

  // An explicit pick that no longer runs as picked (its AI signed out, its model gone) starts on the default AI's middle
  // choice, so the button says that rather than the old model: the user sees where the task's text will go.
  const stale = !("preset" in pick) && current !== null && (current.ai !== pick.ai || current.model.id !== pick.model);
  let label: React.ReactNode;
  let name: string;
  if ("preset" in pick || stale) {
    const preset = "preset" in pick ? pick.preset : "balanced";
    name = t(`model.${preset}`);
    label = <b>{name}</b>;
  } else {
    const model =
      current?.model ?? choices?.lists.find((l) => l.ai === pick.ai)?.models.find((m) => m.id === pick.model);
    name = model ? modelName(model) : pick.model;
    label = (
      <>
        <b>{name}</b>
        {` · ${effortWord(current?.effort ?? pick.effort)}`}
      </>
    );
  }

  return (
    <Menu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setAll(false);
          void load();
        }
      }}
    >
      <Menu.Trigger className="pick model-pick" aria-label={`${t("model.label")}: ${name}`}>
        {label}
        <Icon name="down" />
      </Menu.Trigger>
      <Menu.Portal>
        {/* Always below the box: when the room is short the popup shrinks (see --available-height) instead of flipping up. */}
        <Menu.Positioner
          side="bottom"
          sideOffset={6}
          align="end"
          collisionAvoidance={{ side: "none", align: "shift", fallbackAxisSide: "none" }}
        >
          <Menu.Popup className={all ? "menu model-menu all" : "menu model-menu"}>
            {all && choices ? (
              <FullList
                choices={choices}
                selected={current}
                effortWord={effortWord}
                onBack={() => setAll(false)}
                onPick={onChange}
              />
            ) : (
              <>
                <Menu.RadioGroup
                  value={"preset" in pick ? pick.preset : ""}
                  onValueChange={(value: Preset) => onChange({ preset: value })}
                >
                  {PRESETS.map((preset) => (
                    <Menu.RadioItem key={preset} value={preset} className="menu-item model-item" closeOnClick>
                      <Icon name={PRESET_ICON[preset]} className="model-icon" />
                      <span className="model-text">
                        <b>{t(`model.${preset}`)}</b>
                        <span className="model-d">{t(`model.${preset}.d`)}</span>
                        {showModels && modelLine(preset) && <span className="model-line">{modelLine(preset)}</span>}
                      </span>
                      <Menu.RadioItemIndicator className="menu-check">
                        <Icon name="check" />
                      </Menu.RadioItemIndicator>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
                {choices && choices.lists.length > 0 && (
                  <>
                    <div className="menu-sep" />
                    <Menu.Item className="menu-item model-more" closeOnClick={false} onClick={() => setAll(true)}>
                      <Icon name="chip" />
                      {t("model.choose")}
                      <Icon name="right" className="menu-check" />
                    </Menu.Item>
                  </>
                )}
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The full list: the signed-in AIs with their models, and the reasoning level of the model picked. */
function FullList({
  choices,
  selected,
  effortWord,
  onBack,
  onPick,
}: {
  choices: ModelChoices;
  /** What the task would run on now, a choice of the three included. */
  selected: ReturnType<typeof pickOn>;
  effortWord: (effort: string) => string;
  onBack: () => void;
  onPick: (pick: ModelPick) => void;
}) {
  const t = useT();
  const sectionName = (ai: string): MessageKey =>
    ai === "chatgpt" ? "ai.chatgpt.short" : ai === "claude" ? "ai.claude.short" : "ai.key.short";
  const efforts = selected ? EFFORTS.filter((e) => selected.model.efforts.includes(e)) : [];
  return (
    <>
      <Menu.Item className="menu-item model-back" closeOnClick={false} onClick={onBack}>
        <Icon name="left" />
        {t("model.back")}
      </Menu.Item>
      <div className="menu-sep" />
      {/* Only the models scroll: the way back and the reasoning level stay in view. */}
      <Menu.RadioGroup
        className="model-scroll"
        value={selected ? `${selected.ai}|${selected.model.id}` : ""}
        onValueChange={(value: string) => {
          const [ai, id] = value.split("|");
          const model = choices.lists.find((l) => l.ai === ai)?.models.find((m) => m.id === id);
          if (!model || (ai !== "chatgpt" && ai !== "claude" && ai !== "key")) return;
          const effort = nearestEffort(selected?.effort ?? "medium", model.efforts) ?? model.defaultEffort;
          if (effort) onPick({ ai, model: model.id, effort });
        }}
      >
        {choices.lists.map((l) => (
          <div key={l.ai} role="presentation">
            <div className="menu-label">{t(sectionName(l.ai))}</div>
            {newestOfEachFamily(l.models, selected?.ai === l.ai ? selected.model.id : undefined).map((m) => (
              <Menu.RadioItem key={m.id} value={`${l.ai}|${m.id}`} className="menu-item" closeOnClick={false}>
                {modelName(m)}
                <Menu.RadioItemIndicator className="menu-check">
                  <Icon name="check" />
                </Menu.RadioItemIndicator>
              </Menu.RadioItem>
            ))}
          </div>
        ))}
      </Menu.RadioGroup>
      {selected && efforts.length > 0 && (
        <>
          <div className="menu-sep" />
          <div className="menu-label">{t("model.effort")}</div>
          <Menu.RadioGroup
            value={selected.effort}
            className="model-levels"
            onValueChange={(effort: string) => onPick({ ai: selected.ai, model: selected.model.id, effort })}
          >
            {efforts.map((e) => (
              <Menu.RadioItem key={e} value={e} className="model-level" closeOnClick={false}>
                {effortWord(e)}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </>
      )}
    </>
  );
}
