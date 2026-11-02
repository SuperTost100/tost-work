import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

/**
 * What was typed, attached or stepped through in each task and not sent yet, by a key such as `<task id>:message`. The
 * task screen is rebuilt for every task that opens, so its own state would be lost when the user looks at another
 * task and comes back. This lives as long as the window.
 */
const kept = new Map<string, unknown>();

const isEmpty = (value: unknown) => value === "" || value === 0 || (Array.isArray(value) && value.length === 0);

/** State kept under `key` while the screen holding it is closed. An empty value ("", 0 or []) is dropped. */
export function useUnsent<T>(key: string, empty: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : empty));
  useEffect(() => {
    if (isEmpty(value)) kept.delete(key);
    else kept.set(key, value);
  }, [key, value]);
  return [value, setValue];
}

/**
 * Forgets what was sent, once it is sent: the screen that sent it may be closed by then, so its own state can't do it.
 * A value changed since the send is newer than what went, so it stays.
 */
export function dropSent(key: string, sent: unknown) {
  if (kept.get(key) === sent) kept.delete(key);
}

/** Forgets everything kept under keys that start with `prefix`, such as a question round once it is answered. */
export function dropAll(prefix: string) {
  for (const key of kept.keys()) if (key.startsWith(prefix)) kept.delete(key);
}

/** Empties the store. Tests start every task id from t1, so what one test left behind would show in the next. */
export function clearUnsent() {
  kept.clear();
}
