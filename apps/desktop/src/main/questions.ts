import { IPC, QUESTION_ANSWERS, type QuestionAnswer, type WindowQuestion } from "../shared/api";

/** The part of a window's WebContents the questions use, so tests can stand in for it. */
export interface QuestionPage {
  readonly id: number;
  send(channel: string, ...args: unknown[]): void;
  once(event: "destroyed", listener: () => void): unknown;
  on(
    event: "did-start-navigation",
    listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void,
  ): unknown;
}

interface Open {
  page: QuestionPage;
  question: WindowQuestion;
  sent: boolean;
  resolve: (answer: QuestionAnswer) => void;
}

/**
 * Questions the main process asks in the window's own card. A page that is still loading isn't listening yet, so its
 * questions wait until it asks for them, as a task opened from a notification does. A page that reloads asks again
 * and gets them again; a window that closes answers Cancel.
 */
export class WindowQuestions {
  private next = 1;
  private readonly open = new Map<number, Open>();
  private readonly listening = new Set<number>();
  private readonly watched = new Set<number>();

  ask(page: QuestionPage, question: Omit<WindowQuestion, "id">): Promise<QuestionAnswer> {
    this.watch(page);
    return new Promise((resolve) => {
      const id = this.next++;
      const entry: Open = { page, question: { ...question, id }, sent: false, resolve };
      this.open.set(id, entry);
      if (this.listening.has(page.id)) this.send(entry);
    });
  }

  /** The page now listens: it gets the questions that waited for it. */
  take(page: QuestionPage): WindowQuestion[] {
    this.watch(page);
    this.listening.add(page.id);
    const waiting = [...this.open.values()].filter((entry) => entry.page.id === page.id && !entry.sent);
    for (const entry of waiting) entry.sent = true;
    return waiting.map((entry) => entry.question);
  }

  /** An answer from the page. Anything that isn't one of its own open questions, with a known answer, is ignored. */
  answer(page: QuestionPage, id: unknown, answer: unknown): void {
    if (typeof id !== "number") return;
    const entry = this.open.get(id);
    if (!entry || entry.page.id !== page.id) return;
    if (!QUESTION_ANSWERS.includes(answer as QuestionAnswer)) return;
    this.open.delete(id);
    entry.resolve(answer as QuestionAnswer);
  }

  private send(entry: Open): void {
    entry.sent = true;
    entry.page.send(IPC.question, entry.question);
  }

  private watch(page: QuestionPage): void {
    if (this.watched.has(page.id)) return;
    this.watched.add(page.id);
    page.once("destroyed", () => {
      this.watched.delete(page.id);
      this.listening.delete(page.id);
      for (const [id, entry] of this.open) {
        if (entry.page.id !== page.id) continue;
        this.open.delete(id);
        entry.resolve("no");
      }
    });
    // A reload drops the card with the page: the questions wait again until the new page asks for them.
    page.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.listening.delete(page.id);
      for (const entry of this.open.values()) if (entry.page.id === page.id) entry.sent = false;
    });
  }
}
