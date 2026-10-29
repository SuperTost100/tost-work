import { createContext, useContext } from "react";

/** A question before something that can't be undone: what will happen, more detail if needed, and the button's word. */
export interface Confirmation {
  message: string;
  detail?: string;
  /** The word on the button that goes ahead, such as "Delete". */
  yes: string;
  /** The button is red when going ahead destroys or discards something. */
  danger?: boolean;
}

/** Resolves true when the user goes ahead, false on Cancel, Esc, or when another question is already open. */
export type Confirm = (question: Confirmation) => Promise<boolean>;

export const ConfirmContext = createContext<Confirm | null>(null);

/** Asks the user before something that can't be undone, in the app's own card. See `ConfirmProvider`. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm needs a ConfirmProvider above it");
  return confirm;
}
