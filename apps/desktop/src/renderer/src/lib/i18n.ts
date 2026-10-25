/** Interface strings in English and Italian. The language comes from the system until setup lets the user choose. */
const en = {
  "nav.newTask": "New task",
  "nav.projects": "Projects",
  "nav.skills": "Skills",
  "nav.jobs": "Jobs",
  "nav.board": "Board",
  "nav.search": "Search",
  "nav.recent": "Recent",
  "nav.settings": "Settings",
  "nav.collapse": "Collapse sidebar",
  "home.greeting.morning": "Good morning, {name}.",
  "home.greeting.afternoon": "Good afternoon, {name}.",
  "home.greeting.evening": "Good evening, {name}.",
  "home.firstTask": "Let's do your first task.",
  "composer.placeholder": "What should get done?",
  "composer.attach": "Attach files",
  "composer.start": "Start task",
  "composer.noProject": "No project",
  "recent.empty": "Your tasks will show up here.",
} as const;

export type MessageKey = keyof typeof en;

const it: Record<MessageKey, string> = {
  "nav.newTask": "Nuova attività",
  "nav.projects": "Progetti",
  "nav.skills": "Skill",
  "nav.jobs": "Lavori pianificati",
  "nav.board": "Bacheca",
  "nav.search": "Cerca",
  "nav.recent": "Recenti",
  "nav.settings": "Impostazioni",
  "nav.collapse": "Comprimi la barra laterale",
  "home.greeting.morning": "Buongiorno, {name}.",
  "home.greeting.afternoon": "Buon pomeriggio, {name}.",
  "home.greeting.evening": "Buonasera, {name}.",
  "home.firstTask": "Facciamo la tua prima attività.",
  "composer.placeholder": "Cosa c'è da fare?",
  "composer.attach": "Allega file",
  "composer.start": "Avvia l'attività",
  "composer.noProject": "Nessun progetto",
  "recent.empty": "Qui compariranno le tue attività.",
};

export type Language = "en" | "it";
const dictionaries: Record<Language, Record<MessageKey, string>> = { en, it };

/** Picks Italian for any Italian locale and English for everything else. */
export function languageFrom(locale: string | undefined): Language {
  return locale?.toLowerCase().startsWith("it") ? "it" : "en";
}

export function translate(lang: Language, key: MessageKey, vars: Record<string, string> = {}): string {
  const text = dictionaries[lang][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}

/** The greeting for the hour of the day: morning until 12, afternoon until 18. */
export function greetingKey(hour: number): MessageKey {
  if (hour < 12) return "home.greeting.morning";
  if (hour < 18) return "home.greeting.afternoon";
  return "home.greeting.evening";
}
