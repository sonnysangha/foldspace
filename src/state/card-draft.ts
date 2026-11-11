export type CardDraft = { title: string; body: string };
export type DraftSnapshot = { draft: CardDraft; status: 'saved' | 'saving' | 'error'; localSaved: boolean };
type Storage = { read: () => Promise<string | null>; write: (value: string) => Promise<void>; remove: () => Promise<void> };
const same = (a: CardDraft, b: CardDraft) => a.title === b.title && a.body === b.body;

/** One ordered writer per account/card, shared by every mounted view of that card. */
export class CardDraftStore {
  private draft: CardDraft;
  private revision = 0;
  private scheduled = -1;
  private stored = -1;
  private dirty = false;
  private failed = false;
  private storageFailed = false;
  private hydration: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private unwritten: { draft: CardDraft; revision: number } | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private saves: Promise<boolean> = Promise.resolve(true);
  private listeners = new Set<() => void>();
  private snapshot: DraftSnapshot;
  /**
   * `writeDelay` is how long typing must pause before the draft is copied to the device.
   * Zero writes every edit at once. A save, or stopping the store, never waits for it.
   */
  constructor(initial: CardDraft, private storage: Storage, private commit: (draft: CardDraft) => Promise<unknown>, private writeDelay = 0) {
    this.draft = initial;
    this.snapshot = { draft: initial, status: 'saved', localSaved: false };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  setCommit(commit: (draft: CardDraft) => Promise<unknown>) { this.commit = commit; }
  private publish() {
    const status = this.dirty ? this.failed || this.storageFailed ? 'error' : 'saving' : 'saved';
    const localSaved = this.dirty && this.stored === this.revision;
    // Listeners render the whole editor, so they only hear about something they would show differently.
    if (this.snapshot.draft === this.draft && this.snapshot.status === status && this.snapshot.localSaved === localSaved) return;
    this.snapshot = { draft: this.draft, status, localSaved };
    this.listeners.forEach(listener => listener());
  }
  receiveServer(draft: CardDraft) {
    if (!this.dirty && !same(draft, this.draft)) { this.draft = draft; this.publish(); }
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 600);
  }
  private persist(draft: CardDraft, revision: number) {
    if (this.writeDelay <= 0) { this.write(draft, revision); return; }
    this.unwritten = { draft, revision };
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.writeNow(), this.writeDelay);
  }
  /** Copies whatever typing is still waiting to the device, without waiting for a pause. */
  private writeNow() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    const waiting = this.unwritten;
    this.unwritten = null;
    if (waiting) this.write(waiting.draft, waiting.revision);
  }
  private write(draft: CardDraft, revision: number) {
    this.writes = this.writes.catch(() => {}).then(async () => {
      try { await this.storage.write(JSON.stringify(draft)); this.stored = revision; this.storageFailed = false; }
      catch { this.storageFailed = true; }
      this.publish();
    });
  }
  edit = (field: keyof CardDraft, value: string) => {
    this.draft = { ...this.draft, [field]: value };
    this.revision += 1; this.dirty = true; this.failed = false;
    this.persist(this.draft, this.revision);
    this.publish(); this.schedule();
  };
  hydrate = () => {
    if (this.hydration) return this.hydration;
    const startedAt = this.revision;
    this.hydration = this.storage.read().then(value => {
      if (!value || this.revision !== startedAt) return;
      try {
        const stored: unknown = JSON.parse(value);
        if (!stored || typeof stored !== 'object' || !('title' in stored) || !('body' in stored) || typeof stored.title !== 'string' || typeof stored.body !== 'string' || stored.title.length > 160 || stored.body.length > 8000) return;
        if (same(stored as CardDraft, this.draft)) { this.writes = this.writes.catch(() => {}).then(() => this.storage.remove()); return; }
        this.draft = { title: stored.title, body: stored.body };
        this.revision += 1; this.stored = this.revision; this.dirty = true;
        this.publish(); this.schedule();
      } catch { /* Invalid local data never replaces the cloud document. */ }
    }).catch(() => { this.storageFailed = true; this.publish(); });
    return this.hydration;
  };
  flush = (): Promise<boolean> => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty || this.scheduled === this.revision) return this.saves;
    if (this.storageFailed) this.persist(this.draft, this.revision);
    this.writeNow();
    const revision = this.revision;
    const draft = { ...this.draft, title: this.draft.title.trim() || 'Untitled' };
    const commit = this.commit;
    this.scheduled = revision; this.failed = false; this.publish();
    this.saves = this.saves.catch(() => false).then(async () => {
      try {
        await commit(draft);
        if (this.revision === revision) {
          this.draft = draft; this.dirty = false; this.failed = false;
          this.writes = this.writes.catch(() => {}).then(async () => {
            if (this.revision === revision && !this.dirty) { await this.storage.remove(); this.stored = -1; }
          }).catch(() => {});
        }
        this.publish(); return true;
      } catch {
        if (this.scheduled === revision) this.scheduled = -1;
        if (this.revision === revision) this.failed = true;
        this.publish(); return false;
      }
    });
    return this.saves;
  };
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.writeNow(); }
}
