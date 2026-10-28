/**
 * What Home says above the box: the greeting for the time of day, then one line picked at random each time Home opens.
 *
 * Tost edits this file by hand. Keep the sentences you like, change or delete the others, add your own: each list
 * can be as long as you want, and the two languages don't need the same number. `{name}` is the user's name.
 */

export const GREETINGS = {
  it: {
    morning: "Buongiorno, {name}.",
    afternoon: "Buon pomeriggio, {name}.",
    evening: "Buonasera, {name}.",
  },
  en: {
    morning: "Good morning, {name}.",
    afternoon: "Good afternoon, {name}.",
    evening: "Good evening, {name}.",
  },
};

/** Under the greeting until the user has a task. */
export const FIRST_TASK = {
  it: "Facciamo la tua prima attività.",
  en: "Let's do your first task.",
};

/** Under the greeting once there are tasks, one at random. */
export const LINES = {
  it: [
    "Su cosa lavoriamo?",
    "Da dove cominciamo?",
    "Cosa portiamo a termine?",
    "Quale file tocca adesso?",
    "Cosa posso fare per te?",
    "Cosa togliamo dalla lista?",
    "Cosa prepariamo oggi?",
    "Che lavoro mi passi?",
    "Cosa sistemiamo?",
    "Cosa ti tolgo dalla scrivania?",
    "A cosa metto mano?",
    "Cosa c'è in coda?",
  ],
  en: [
    "What are we working on?",
    "Where do we start?",
    "What shall we get done?",
    "Which file is next?",
    "What can I do for you?",
    "What's next on the list?",
    "What are we preparing today?",
    "What can I pick up for you?",
    "What needs fixing?",
    "What's waiting on your desk?",
    "What should I start on?",
    "What's in the queue?",
  ],
};
