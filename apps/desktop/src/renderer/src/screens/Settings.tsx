import { useCallback, useState } from "react";
import { AccountRow } from "@/components/AccountRow";
import { KeyRow } from "@/components/KeyRow";
import { Switch } from "@/components/Switch";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { MessageKey } from "../../../shared/i18n";
import {
  AIS,
  type AiId,
  LEVELS,
  LOGIN_OPENS,
  type LoginOpens,
  NOTIFY_KINDS,
  NOTIFY_LEVELS,
  type NotifyLevel,
  SECTION_LEVEL,
  type SectionKey,
  type Settings as SettingsData,
  SUBSCRIPTIONS,
  sectionOn,
  TEXT_SIZES,
  THEMES,
} from "../../../shared/model";

const GROUPS = [
  { id: "level", icon: "layers", key: "settings.level" },
  { id: "accounts", icon: "key-2", key: "settings.accounts" },
  { id: "look", icon: "translate", key: "settings.look" },
  { id: "notify", icon: "notification", key: "settings.notify" },
] as const;
type Group = (typeof GROUPS)[number]["id"];
const SECTIONS: { key: SectionKey; label: MessageKey }[] = [
  { key: "skills", label: "nav.skills" },
  { key: "quickEdit", label: "quick.title" },
  { key: "jobs", label: "nav.jobs" },
  { key: "board", label: "nav.board" },
];

/** A segmented choice: radios kept for the keyboard and screen readers, drawn as the mockup's pills. */
function Choice<T extends string>({
  label,
  name,
  options,
  value,
  text,
  onChange,
}: {
  label: string;
  name: string;
  options: readonly T[];
  value: T;
  text: (option: T) => string;
  onChange: (option: T) => void;
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option}>
          <input type="radio" className="sr" name={name} checked={value === option} onChange={() => onChange(option)} />
          <span className={value === option ? "on" : undefined}>{text(option)}</span>
        </label>
      ))}
    </div>
  );
}

/** Settings: level and sections, AI accounts, language, text size and theme, one pane each. Each change is saved at once. */
export function Settings({
  api,
  settings,
  onChange,
  onAbout,
}: {
  api: TostWorkApi;
  settings: SettingsData;
  onChange: (settings: SettingsData) => void;
  onAbout: () => void;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Group>("level");
  const [connected, setConnected] = useState<Partial<Record<AiId, boolean>>>({});
  const onConnected = useCallback((ai: AiId, c: boolean) => setConnected((prev) => ({ ...prev, [ai]: c })), []);
  // Without a choice, new tasks run on the first account signed in, in this order.
  const signedIn = AIS.filter((ai) => connected[ai]);
  const shownDefault: AiId =
    settings.defaultAi && signedIn.includes(settings.defaultAi) ? settings.defaultAi : (signedIn[0] ?? "chatgpt");
  // A Mac has a menu bar; Windows and Linux have a notification area.
  const stayLabel = api.platform === "darwin" ? "settings.stayInMenuBar.mac" : "settings.stayInMenuBar.other";
  const save = (patch: Partial<SettingsData>) => {
    setError(null);
    api.settings.update(patch).then(onChange, (err: unknown) => setError(errorText(err)));
  };

  return (
    <div className="main">
      <div className="top">
        <span className="crumb">
          <b>{t("nav.settings")}</b>
        </span>
      </div>
      <div className="settings">
        <nav className="snav" aria-label={t("nav.settings")}>
          {GROUPS.map((g) => (
            <button
              type="button"
              key={g.id}
              className={active === g.id ? "on" : undefined}
              aria-current={active === g.id ? "true" : undefined}
              onClick={() => setActive(g.id)}
            >
              <Icon name={g.icon} />
              {t(g.key)}
            </button>
          ))}
          <span className="off" aria-disabled="true" title={t("settings.integrations.when")}>
            <Icon name="plugin-2" />
            {t("settings.integrations")}
            <span className="lock">
              <Icon name="lock" />
              <span className="sr">{t("settings.integrations.when")}</span>
            </span>
          </span>
          {/* Last in the list, as in the mockup: it opens a page of its own. */}
          <button type="button" onClick={onAbout}>
            <Icon name="information" />
            {t("about.crumb")}
          </button>
        </nav>
        <div className="scontent">
          <div className="sbody">
            {error && (
              <p className="fld-error" role="alert">
                {error}
              </p>
            )}
            {active === "level" && (
              <section aria-labelledby="settings-level">
                <h1 id="settings-level">{t("settings.level")}</h1>
                <p>{t("settings.level.sub")}</p>
                <div className="levels" role="radiogroup" aria-label={t("settings.level")}>
                  {LEVELS.map((level) => (
                    <label key={level} className={settings.level === level ? "lv on" : "lv"}>
                      <input
                        type="radio"
                        name="level"
                        checked={settings.level === level}
                        onChange={() => save({ level })}
                      />
                      <b>{t(`level.${level}` as MessageKey)}</b>
                      <span className="d">{t(`level.${level}.d` as MessageKey)}</span>
                    </label>
                  ))}
                </div>
                <div className="sgroup">
                  <h2>{t("settings.sections")}</h2>
                  <div className="srow">
                    <div className="lbl">
                      <b>{t("settings.work")}</b>
                      <span>{t("settings.alwaysOn")}</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked="true"
                      aria-label={t("settings.work")}
                      className="switch on"
                      disabled
                    />
                  </div>
                  {SECTIONS.map(({ key, label }) => {
                    const on = sectionOn(settings, key);
                    return (
                      <div className="srow" key={key}>
                        <div className="lbl">
                          <b>{t(label)}</b>
                          <span>{t("settings.from", { level: t(`level.${SECTION_LEVEL[key]}` as MessageKey) })}</span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={t(label)}
                          className={on ? "switch on" : "switch"}
                          onClick={() => save({ sections: { [key]: !on } })}
                        />
                      </div>
                    );
                  })}
                  <div className="srow">
                    <div className="lbl">
                      <b>{t("settings.agents")}</b>
                      <span>{t("settings.arrives", { level: t("level.advanced"), version: "0.3" })}</span>
                    </div>
                    <span className="lock">
                      <Icon name="lock" />
                      {t("level.advanced")}
                    </span>
                  </div>
                </div>
              </section>
            )}

            {active === "accounts" && (
              <section aria-labelledby="settings-accounts">
                <h1 id="settings-accounts">{t("settings.accounts")}</h1>
                {SUBSCRIPTIONS.map((ai) => (
                  <AccountRow
                    key={ai}
                    api={api}
                    ai={ai}
                    variant="settings"
                    onConnected={onConnected}
                    // The account connected last runs new tasks; signing out of it leaves the choice to the others.
                    onSignedIn={(signedIn) => save({ defaultAi: signedIn })}
                    onSignedOut={(out) => settings.defaultAi === out && save({ defaultAi: null })}
                  />
                ))}
                <KeyRow
                  api={api}
                  variant="settings"
                  onConnected={onConnected}
                  onSaved={() => save({ defaultAi: "key" })}
                  onRemoved={() => settings.defaultAi === "key" && save({ defaultAi: null })}
                />
                {signedIn.length > 1 && (
                  <div className="srow">
                    <div className="lbl">
                      <b>{t("settings.defaultAi")}</b>
                      <span>{t("settings.defaultAi.d")}</span>
                    </div>
                    <Choice<AiId>
                      label={t("settings.defaultAi")}
                      name="default-ai"
                      options={signedIn}
                      value={shownDefault}
                      text={(ai) => t(`ai.${ai}.short` as MessageKey)}
                      onChange={(defaultAi) => save({ defaultAi })}
                    />
                  </div>
                )}
              </section>
            )}

            {active === "look" && (
              <section aria-labelledby="settings-look">
                <h1 id="settings-look">{t("settings.look")}</h1>
                <div className="srow">
                  <label className="lbl" htmlFor="settings-language">
                    <b>{t("setup.language")}</b>
                  </label>
                  <select
                    id="settings-language"
                    className="input"
                    value={settings.language ?? ""}
                    onChange={(e) => save({ language: (e.target.value || null) as SettingsData["language"] })}
                  >
                    <option value="">{t("setup.languageSystem")}</option>
                    <option value="en">English</option>
                    <option value="it">Italiano</option>
                  </select>
                </div>
                <div className="srow">
                  <div className="lbl">
                    <b>{t("settings.textSize")}</b>
                    <span>{t("settings.textSize.d")}</span>
                  </div>
                  <Choice
                    label={t("settings.textSize")}
                    name="text-size"
                    options={TEXT_SIZES}
                    value={settings.textSize}
                    text={(size) => t(`settings.textSize.${size}` as MessageKey)}
                    onChange={(textSize) => save({ textSize })}
                  />
                </div>
                <div className="srow">
                  <div className="lbl">
                    <b>{t("settings.theme")}</b>
                  </div>
                  <Choice
                    label={t("settings.theme")}
                    name="theme"
                    options={THEMES}
                    value={settings.theme}
                    text={(theme) => t(`settings.theme.${theme}` as MessageKey)}
                    onChange={(theme) => save({ theme })}
                  />
                </div>
              </section>
            )}

            {active === "notify" && (
              <section aria-labelledby="settings-notify">
                <h1 id="settings-notify">{t("settings.notify")}</h1>
                <div className="srow">
                  <div className="lbl">
                    <b>{t("settings.notifications")}</b>
                    <span>{t("settings.notifications.d")}</span>
                  </div>
                  <Switch
                    label={t("settings.notifications")}
                    on={settings.notifications}
                    onChange={(notifications) => save({ notifications })}
                  />
                </div>
                {settings.notifications && (
                  <>
                    {NOTIFY_KINDS.map((kind) => (
                      <div className="srow sub" key={kind}>
                        <div className="lbl">
                          <b>{t(`settings.notify.${kind}` as MessageKey)}</b>
                        </div>
                        <Choice<NotifyLevel>
                          label={t(`settings.notify.${kind}` as MessageKey)}
                          name={`notify-${kind}`}
                          options={NOTIFY_LEVELS}
                          value={settings.notify[kind]}
                          text={(level) => t(`settings.notify.${level}` as MessageKey)}
                          onChange={(level) => save({ notify: { [kind]: level } as SettingsData["notify"] })}
                        />
                      </div>
                    ))}
                    <p className="t3 note">{t("settings.notify.quiet.d")}</p>
                  </>
                )}
                <div className="srow">
                  <div className="lbl">
                    <b>{t("settings.openAtLogin")}</b>
                    <span>{t("settings.openAtLogin.d")}</span>
                  </div>
                  <Switch
                    label={t("settings.openAtLogin")}
                    on={settings.openAtLogin}
                    onChange={(openAtLogin) => save({ openAtLogin })}
                  />
                </div>
                {settings.openAtLogin && (
                  <div className="srow sub">
                    <div className="lbl">
                      <b>{t("settings.loginOpens")}</b>
                    </div>
                    <Choice<LoginOpens>
                      label={t("settings.loginOpens")}
                      name="login-opens"
                      options={LOGIN_OPENS}
                      value={settings.loginOpens}
                      text={(choice) => t(`settings.loginOpens.${choice}` as MessageKey)}
                      onChange={(loginOpens) => save({ loginOpens })}
                    />
                  </div>
                )}
                <div className="srow">
                  <div className="lbl">
                    <b>{t(stayLabel)}</b>
                    <span>{t("settings.stayInMenuBar.d")}</span>
                  </div>
                  <Switch
                    label={t(stayLabel)}
                    on={settings.stayInMenuBar}
                    onChange={(stayInMenuBar) => save({ stayInMenuBar })}
                  />
                </div>
              </section>
            )}

            {/* Shown at Expert only. Once on, debug stays on at a lower level: only the switch hides. */}
            {settings.level === "expert" && (
              <section className="sgroup" aria-labelledby="settings-advanced">
                <h2 id="settings-advanced">{t("settings.advanced")}</h2>
                <div className="srow">
                  <div className="lbl">
                    <b>{t("settings.debug")}</b>
                    <span>{t("settings.debug.d")}</span>
                  </div>
                  <Switch label={t("settings.debug")} on={settings.debug} onChange={(debug) => save({ debug })} />
                </div>
                <div className="srow">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setError(null);
                      api.debug.revealAppLog().catch((err: unknown) => setError(errorText(err)));
                    }}
                  >
                    <Icon name="folder-open" />
                    {t("settings.appLog")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setError(null);
                      api.debug.exportLogs().catch((err: unknown) => setError(errorText(err)));
                    }}
                  >
                    <Icon name="download-2" />
                    {t("settings.exportLogs")}
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
