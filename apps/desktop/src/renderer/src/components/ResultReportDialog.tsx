import { Dialog } from "@base-ui/react/dialog";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { versionLabel } from "@/lib/changelog";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { Spinner } from "@/lib/Spinner";
import { LanguageContext, useT } from "@/lib/useT";
import type { ResultReportCard, TostWorkApi } from "../../../shared/api";
import { REPORT_NOTE_MAX, RESULT_KINDS, type ResultKind, type Task } from "../../../shared/model";
import { nameFromId } from "../../../shared/modelChoice";
import { CopyButton } from "./AgentMessage";

/** The note's length from which the card counts characters. */
const COUNT_FROM = 1800;

/**
 * Report this result: a card that sends a report about what the task's AI wrote to the company that makes it. How it
 * reaches them comes from the main process (`reportCard`): the AI sends it, the mail app opens with the email written,
 * the maker's form opens, or there's nowhere to send it. The main process does the sending and opening; the card only
 * says which kind and what note. After the email opens, the card stays with the address and the email's text, which
 * the main process sends back, for a user whose mail app didn't open.
 */
export function ResultReportDialog({
  api,
  task,
  open,
  onOpenChange,
}: {
  api: TostWorkApi;
  task: Pick<Task, "id" | "title">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const lang = useContext(LanguageContext);
  const number = (n: number) => n.toLocaleString(lang, { useGrouping: "always" });
  const hintId = useId();
  const countId = useId();
  const [card, setCard] = useState<ResultReportCard | null>(null);
  // Nothing is chosen when the card opens, so a note alone never reports a result as offensive.
  const [kind, setKind] = useState<ResultKind | null>(null);
  const [note, setNote] = useState("");
  // The note was cut at the limit and hasn't been edited back under it.
  const [cut, setCut] = useState(false);
  const [attach, setAttach] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [mail, setMail] = useState<{ address: string; text: string; opened: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped each time the card opens, so a send or a read from an earlier opening doesn't land in this one.
  const opening = useRef(0);
  useEffect(() => {
    if (!open) return;
    const n = ++opening.current;
    setCard(null);
    setKind(null);
    setNote("");
    setCut(false);
    setAttach(false);
    setSending(false);
    setSent(false);
    setMail(null);
    setError(null);
    api.tasks.reportCard(task.id).then(
      (c) => n === opening.current && setCard(c),
      (err: unknown) => n === opening.current && setError(errorText(err)),
    );
  }, [api, open, task.id]);

  const maker = card?.maker ?? "";
  // Italian writes "ad Anthropic" but "a OpenAI".
  const vars = { maker, ai: card?.ai ?? "", a: /^a/i.test(maker) ? "ad" : "a" };
  const submit = async () => {
    if (!card || sending || !kind) return;
    const n = opening.current;
    setSending(true);
    setError(null);
    try {
      const outcome = await api.tasks.reportResult(task.id, { kind, note, attach: card.how === "send" && attach });
      if (n !== opening.current) return;
      if (outcome.outcome === "sent") setSent(true);
      // The mail app has the report now, unless the user has another one: the card stays with the address and the text.
      // A form has nothing yet: the card stays too, so the note can be copied into it.
      else if (outcome.outcome === "email")
        setMail({ address: outcome.address, text: outcome.text, opened: outcome.opened });
    } catch (err) {
      if (n === opening.current) setError(errorText(err));
    } finally {
      if (n === opening.current) setSending(false);
    }
  };
  // The browser cuts a paste or a typed character at the limit without a word, so the card notices both.
  const roomFor = (el: HTMLTextAreaElement) => REPORT_NOTE_MAX - (note.length - (el.selectionEnd - el.selectionStart));
  const action = card && card.how !== "none" ? card.how : null;
  const what =
    card?.how === "send"
      ? t(attach ? "result.whatSendAttached" : "result.whatSend", vars)
      : card?.how === "email"
        ? t("result.whatEmail", vars)
        : card?.how === "form"
          ? t("result.whatForm", vars)
          : null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // The card stays while a report is on its way: closed, its outcome would have nowhere to show, and reopening
        // would offer the same report again.
        if (next || !sending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-backdrop" />
        <Dialog.Popup className="dlg report result-report">
          <div className="report-head">
            <Dialog.Title className="dlg-title">{t("result.title")}</Dialog.Title>
            <Dialog.Close className="iconbtn" aria-label={t("dialog.close")} disabled={sending}>
              <Icon name="close" />
            </Dialog.Close>
          </div>
          {mail ? (
            <>
              <Dialog.Description className="report-p">
                {t(mail.opened ? "result.mailOpened" : "result.mailNotOpened")}
              </Dialog.Description>
              {mail.opened && <p className="report-p">{t("result.mailElse")}</p>}
              <p className="result-address">{mail.address}</p>
              <div>
                <CopyButton text={() => mail.text} label={t("result.copyEmail")} />
              </div>
            </>
          ) : sent ? (
            <p className="report-p result-sent" role="status">
              <Icon name="check-circle" />
              {t("result.sent", vars)}
            </p>
          ) : (
            card && (
              <>
                <Dialog.Description className="report-p">
                  {t(action ? "result.lead" : "result.leadNone", vars)}
                </Dialog.Description>
                {action && (
                  <>
                    <div
                      className="choice"
                      role="radiogroup"
                      aria-label={t("result.kinds")}
                      aria-describedby={kind ? undefined : hintId}
                    >
                      {RESULT_KINDS.map((k) => (
                        <label key={k}>
                          <input
                            type="radio"
                            className="sr"
                            name="result-kind"
                            checked={kind === k}
                            disabled={sending}
                            onChange={() => setKind(k)}
                          />
                          <span className={kind === k ? "on" : undefined}>{t(`result.kind.${k}`)}</span>
                        </label>
                      ))}
                    </div>
                    {!kind && (
                      <p className="result-hint" id={hintId}>
                        {t("result.chooseKind")}
                      </p>
                    )}
                    <div className="result-notebox">
                      <textarea
                        className="input area result-note"
                        maxLength={REPORT_NOTE_MAX}
                        placeholder={t("result.note")}
                        aria-label={t("result.note")}
                        aria-describedby={note.length > COUNT_FROM ? countId : undefined}
                        value={note}
                        disabled={sending}
                        onChange={(e) => {
                          setNote(e.target.value);
                          if (e.target.value.length < REPORT_NOTE_MAX) setCut(false);
                        }}
                        onPaste={(e) => {
                          const pasted = e.clipboardData.getData("text").length;
                          if (pasted > roomFor(e.currentTarget)) setCut(true);
                        }}
                        onKeyDown={(e) => {
                          const types = e.key.length === 1 || e.key === "Enter";
                          if (types && !e.ctrlKey && !e.metaKey && !e.altKey && roomFor(e.currentTarget) <= 0)
                            setCut(true);
                        }}
                      />
                      <div className="result-limit">
                        <span role="status">{cut ? t("result.cut", { max: number(REPORT_NOTE_MAX) }) : ""}</span>
                        <span id={countId} className="result-count">
                          {note.length > COUNT_FROM ? `${number(note.length)} / ${number(REPORT_NOTE_MAX)}` : ""}
                        </span>
                      </div>
                    </div>
                  </>
                )}
                <dl className="report-facts result-facts">
                  <dt>{t("result.task")}</dt>
                  <dd title={task.title}>{task.title}</dd>
                  <dt>{t("result.ai")}</dt>
                  <dd>
                    {card.ai} · {nameFromId(card.model)}
                  </dd>
                  <dt>{t("report.version")}</dt>
                  <dd>
                    {versionLabel(__APP_VERSION__)} · build {__APP_BUILD__}
                  </dd>
                </dl>
                {card.how === "send" && (
                  <label className="result-attach">
                    <input
                      type="checkbox"
                      checked={attach}
                      disabled={sending}
                      onChange={(e) => setAttach(e.target.checked)}
                    />
                    {t("result.attach")}
                  </label>
                )}
                {what && <p className="report-p result-what">{what}</p>}
              </>
            )
          )}
          {error && (
            <p className="fld-error" role="alert">
              {error}
            </p>
          )}
          <div className="report-acts">
            {action && !sent && !mail ? (
              <>
                <Dialog.Close className="btn" disabled={sending}>
                  {t("dialog.cancel")}
                </Dialog.Close>
                <button
                  type="button"
                  className={sending ? "btn dark busy" : "btn dark"}
                  disabled={sending || !kind}
                  aria-busy={sending || undefined}
                  aria-describedby={kind ? undefined : hintId}
                  onClick={() => void submit()}
                >
                  {sending ? <Spinner /> : <Icon name={action === "email" ? "mail" : "flag"} />}
                  {sending
                    ? t("result.sending")
                    : t(action === "send" ? "result.send" : action === "email" ? "result.email" : "result.form", vars)}
                  {action !== "send" && !sending && <Icon name="external-link" />}
                </button>
              </>
            ) : (
              (card || error) && <Dialog.Close className="btn dark">{t("dialog.close")}</Dialog.Close>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The quiet row under a task's side panel that opens the card. */
export function ResultReportRow({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" className="result-row" onClick={onOpen}>
      <Icon name="flag" />
      <span className="grow">{t("result.row")}</span>
    </button>
  );
}
