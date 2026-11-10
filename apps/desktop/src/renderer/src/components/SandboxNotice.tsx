import { type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { LanguageContext, useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import type { AgentProvider } from "../../../shared/model";
import { SANDBOX_NEEDS, type SandboxMissing, type SandboxReadiness } from "../../../shared/sandbox";
import { type SandboxStep, sandboxSteps } from "../../../shared/sandboxSteps";

/** How long the copy button shows its tick, or that the copy failed. */
const COPIED_FOR = 1600;

/** Text with `code` between backticks, which the strings use for program names. */
function withCode(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let from = 0;
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    out.push(
      text.slice(from, m.index),
      <code key={m.index} className="sbx-name">
        {m[1]}
      </code>,
    );
    from = m.index + m[0].length;
  }
  out.push(text.slice(from));
  return out;
}

/** A command to run in a terminal, with a button that copies it. */
function CommandBlock({ command }: { command: string }) {
  const t = useT();
  const [state, setState] = useState<"ready" | "copied" | "failed">("ready");
  useEffect(() => {
    if (state === "ready") return;
    const timer = setTimeout(() => setState("ready"), COPIED_FOR);
    return () => clearTimeout(timer);
  }, [state]);
  const done = state === "copied" ? t("sandbox.copied") : state === "failed" ? t("message.copyFailed") : null;
  return (
    <div className="sbx-code">
      <pre className="sbx-cmd">{command}</pre>
      <button
        type="button"
        className="btn sbx-copy"
        aria-label={`${t("sandbox.copy")}: ${command.split("\n")[0]}`}
        onClick={() =>
          navigator.clipboard.writeText(command).then(
            () => setState("copied"),
            () => setState("failed"),
          )
        }
      >
        <Icon name={state === "copied" ? "check" : state === "failed" ? "alert" : "copy-2"} />
        {done ?? t("sandbox.copy")}
      </button>
      {/* The button's name stays "Copy: …", so the result reaches a screen reader from here. */}
      <span className="sr-only" role="status">
        {done ?? ""}
      </span>
    </div>
  );
}

/** What's missing, as small tags. */
function Tags({ readiness }: { readiness: SandboxReadiness }) {
  const t = useT();
  const tag = (m: SandboxMissing) =>
    m === "userns"
      ? t(readiness.appArmorRestrictsUserns === true ? "sandbox.tag.apparmor" : "sandbox.tag.userns")
      : t(m === "bwrap" ? "sandbox.tag.bwrap" : "sandbox.tag.socat");
  return (
    <div className="sbx-tags">
      {readiness.missing.map((m) => (
        <span key={m} className="tag">
          {tag(m)}
        </span>
      ))}
    </div>
  );
}

/** What to do about it, step by step. A single step has no number. */
function Steps({ readiness }: { readiness: SandboxReadiness }) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const steps = sandboxSteps(readiness);
  const title = (step: SandboxStep): string => {
    if (step.kind === "install") {
      if (!step.command)
        return t("sandbox.step.installManual", {
          packages: new Intl.ListFormat(lang, { type: "conjunction" }).format(step.packages),
        });
      return t(step.packages.includes("socat") ? "sandbox.step.installSocat" : "sandbox.step.install");
    }
    if (step.kind === "apparmor")
      return step.distro ? t("sandbox.step.apparmor", { distro: step.distro }) : t("sandbox.step.apparmorPlain");
    return t("sandbox.step.userns");
  };
  return steps.map((step, i) => (
    <div key={step.kind} className="sbx-step">
      <span className="sbx-step-title">{`${steps.length > 1 ? `${i + 1}. ` : ""}${title(step)}`}</span>
      {step.kind === "userns"
        ? step.detail && <pre className="sbx-raw">{step.detail}</pre>
        : step.command && <CommandBlock command={step.command} />}
    </div>
  ));
}

/** The check again button, and "still not ready" after a check that changed nothing. */
function CheckButton({
  label,
  checking,
  still,
  dark,
  onCheck,
}: {
  label: string;
  checking: boolean;
  still: boolean;
  dark?: boolean;
  onCheck: () => void;
}) {
  const t = useT();
  return (
    <div className="sbx-actions">
      <button type="button" className={dark ? "btn dark" : "btn"} disabled={checking} onClick={onCheck}>
        <Icon name="refresh-2" />
        {checking ? t("sandbox.checking") : label}
      </button>
      <span className="sbx-status" role="status">
        {still && !checking ? t("sandbox.still") : ""}
      </span>
    </div>
  );
}

/**
 * In setup's Connect an AI step, on a Linux system where the sandbox can't start: what's missing and the commands that
 * fix it, above the ways to connect. Nothing shows while the check runs or when the sandbox is ready from the start,
 * which is every Mac and Windows computer and most Linux ones. After "Check again" finds it ready, a short note says so.
 */
export function SetupSandboxNotice({ api }: { api: TostWorkApi }) {
  const t = useT();
  const [readiness, setReadiness] = useState<SandboxReadiness | null>(null);
  // Whether it was ever not ready, so the ready note shows only after a fix and not on a system that never needed one.
  const [wasMissing, setWasMissing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [still, setStill] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const received = useCallback((r: SandboxReadiness) => {
    setReadiness(r);
    if (!r.ready) setWasMissing(true);
  }, []);

  useEffect(() => {
    api.sandbox.check().then(received, (err: unknown) => setError(errorText(err)));
  }, [api, received]);

  const check = () => {
    setChecking(true);
    setError(null);
    api.sandbox
      .check()
      .then((r) => {
        received(r);
        setStill(!r.ready);
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setChecking(false));
  };

  if (!readiness)
    return error ? (
      <p className="sbx-p small err" role="alert">
        {error}
      </p>
    ) : null;
  if (readiness.ready)
    return wasMissing ? (
      <div className="sbx ok">
        <b className="sbx-head">
          <Icon name="check" className="sbx-ic" />
          {t("sandbox.ok.title")}
        </b>
        <p className="sbx-p small">{t("sandbox.ok.p")}</p>
      </div>
    ) : null;
  return (
    <div className="sbx">
      <b className="sbx-head">
        <Icon name="alert" className="sbx-ic" />
        {t("sandbox.title")}
      </b>
      <p className="sbx-p">
        {withCode(
          t(sandboxSteps(readiness).some((s) => "command" in s && s.command) ? "sandbox.p" : "sandbox.pManual"),
        )}
      </p>
      <Tags readiness={readiness} />
      <Steps readiness={readiness} />
      <CheckButton label={t("sandbox.check")} checking={checking} still={still} onCheck={check} />
      <p className="sbx-p small">{t("sandbox.later")}</p>
      {error && (
        <p className="sbx-p small err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const CLI_NAME: Record<AgentProvider, string> = { codex: "Codex", claude: "Claude Code" };
const MISSING_KEY = {
  bwrap: "sandbox.missing.bwrap",
  socat: "sandbox.missing.socat",
  userns: "sandbox.missing.userns",
} as const;

/**
 * In a task that couldn't start because its AI's sandbox can't: what's missing and the commands that fix it, in place
 * of the plain error sentence. "Check and try again" checks for this task's AI and runs the task again only when the
 * check passes, so a fix that didn't take shows what's still missing and the task stays as it was.
 */
export function TaskSandboxNotice({
  api,
  provider,
  readiness,
  onReady,
  onError,
}: {
  api: TostWorkApi;
  provider: AgentProvider;
  /** What the task failed on. */
  readiness: SandboxReadiness;
  /** Runs the task again, once the check passes. */
  onReady: () => void;
  onError: (err: unknown) => void;
}) {
  const t = useT();
  const lang = useContext(LanguageContext);
  // What the last check found, for as long as the task still shows the failure it was made on.
  const [fresh, setFresh] = useState<{ on: SandboxReadiness; found: SandboxReadiness } | null>(null);
  const [checking, setChecking] = useState(false);
  const shown = fresh?.on === readiness ? fresh.found : readiness;

  const check = () => {
    setChecking(true);
    api.sandbox
      .check(provider)
      .then((found) => (found.ready ? onReady() : setFresh({ on: readiness, found })))
      .catch(onError)
      .finally(() => setChecking(false));
  };

  const list = new Intl.ListFormat(lang, { type: "conjunction" });
  return (
    <div className="agent sbx-fail">
      <div className="sbx-head">{t("sandbox.task.head")}</div>
      <p className="sbx-p">
        {withCode(
          t("sandbox.task.p", {
            ai: CLI_NAME[provider],
            needs: list.format(
              (["bwrap", "socat"] as const)
                .filter((m) => SANDBOX_NEEDS[m].includes(provider))
                .map((m) => `\`${m === "bwrap" ? "bubblewrap" : m}\``),
            ),
            missing: list.format(shown.missing.map((m) => t(MISSING_KEY[m]))),
          }),
        )}
      </p>
      <Steps readiness={shown} />
      <CheckButton
        label={t("sandbox.task.retry")}
        checking={checking}
        still={fresh?.on === readiness}
        dark
        onCheck={check}
      />
    </div>
  );
}
