import type { ModelChoices } from "../../../shared/modelChoice";

let last: ModelChoices | null = null;

/** The model lists the picker last loaded in this window, so a picker mounted again starts with them. */
export const lastModelChoices = (): ModelChoices | null => last;

export function rememberModelChoices(choices: ModelChoices) {
  last = choices;
}

/** Forgets the lists. Tests share one module between them, so what one test loaded would show in the next. */
export function forgetModelChoices() {
  last = null;
}
