import type { FeedbackClassification, FeedbackSupport, Funnel, ProviderId } from "cli-funnel";
import type { ResultReportCard, ResultReportInput, ResultReportOutcome } from "../shared/api";
import {
  AI_NAME,
  hasResult,
  MAKER,
  REPORT_NOTE_MAX,
  RESULT_KINDS,
  type ResultKind,
  type Task,
  VENDOR_OF,
} from "../shared/model";
import { nameFromId } from "../shared/modelChoice";
import { UserError } from "./userError";
import { text } from "./validate";

/** The parts of cli-funnel a report uses, so tests and the fake engine can stand in for Codex. */
export type ReportFunnel = Pick<Funnel, "feedbackSupport" | "sendFeedback">;

/**
 * Codex's classification for each kind. Codex's own /feedback calls `bad_result` "Output was off-target, incorrect,
 * incomplete, or unhelpful" and `safety_check` "Benign usage blocked due to safety checks or refusals"
 * (codex-rs/tui/src/bottom_pane/feedback_view.rs), so a harmful result is a bad one and never a safety check.
 */
export const CLASSIFICATION: Record<ResultKind, FeedbackClassification> = {
  offensive: "bad_result",
  dangerous: "bad_result",
  sexual: "bad_result",
  other: "other",
};

/** Each kind as the maker reads it, in English whatever the app's language. */
export const KIND_LABEL: Record<ResultKind, string> = {
  offensive: "Offensive",
  dangerous: "Dangerous or illegal",
  sexual: "Sexual or violent",
  other: "Other",
};

/**
 * The cli-funnel provider whose report channel fits the task. A task on the course key ran through Codex or Claude Code
 * but on the vendor's API, and sendFeedback can't carry the key, so it takes the API's channel: a report through Codex
 * would go out under whatever ChatGPT account is signed in, not the key the task ran on.
 */
export function reportProvider(task: Pick<Task, "provider" | "auth">): ProviderId {
  const provider = task.provider ?? "codex";
  if (task.auth !== "key") return provider;
  return VENDOR_OF[provider] === "openai" ? "openai-api" : "anthropic-api";
}

/** The card's shape from what cli-funnel says: the AI sends it, else an email, else a form, else nothing. */
export function cardFor(task: Pick<Task, "provider" | "model">, support: FeedbackSupport): ResultReportCard {
  const provider = task.provider ?? "codex";
  const how = support.send
    ? "send"
    : mailAddress(support.channel?.email)
      ? "email"
      : httpsUrl(support.channel?.url)
        ? "form"
        : "none";
  return { how, maker: MAKER[VENDOR_OF[provider]], ai: AI_NAME[provider], model: task.model };
}

/** What the maker gets as the report's reason: the kind in English, then the user's note. */
export function reasonText(kind: ResultKind, note: string): string {
  const words = note.trim();
  return words ? `${KIND_LABEL[kind]}: ${words}` : KIND_LABEL[kind];
}

/** The address, when it is one and nothing more: no second address, header or line break slipped in. */
const mailAddress = (email: string | undefined): string | null =>
  email && /^[^\s@?&#,;:/<>]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) ? email : null;

/** The page, when it's https. Anything else (a file, another scheme) is never opened. */
const httpsUrl = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

/**
 * The email to the maker, already written, in English for the people who read it. It has the kind, the note, the AI
 * and model and the app's version, never the task's own text. The mail link and the card's copy button both take
 * their subject and body from here, so what the user pastes is what the link carries.
 */
export function mailMessage(
  task: Pick<Task, "provider" | "model" | "auth">,
  kind: ResultKind,
  note: string,
  app: { version: string; build: string },
): { subject: string; body: string } {
  const provider = task.provider ?? "codex";
  const ai = AI_NAME[provider];
  const through = provider === "claude" ? "Claude Code" : "Codex";
  const account = task.auth === "key" ? `an ${MAKER[VENDOR_OF[provider]]} API key` : `a ${ai} subscription`;
  // Lines in an email end with CR LF, the note's own included (RFC 6068).
  const words = note.trim().replace(/\r?\n/g, "\r\n");
  const body = [
    "Hello,",
    "",
    `I'm reporting a result that ${ai} wrote in Tost Work, a desktop app that runs ${through} on ${account}.`,
    "",
    `Kind: ${KIND_LABEL[kind]}`,
    ...(words ? [`What happened: ${words}`] : []),
    `AI: ${ai}, model ${nameFromId(task.model)} (${task.model}), through ${through}`,
    `App: Tost Work ${app.version}, build ${app.build}`,
  ].join("\r\n");
  return { subject: `Report of a ${ai} result: ${KIND_LABEL[kind]}`, body };
}

/**
 * The link that opens the user's mail app on the email.
 * shortcut: a long note makes a long link, which some mail apps cut short; the card's copy button has the whole text,
 * so move the note out of the link only if users report it.
 */
export function mailtoUrl(email: string, message: { subject: string; body: string }): string {
  return `mailto:${email}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
}

/** The email as plain text for the clipboard: the subject, a blank line, then the body, with plain line breaks. */
export function mailText(message: { subject: string; body: string }): string {
  return `${message.subject}\n\n${message.body.replaceAll("\r\n", "\n")}`;
}

/** The card's fields as the window sent them, checked: IPC is a trust boundary. */
export function reportInput(value: unknown): ResultReportInput {
  if (typeof value !== "object" || value === null) throw new Error("report must be an object");
  const input = value as Record<string, unknown>;
  if (!RESULT_KINDS.includes(input.kind as ResultKind))
    throw new Error(`kind must be one of ${RESULT_KINDS.join(", ")}`);
  if (typeof input.attach !== "boolean") throw new Error("attach must be true or false");
  return { kind: input.kind as ResultKind, note: text(input.note, "note", REPORT_NOTE_MAX), attach: input.attach };
}

export interface ReportDeps {
  feedback: ReportFunnel;
  task(id: string): Task | undefined;
  /** The environment a run of the engine gives its CLI, so the report goes out under the same account. */
  env(): Record<string, string> | undefined;
  /** Opens a mailto: or https: link in the user's own app. */
  open(url: string): Promise<void>;
  /** The app log. Never given the note. */
  log(level: "info" | "warn", message: string, detail: Record<string, unknown>): void;
  app: { version: string; build: string };
}

/** "Report this result": what the card offers for a task, and the report itself. */
export class ResultReports {
  /** Tasks whose report is on its way, so a second click can't send it twice. */
  private sending = new Set<string>();

  constructor(private deps: ReportDeps) {}

  private taskOf(id: unknown): Task {
    const task = this.deps.task(text(id, "id", 100));
    if (!task) throw new UserError("error.noTask");
    // A task saved for later, or one that failed before the AI started, has no result.
    if (!hasResult(task)) throw new Error("Only a task the AI has started on has a result to report");
    return task;
  }

  card(id: unknown): ResultReportCard {
    const task = this.taskOf(id);
    return cardFor(task, this.deps.feedback.feedbackSupport(reportProvider(task)));
  }

  async report(id: unknown, value: unknown): Promise<ResultReportOutcome> {
    const task = this.taskOf(id);
    const input = reportInput(value);
    const provider = reportProvider(task);
    const support = this.deps.feedback.feedbackSupport(provider);
    const card = cardFor(task, support);
    const attached = card.how === "send" && input.attach;
    const detail = { taskId: task.id, provider, kind: input.kind, attached };
    if (card.how === "send") {
      if (this.sending.has(task.id)) throw new UserError("error.reportSending");
      this.sending.add(task.id);
      try {
        const env = this.deps.env();
        await this.deps.feedback.sendFeedback(
          provider,
          {
            classification: CLASSIFICATION[input.kind],
            ...(task.sessionId ? { sessionId: task.sessionId } : {}),
            reason: reasonText(input.kind, input.note),
            includeLogs: attached,
          },
          env ? { env } : undefined,
        );
      } catch (err) {
        // A send that timed out or broke off may have arrived anyway, so it isn't tried again: the user decides.
        this.deps.log("warn", "AI result report may not have been sent", {
          ...detail,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new UserError("error.reportMaybeSent", { maker: card.maker });
      } finally {
        this.sending.delete(task.id);
      }
      this.deps.log("info", "AI result report sent", detail);
      return { outcome: "sent" };
    }
    const email = mailAddress(support.channel?.email);
    const url = httpsUrl(support.channel?.url);
    if (card.how === "email" && email) {
      const message = mailMessage(task, input.kind, input.note, this.deps.app);
      // A computer with no mail app can refuse the link. The card then still gives the address and the text to copy.
      const opened = await this.deps.open(mailtoUrl(email, message)).then(
        () => true,
        (err: unknown) => {
          this.deps.log("warn", "AI result report: the mail app didn't open", {
            ...detail,
            error: err instanceof Error ? err.message : String(err),
          });
          return false;
        },
      );
      if (opened) this.deps.log("info", "AI result report opened in the mail app", detail);
      return { outcome: "email", address: email, text: mailText(message), opened };
    }
    if (card.how === "form" && url) {
      await this.deps.open(url);
      this.deps.log("info", "AI result report form opened", detail);
      return { outcome: "form" };
    }
    throw new Error("This AI has no place to report a result to");
  }
}
