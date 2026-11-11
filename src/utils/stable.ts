/**
 * Whether two values read from the server hold the same data. Every query result arrives as
 * fresh objects, so identity alone cannot tell an unchanged card or space from a changed one.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) if (!sameData(a[index], b[index])) return false;
    return true;
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !sameData(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Puts `items` in the order their ids appear in `order`. Anything not listed there is new,
 * and goes first, keeping the order it arrived in.
 */
export function keepOrder<T extends { _id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(a._id) ?? -1) - (rank.get(b._id) ?? -1));
}
