/**
 * Pairs each item with a React key built from its content, numbering repeats ("Draft", "Draft#2"). The keys stay
 * stable for lists that only grow or stay fixed, like a task's steps and messages.
 */
export function keyed<T>(items: T[], base: (item: T) => string): [string, T][] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const b = base(item);
    const n = (seen.get(b) ?? 0) + 1;
    seen.set(b, n);
    return [n === 1 ? b : `${b}#${n}`, item];
  });
}
