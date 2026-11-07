import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { IPC, type QuestionAnswer } from "../shared/api";
import { type QuestionPage, WindowQuestions } from "./questions";

class FakePage extends EventEmitter implements QuestionPage {
  static next = 1;
  readonly id = FakePage.next++;
  readonly sent: unknown[][] = [];
  send(channel: string, ...args: unknown[]): void {
    this.sent.push([channel, ...args]);
  }
  reload(): void {
    this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  }
}

const QUIT = { message: "A task is still working.", yes: "Quit", danger: true };

describe("questions asked in the window's card", () => {
  it("sends at once to a page that listens, and resolves with its answer", async () => {
    const questions = new WindowQuestions();
    const page = new FakePage();
    questions.take(page);
    const answer = questions.ask(page, QUIT);
    expect(page.sent).toEqual([[IPC.question, { ...QUIT, id: 1 }]]);
    questions.answer(page, 1, "yes");
    await expect(answer).resolves.toBe("yes");
  });

  it("keeps a question for a page still loading until it asks", async () => {
    const questions = new WindowQuestions();
    const page = new FakePage();
    const answer = questions.ask(page, QUIT);
    expect(page.sent).toEqual([]);
    const [waiting] = questions.take(page);
    expect(waiting?.message).toBe(QUIT.message);
    expect(questions.take(page)).toEqual([]);
    questions.answer(page, waiting?.id, "alt");
    await expect(answer).resolves.toBe("alt");
  });

  it("asks again after a reload, since the card went with the old page", () => {
    const questions = new WindowQuestions();
    const page = new FakePage();
    questions.take(page);
    void questions.ask(page, QUIT);
    page.reload();
    expect(questions.take(page)).toHaveLength(1);
  });

  it("answers Cancel when the window closes", async () => {
    const questions = new WindowQuestions();
    const page = new FakePage();
    const answer = questions.ask(page, QUIT);
    page.emit("destroyed");
    await expect(answer).resolves.toBe("no");
  });

  it("ignores answers from another page, to unknown ids, or that aren't a button", async () => {
    const questions = new WindowQuestions();
    const page = new FakePage();
    const other = new FakePage();
    questions.take(page);
    let answered: QuestionAnswer | null = null;
    void questions.ask(page, QUIT).then((a) => {
      answered = a;
    });
    questions.answer(other, 1, "yes");
    questions.answer(page, 99, "yes");
    questions.answer(page, 1, "maybe");
    questions.answer(page, "1", "yes");
    await Promise.resolve();
    expect(answered).toBeNull();
    questions.answer(page, 1, "no");
    await Promise.resolve();
    expect(answered).toBe("no");
  });
});
