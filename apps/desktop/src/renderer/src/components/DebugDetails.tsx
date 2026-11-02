import { useContext, useEffect, useRef, useState } from "react";
import { keyed } from "@/lib/keys";
import { LanguageContext, useT } from "@/lib/useT";
import type { TostWorkApi } from "../../../shared/api";
import { childCalls, type DebugView, debugView, inputText, OUTPUT_MAX, type ToolCall } from "../../../shared/debug";
import type { Task } from "../../../shared/model";
import { CopyButton } from "./AgentMessage";

/** The most often the log is read while a task changes: a run changes the task many times a second. */
export const REREAD_MS = 500;

/**
 * The task's debug log while debug is on, read when the task opens and again after it changes, at most once every
 * REREAD_MS, so a running task's details follow it even while it keeps changing. Null while debug is off or the task
 * has no log.
 */
export function useDebugLog(api: TostWorkApi, taskId: string, on: boolean, changedAt: string): DebugView | null {
  const [view, setView] = useState<DebugView | null>(null);
  // The task's state at the last read, and when that read started. The first read is at once.
  const read = useRef<string | null>(null);
  const lastRead = useRef(0);
  // Reads are numbered, so a slow one that answers after a newer one doesn't put older details back. A change of the
  // task doesn't drop a read already on its way: during a busy run, every read would be dropped.
  const started = useRef(0);
  const shown = useRef(0);
  const current = useRef({ taskId, on });
  // Kept in step after each commit, not during render, which React may throw away. Before the effect that reads.
  useEffect(() => {
    current.current = { taskId, on };
  });
  // Which task the details are for, or null while debug is off.
  const forTask = useRef<string | null>(null);
  useEffect(() => {
    // Another task, or debug turned off: start again from nothing.
    const now = on ? taskId : null;
    if (forTask.current !== now) {
      forTask.current = now;
      read.current = null;
      setView(null);
    }
    if (!on || read.current === changedAt) return;
    const wait = read.current === null ? 0 : Math.max(0, REREAD_MS - (Date.now() - lastRead.current));
    const timer = setTimeout(() => {
      read.current = changedAt;
      lastRead.current = Date.now();
      const n = ++started.current;
      const keep = () => n > shown.current && current.current.taskId === taskId && current.current.on;
      const show = (next: DebugView | null) => {
        if (!keep()) return;
        shown.current = n;
        setView(next);
      };
      // A log that can't be read leaves the task without details; the file is still there to open.
      api.debug.taskLog(taskId).then(
        (lines) => show(lines ? debugView(lines) : null),
        () => show(null),
      );
    }, wait);
    return () => clearTimeout(timer);
  }, [api, taskId, on, changedAt]);
  return on ? view : null;
}

/** The task's technical facts above its messages: which AI and model, the session and the tokens used so far. */
export function DebugStrip({ task, view }: { task: Task; view: DebugView | null }) {
  const t = useT();
  // Numbers follow the app's language, which can differ from the system's.
  const lang = useContext(LanguageContext);
  const session = view?.sessionId ?? task.sessionId;
  const tokens = view?.tokens;
  return (
    <section className="dbg-strip" aria-label={t("debug.details")}>
      <dl>
        <div>
          <dt>{t("debug.ai")}</dt>
          <dd>{task.provider === "claude" ? "Claude" : "Codex"}</dd>
        </div>
        <div>
          <dt>{t("debug.model")}</dt>
          <dd>{task.model}</dd>
        </div>
        <div>
          <dt>{t("debug.effort")}</dt>
          <dd>{task.effort}</dd>
        </div>
        <div>
          <dt>{t("debug.session")}</dt>
          <dd>
            <code>{session ?? "—"}</code>
            {session && <CopyButton text={() => session} />}
          </dd>
        </div>
        <div>
          <dt>{t("debug.tokens")}</dt>
          <dd>
            {tokens
              ? t("debug.tokensValue", {
                  input: tokens.input.toLocaleString(lang),
                  output: tokens.output.toLocaleString(lang),
                })
              : t("debug.none")}
          </dd>
        </div>
      </dl>
      {view?.capped && <p className="t3">{t("debug.capped")}</p>}
    </section>
  );
}

/** A subagent can't hand off to itself for ever, but a broken log could say so: the nesting stops here. */
const MAX_DEPTH = 3;

/** What a tool call did: the thinking before it, its name and input, and its output or error. */
export function CallDetail({ call, view, depth = 0 }: { call: ToolCall; view: DebugView; depth?: number }) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const children = depth < MAX_DEPTH ? childCalls(view, call.id).filter((c) => c.id !== call.id) : [];
  return (
    <div className="dbg">
      {call.reasoning && (
        <>
          <div className="dbg-k">{t("debug.thinking")}</div>
          <p className="dbg-think">{call.reasoning}</p>
        </>
      )}
      <div className="dbg-k">
        {t("debug.input")} · <code>{call.name}</code>
      </div>
      <pre>{inputText(call.input)}</pre>
      {call.output !== undefined && (
        <>
          <div className="dbg-k">{t("debug.output")}</div>
          <pre>{call.output}</pre>
        </>
      )}
      {call.error !== undefined && (
        <>
          <div className="dbg-k">{t("debug.error")}</div>
          <pre className="dbg-err">{call.error}</pre>
        </>
      )}
      {call.output === undefined && call.error === undefined && <p className="t3">{t("debug.noOutput")}</p>}
      {call.cut && (
        <p className="t3">
          {t("debug.cut", { shown: OUTPUT_MAX.toLocaleString(lang), total: call.cut.toLocaleString(lang) })}
        </p>
      )}
      {(children.length > 0 || call.notes.length > 0) && (
        <div className="dbg-sub">
          <div className="dbg-k">{t("debug.subagent")}</div>
          {keyed(call.notes, (note) => note).map(([key, note]) => (
            <p key={key}>{note}</p>
          ))}
          {children.map((child) => (
            <CallDetail key={child.id} call={child} view={view} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
