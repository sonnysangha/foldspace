export type HistoryAction = { label: string; undo: () => Promise<unknown>; redo: () => Promise<unknown> };
export type HistorySnapshot = { undoCount: number; redoCount: number; pending: number; undoLabel: string; redoLabel: string };

/** Serializes changes and keeps failed undo/redo entries available for retry. */
export class CanvasHistory {
  private past: HistoryAction[] = [];
  private future: HistoryAction[] = [];
  private pending = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private snapshot: HistorySnapshot = { undoCount: 0, redoCount: 0, pending: 0, undoLabel: '', redoLabel: '' };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private publish() {
    this.snapshot = { undoCount: this.past.length, redoCount: this.future.length, pending: this.pending, undoLabel: this.past.at(-1)?.label ?? '', redoLabel: this.future.at(-1)?.label ?? '' };
    this.listeners.forEach(listener => listener());
  }
  private queue<T>(operation: () => Promise<T>) {
    this.pending += 1;
    this.publish();
    const result = this.tail.then(operation).finally(() => { this.pending -= 1; this.publish(); });
    this.tail = result.catch(() => {});
    return result;
  }
  commit<T>(label: string, apply: () => Promise<{ value: T; undo: HistoryAction['undo']; redo: HistoryAction['redo']; skip?: boolean }>): Promise<T> {
    return this.queue(async () => {
      const { value, undo, redo, skip } = await apply();
      if (!skip) {
        this.past = [...this.past.slice(-39), { label, undo, redo }];
        this.future = [];
      }
      return value;
    });
  }
  undo = async () => {
    if (this.pending || !this.past.length) return false;
    return this.queue(async () => {
      const action = this.past.at(-1)!;
      await action.undo();
      this.past.pop(); this.future.push(action);
      return true;
    });
  };
  redo = async () => {
    if (this.pending || !this.future.length) return false;
    return this.queue(async () => {
      const action = this.future.at(-1)!;
      await action.redo();
      this.future.pop(); this.past.push(action);
      return true;
    });
  };
}
