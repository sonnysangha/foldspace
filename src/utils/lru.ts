/**
 * Keeps the entries used most recently, up to a total cost. When a new entry takes it over
 * the limit, the ones used longest ago are let go, oldest first. The newest entry always
 * stays, even if it alone costs more than the limit.
 */
export class LruCache<Key, Value> {
  private entries = new Map<Key, { value: Value; cost: number }>();
  private total = 0;
  constructor(private limit: number, private costOf: (value: Value) => number = () => 1) {}
  get(key: Key): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // A Map remembers the order things were added in, so adding it again marks it as just used.
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: Key, value: Value) {
    const before = this.entries.get(key);
    if (before) { this.total -= before.cost; this.entries.delete(key); }
    const cost = this.costOf(value);
    this.entries.set(key, { value, cost });
    this.total += cost;
    for (const [oldest, entry] of this.entries) {
      if (this.total <= this.limit || oldest === key) break;
      this.entries.delete(oldest); this.total -= entry.cost;
    }
  }
  has(key: Key) { return this.entries.has(key); }
  get size() { return this.entries.size; }
  get cost() { return this.total; }
}

/** The size a picture should be drawn at so its longer side is at most `longest`. Never larger than it already is. */
export function fitWithin(width: number, height: number, longest: number) {
  const scale = Math.min(1, longest / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
