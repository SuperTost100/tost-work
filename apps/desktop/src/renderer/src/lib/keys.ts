/**
 * Pairs each item with a React key built from its content and how many times that content came before. Both parts
 * are encoded as JSON, so no content can produce another item's key. The keys stay stable for lists that only grow
 * or stay fixed, like a task's steps and messages.
 */
export function keyed<T>(items: T[], base: (item: T) => string): [string, T][] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const b = base(item);
    const n = (seen.get(b) ?? 0) + 1;
    seen.set(b, n);
    return [JSON.stringify([b, n]), item];
  });
}
