/**
 * Boundary interface only (Phase 1A) — NOT the local-first sync engine.
 * Deliberately generic (no job-card/photo/submission fields) so it doesn't
 * bake in assumptions about the eventual durable outbox's shape. The
 * in-memory implementation below does not persist anything and is lost on
 * reload; it exists only so calling code can be written against the
 * interface now. Phase 2 replaces the implementation with an IndexedDB or
 * SQLite-backed queue — callers of this interface won't need to change.
 */
export type OutboxEntry = {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
};

export interface Outbox {
  enqueue(kind: string, payload: unknown): Promise<OutboxEntry>;
  list(): Promise<OutboxEntry[]>;
  remove(id: string): Promise<void>;
}

class InMemoryOutbox implements Outbox {
  private entries = new Map<string, OutboxEntry>();

  async enqueue(kind: string, payload: unknown): Promise<OutboxEntry> {
    const entry: OutboxEntry = {
      id: crypto.randomUUID(),
      kind,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  async list(): Promise<OutboxEntry[]> {
    return [...this.entries.values()];
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id);
  }
}

let sharedOutbox: Outbox | null = null;

/** Same non-persistent implementation for web and native in Phase 1A. */
export function getOutbox(): Outbox {
  if (!sharedOutbox) sharedOutbox = new InMemoryOutbox();
  return sharedOutbox;
}
