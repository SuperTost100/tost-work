/** Lower case and without accents, so "perche" finds "Perché". */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** What the user typed, as folded words: each must appear, in any order. */
export const searchWords = (query: string): string[] => fold(query).split(/\s+/).filter(Boolean);

/** Whether the text holds every word, anywhere in it. */
export const matchesWords = (text: string, words: string[]): boolean => {
  const folded = fold(text);
  return words.length > 0 && words.every((w) => folded.includes(w));
};

/** How many tasks a search returns at most. */
export const SEARCH_LIMIT = 20;
