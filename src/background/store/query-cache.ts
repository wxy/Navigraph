/** Small revision-scoped LRU; never stores graph records or unbounded ID lists. */
export class QueryCache<T> {
  private entries = new Map<string, { revision: number; value: T }>();
  constructor(private capacity: number, private maxJsonBytes?: number) {}

  get(key: string, revision: number | null): T | undefined {
    if (revision === null) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.revision !== revision) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, revision: number | null, value: T): void {
    if (revision === null) return;
    if (this.maxJsonBytes !== undefined && new TextEncoder().encode(JSON.stringify(value)).byteLength > this.maxJsonBytes) return;
    this.entries.delete(key);
    this.entries.set(key, { revision, value });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
}
