import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { type Confirm, useConfirm } from "@/lib/useConfirm";
import { LanguageContext } from "@/lib/useT";
import { ConfirmProvider } from "./ConfirmProvider";

/** A button that asks, and shows what the answer was. */
function Asker({ danger = true, detail }: { danger?: boolean; detail?: string }) {
  const confirm = useConfirm();
  const [answers, setAnswers] = useState<boolean[]>([]);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void confirm({ message: "Delete it?", detail, yes: "Delete", danger }).then((a) =>
            setAnswers((l) => [...l, a]),
          )
        }
      >
        Ask
      </button>
      <output>{answers.map(String).join(",")}</output>
    </>
  );
}

/** Hands the test the `confirm` function, to ask a second question. */
const grabbed: { ask?: Confirm } = {};
function Grab() {
  grabbed.ask = useConfirm();
  return null;
}

const open = async (ui = <Asker detail="It goes for good." />, lang: "en" | "it" = "en") => {
  render(
    <LanguageContext.Provider value={lang}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </LanguageContext.Provider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
  return screen.findByRole("alertdialog");
};
const answers = () => document.querySelector("output")?.textContent;

describe("the confirmation card", () => {
  it("opens with the message, the detail and two buttons, and Cancel has the focus", async () => {
    const card = await open();
    expect(within(card).getByText("Delete it?")).toBeTruthy();
    expect(within(card).getByText("It goes for good.")).toBeTruthy();
    const cancel = within(card).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(
      within(card)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Cancel", "Delete"]);
  });

  it("reads in the language of the app", async () => {
    const card = await open(<Asker />, "it");
    expect(within(card).getByRole("button", { name: "Annulla" })).toBeTruthy();
  });

  it("answers false on Esc, and nothing else happens", async () => {
    const card = await open();
    await act(async () => {
      fireEvent.keyDown(card, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(answers()).toBe("false");
  });

  it("answers false on Cancel", async () => {
    const card = await open();
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(answers()).toBe("false");
  });

  it("makes the rest of the page inert while it's open, so Tab can't leave it, and gives it back after", async () => {
    // Another dialog's portal, as the job editor's is when the card opens over it.
    const other = document.createElement("div");
    document.body.append(other);
    const card = await open();
    const own = card.closest("body > *");
    expect(other.inert).toBe(true);
    expect((own as HTMLElement).inert).not.toBe(true);
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    });
    expect(other.inert).toBe(false);
    other.remove();
  });

  it("answers true on the action button", async () => {
    const card = await open();
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Delete" }));
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(answers()).toBe("true");
  });

  it("stays open when the user clicks outside it", async () => {
    await open();
    const backdrop = document.querySelector(".dlg-backdrop");
    if (!backdrop) throw new Error("no backdrop");
    await act(async () => {
      fireEvent.pointerDown(backdrop);
      fireEvent.mouseDown(backdrop);
      fireEvent.click(backdrop);
    });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(answers()).toBe("");
  });

  it("makes the action red when it destroys something, and dark when it doesn't", async () => {
    const card = await open(<Asker danger />);
    expect(within(card).getByRole("button", { name: "Delete" }).className).toContain("danger");
    expect(within(card).getByRole("button", { name: "Cancel" }).className).not.toContain("danger");
  });

  it("uses the normal dark button for an action that destroys nothing", async () => {
    const card = await open(<Asker danger={false} />);
    const yes = within(card).getByRole("button", { name: "Delete" });
    expect(yes.className).toContain("dark");
    expect(yes.className).not.toContain("danger");
  });

  it("answers no to a second question while one is open", async () => {
    await open(
      <>
        <Asker />
        <Grab />
      </>,
    );
    const second = await grabbed.ask?.({ message: "Another?", yes: "Yes" });
    expect(second).toBe(false);
    // The first card is still the one on screen.
    expect(within(screen.getByRole("alertdialog")).getByText("Delete it?")).toBeTruthy();
  });
});
