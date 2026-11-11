import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { createMemoryApi } from "@/lib/memoryApi";
import { LanguageContext } from "@/lib/useT";
import type { ResultReportCard, ResultReportOutcome, TostWorkApi } from "../../../shared/api";
import { ResultReportDialog, ResultReportRow } from "./ResultReportDialog";

const press = async (target: HTMLElement) => {
  await act(async () => {
    fireEvent.click(target);
  });
};

const CARDS: Record<ResultReportCard["how"], ResultReportCard> = {
  send: { how: "send", maker: "OpenAI", ai: "ChatGPT", model: "gpt-6.1-terra" },
  email: { how: "email", maker: "Anthropic", ai: "Claude", model: "claude-opus-5-5" },
  form: { how: "form", maker: "OpenAI", ai: "ChatGPT", model: "gpt-6.1-terra" },
  none: { how: "none", maker: "OpenAI", ai: "ChatGPT", model: "gpt-6.1-terra" },
};

/** The row and its card, as the task's panel shows them. */
function Harness({ api, lang }: { api: TostWorkApi; lang: "en" | "it" }) {
  const [shown, setShown] = useState(false);
  return (
    <LanguageContext.Provider value={lang}>
      <ResultReportRow onOpen={() => setShown(true)} />
      <ResultReportDialog
        api={api}
        task={{ id: "t1", title: "Prepara il listino prezzi 2027" }}
        open={shown}
        onOpenChange={setShown}
      />
    </LanguageContext.Provider>
  );
}

/** The row and its card, with the main process answering as `card` says and `result` does. */
function open(
  card: ResultReportCard,
  result: () => Promise<ResultReportOutcome> = async () => (card.how === "send" ? "sent" : card.how) as never,
  lang: "en" | "it" = "en",
) {
  const api = createMemoryApi();
  api.tasks.reportCard = async () => card;
  const reportResult = vi.fn(result);
  api.tasks.reportResult = reportResult;
  render(<Harness api={api} lang={lang} />);
  return { reportResult };
}

const openCard = async (name = "Report this result") => {
  await press(screen.getByRole("button", { name }));
  return screen.findByRole("dialog", { name });
};

describe("Report this result", () => {
  it("sends a ChatGPT result through the AI, without the conversation unless the box is ticked", async () => {
    const { reportResult } = open(CARDS.send);
    const card = await openCard();
    const send = await within(card).findByRole("button", { name: "Send to OpenAI" });
    const box = within(card).getByRole("checkbox", { name: "Attach the task's conversation" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(card.textContent).toContain("but not the conversation");
    expect(card.textContent).toContain("Prepara il listino prezzi 2027");
    expect(card.textContent).toContain("ChatGPT · GPT-6.1 Terra");
    await press(box);
    expect(card.textContent).toContain("It may contain your clients' data");
    await press(within(card).getByRole("radio", { name: "Dangerous or illegal" }));
    fireEvent.change(within(card).getByRole("textbox", { name: "What happened (optional)" }), {
      target: { value: "Instructions to pick a lock" },
    });
    await press(send);
    expect(reportResult).toHaveBeenCalledWith("t1", {
      kind: "dangerous",
      note: "Instructions to pick a lock",
      attach: true,
    });
    expect(await within(card).findByRole("status")).toHaveProperty("textContent", "OpenAI has received your report.");
  });

  it("can't be sent twice while it's sending, and says a failed send may have arrived", async () => {
    let fail: (err: Error) => void = () => {};
    const { reportResult } = open(
      CARDS.send,
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const card = await openCard();
    await press(await within(card).findByRole("button", { name: "Send to OpenAI" }));
    const busy = within(card).getByRole("button", { name: "Sending…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    await press(busy);
    expect(reportResult).toHaveBeenCalledTimes(1);
    await act(async () => fail(new Error("OpenAI didn't confirm the report in time. It may have arrived anyway.")));
    expect((await within(card).findByRole("alert")).textContent).toMatch(/may have arrived/);
    // The user decides whether to send again; nothing is sent by itself.
    expect(within(card).getByRole("button", { name: "Send to OpenAI" })).toBeTruthy();
    expect(reportResult).toHaveBeenCalledTimes(1);
  });

  it("writes to Anthropic for a Claude task, and closes once the mail app has it", async () => {
    const { reportResult } = open(CARDS.email);
    const card = await openCard();
    await press(await within(card).findByRole("button", { name: "Write to Anthropic" }));
    expect(within(card).queryByRole("checkbox")).toBeNull();
    expect(reportResult).toHaveBeenCalledWith("t1", { kind: "offensive", note: "", attach: false });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the maker's form when there's only a form, and says the app sends nothing itself", async () => {
    const { reportResult } = open(CARDS.form);
    const card = await openCard();
    expect(card.textContent).toContain("Tost Work sends nothing itself");
    const note = within(card).getByRole("textbox", { name: "What happened (optional)" });
    fireEvent.change(note, { target: { value: "It explained how to get round an alarm." } });
    await press(await within(card).findByRole("button", { name: "Open OpenAI's form" }));
    expect(reportResult).toHaveBeenCalledTimes(1);
    // The form has nothing yet, so the card stays open with the note to copy into it.
    await waitFor(() =>
      expect(within(card).getByRole("button", { name: "Open OpenAI's form" })).toHaveProperty("disabled", false),
    );
    expect(screen.getByRole("dialog")).toBe(card);
    expect((note as HTMLTextAreaElement).value).toBe("It explained how to get round an alarm.");
  });

  it("only offers Close when the AI has nowhere to report to", async () => {
    const { reportResult } = open(CARDS.none);
    const card = await openCard();
    expect(await within(card).findByText(/there's nowhere to send this one/)).toBeTruthy();
    expect(within(card).queryByRole("radiogroup")).toBeNull();
    const buttons = within(card)
      .getAllByRole("button")
      .map((b) => b.textContent || b.getAttribute("aria-label"));
    expect(buttons).toEqual(["Close", "Close"]);
    expect(reportResult).not.toHaveBeenCalled();
  });

  it("speaks Italian, with ad before Anthropic", async () => {
    open(CARDS.email, undefined, "it");
    const card = await openCard("Segnala questo risultato");
    expect(await within(card).findByRole("button", { name: "Scrivi ad Anthropic" })).toBeTruthy();
  });

  it("shows on a task that ran, opens from the panel and closes with Escape back to the row", async () => {
    const api = createMemoryApi();
    render(<App userName="Giulia" api={api} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Write a proposal for Alpi Logistica" } });
    await press(screen.getByRole("button", { name: "Start task" }));
    const row = await screen.findByRole("button", { name: "Report this result" });
    row.focus();
    await press(row);
    const card = await screen.findByRole("dialog", { name: "Report this result" });
    await within(card).findByRole("button", { name: "Send to OpenAI" });
    await act(async () => {
      fireEvent.keyDown(card, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Report this result" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
  });
});
