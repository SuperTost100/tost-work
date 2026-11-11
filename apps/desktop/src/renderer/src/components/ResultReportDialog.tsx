import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";
import { versionLabel } from "@/lib/changelog";
import { errorText } from "@/lib/errorText";
import { Icon } from "@/lib/Icon";
import { Spinner } from "@/lib/Spinner";
import { useT } from "@/lib/useT";
import type { ResultReportCard, TostWorkApi } from "../../../shared/api";
import { REPORT_NOTE_MAX, RESULT_KINDS, type ResultKind, type Task } from "../../../shared/model";
import { nameFromId } from "../../../shared/modelChoice";

/**
 * Report this result: a card that sends a report about what the task's AI wrote to the company that makes it. How it
 * reaches them comes from the main process (`reportCard`): the AI sends it, the mail app opens with the email written,
 * the maker's form opens, or there's nowhere to send it. The main process does the sending and opening; the card only
 * says which kind and what note.
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
  const [card, setCard] = useState<ResultReportCard | null>(null);
  const [kind, setKind] = useState<ResultKind>("offensive");
  const [note, setNote] = useState("");
  const [attach, setAttach] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped each time the card opens, so a send or a read from an earlier opening doesn't land in this one.
  const opening = useRef(0);
  useEffect(() => {
    if (!open) return;
    const n = ++opening.current;
    setCard(null);
    setKind("offensive");
    setNote("");
    setAttach(false);
    setSending(false);
    setSent(false);
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
    if (!card || sending) return;
    const n = opening.current;
    setSending(true);
    setError(null);
    try {
      const outcome = await api.tasks.reportResult(task.id, { kind, note, attach: card.how === "send" && attach });
      if (n !== opening.current) return;
      if (outcome === "sent") setSent(true);
      // The mail app or the browser has the report now.
      else onOpenChange(false);
    } catch (err) {
      if (n === opening.current) setError(errorText(err));
    } finally {
      if (n === opening.current) setSending(false);
    }
  };
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dlg-backdrop" />
        <Dialog.Popup className="dlg report result-report">
          <div className="report-head">
            <Dialog.Title className="dlg-title">{t("result.title")}</Dialog.Title>
            <Dialog.Close className="iconbtn" aria-label={t("dialog.close")}>
              <Icon name="close" />
            </Dialog.Close>
          </div>
          {sent ? (
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
                    <div className="choice" role="radiogroup" aria-label={t("result.kinds")}>
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
                    <textarea
                      className="input area result-note"
                      maxLength={REPORT_NOTE_MAX}
                      placeholder={t("result.note")}
                      aria-label={t("result.note")}
                      value={note}
                      disabled={sending}
                      onChange={(e) => setNote(e.target.value)}
                    />
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
            {action && !sent ? (
              <>
                <Dialog.Close className="btn">{t("dialog.cancel")}</Dialog.Close>
                <button
                  type="button"
                  className={sending ? "btn dark busy" : "btn dark"}
                  disabled={sending}
                  aria-busy={sending || undefined}
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
