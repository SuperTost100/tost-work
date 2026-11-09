import { createContext, useCallback, useContext } from "react";
import type { QuestionAnswer } from "../../../shared/api";

/** A question before something that can't be undone: what will happen, more detail if needed, and the button's word. */
export interface Confirmation {
  message: string;
  /** More detail, one paragraph per string. */
  detail?: string | string[];
  /** The word on the button that goes ahead, such as "Delete". */
  yes: string;
  /** The button is red when going ahead destroys or discards something. */
  danger?: boolean;
  /** A second way forward, such as "Keep both", shown as the main button beside `yes`. */
  alt?: string;
}

/** Resolves with the button pressed. Cancel, Esc, and another question already open all answer "no". */
export type Ask = (question: Confirmation) => Promise<QuestionAnswer>;

/** Resolves true when the user goes ahead, false on Cancel, Esc, or when another question is already open. */
export type Confirm = (question: Confirmation) => Promise<boolean>;

export const ConfirmContext = createContext<Ask | null>(null);

/** Asks in the app's own card and says which button was pressed. See `ConfirmProvider`. */
export function useAsk(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useAsk needs a ConfirmProvider above it");
  return ask;
}

/** Asks the user before something that can't be undone, in the app's own card. See `ConfirmProvider`. */
export function useConfirm(): Confirm {
  const ask = useAsk();
  return useCallback<Confirm>((question) => ask(question).then((answer) => answer === "yes"), [ask]);
}
