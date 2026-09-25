import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runMigrations } from "./database.ts";
import { MOBILE_MIGRATIONS } from "./mobile-migrations.ts";
import { saveViaConnection } from "./local-submission.ts";
import { technicianSubmitAtomicallyViaConnection, type OutboxConnection } from "./local-submission-outbox.ts";
import type { LocalSubmissionInput } from "../local-submission.ts";
import type { TechnicianSubmitInput } from "../local-submission-outbox.ts";
import { readActiveProjectForUser, setActiveProject, type ActiveProjectStorage } from "../active-project-context.ts";
import { SubmissionBindingError, verifyNativeSubmitBinding, type SubmissionBinding } from "../submission-binding.ts";

/**
 * Checkpoint 1 — the project-binding guarantees proven against a REAL SQLite
 * engine (Node's built-in node:sqlite), running the app's own
 * MOBILE_MIGRATIONS and the exact production SQL builders — not a
 * text-matching fake. Skipped (not failed) on a Node without node:sqlite.
 */
type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: unknown[]): { changes: number | bigint };
    all(...values: unknown[]): Array<Record<string, unknown>>;
  };
};

let DatabaseSync: (new (path: string) => SqliteDatabase) | null = null;
try {
  ({ DatabaseSync } = (await import("node:sqlite")) as unknown as { DatabaseSync: new (path: string) => SqliteDatabase });
} catch {
  DatabaseSync = null;
}
const skip = DatabaseSync ? false : "node:sqlite is not available in this Node version";

function bindable(values: unknown[] = []): unknown[] {
  return values.map((v) => (v === undefined ? null : v));
}

/** The subset of @capacitor-community/sqlite's SQLiteDBConnection the repositories use, over node:sqlite. */
class NodeSqliteConnection implements OutboxConnection {
  db: SqliteDatabase;
  constructor() {
    if (!DatabaseSync) throw new Error("node:sqlite unavailable");
    this.db = new DatabaseSync(":memory:");
  }
  async execute(statements: string): Promise<unknown> {
    this.db.exec(statements);
    return {};
  }
  async run(statement: string, values: unknown[] = []) {
    const result = this.db.prepare(statement).run(...bindable(values));
    return { changes: { changes: Number(result.changes) } };
  }
  async query(statement: string, values: unknown[] = []) {
    return { values: this.db.prepare(statement).all(...bindable(values)) };
  }
  async executeSet(set: Array<{ statement: string; values?: unknown[] }>, transaction = true) {
    if (transaction) this.db.exec("BEGIN");
    try {
      let total = 0;
      for (const { statement, values } of set) {
        total += Number(this.db.prepare(statement).run(...bindable(values)).changes);
      }
      if (transaction) this.db.exec("COMMIT");
      return { changes: { changes: total } };
    } catch (e) {
      if (transaction) this.db.exec("ROLLBACK");
      throw e;
    }
  }
  submission(id: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM local_submissions WHERE local_submission_id = ?").all(id)[0];
  }
  outbox(id: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM local_submission_outbox WHERE local_submission_id = ?").all(id)[0];
  }
  outboxCount(): number {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM local_submission_outbox").all()[0].n);
  }
}

async function freshDb(): Promise<NodeSqliteConnection> {
  const db = new NodeSqliteConnection();
  await runMigrations(db, MOBILE_MIGRATIONS);
  return db;
}

class MemoryStorage implements ActiveProjectStorage {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

const PROJECT_A: SubmissionBinding = { userId: "user-1", companyId: "company-A", projectId: "project-A" };
const PROJECT_B: SubmissionBinding = { userId: "user-1", companyId: "company-B", projectId: "project-B" };

function draft(binding: SubmissionBinding, overrides: Partial<LocalSubmissionInput> = {}): LocalSubmissionInput {
  return {
    localSubmissionId: "sub-1",
    userId: binding.userId,
    companyId: binding.companyId,
    projectId: binding.projectId,
    status: "working",
    formId: "vac4",
    submissionType: "VAC4",
    definitionSchemaVersion: 2,
    selectedSections: ["VAC4"],
    payload: { coreJob: { customer: "Jane Doe" } },
    serverSubmissionId: null,
    ...overrides,
  };
}

function submit(binding: SubmissionBinding, overrides: Partial<TechnicianSubmitInput> = {}): TechnicianSubmitInput {
  return {
    localSubmissionId: "sub-1",
    userId: binding.userId,
    companyId: binding.companyId,
    projectId: binding.projectId,
    formId: "vac4",
    submissionType: "VAC4",
    selectedSections: ["VAC4"],
    localSubmissionPayload: { coreJob: { customer: "Jane Doe" } },
    snapshotPayload: { coreJobInfo: { customer: "Jane Doe" } },
    snapshotPhotos: [],
    snapshotDefinitionSchemaVersion: 2,
    submissionSnapshotHash: "hash-abc",
    technicianSubmittedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function storedBinding(row: Record<string, unknown> | undefined): SubmissionBinding | null {
  if (!row) return null;
  return { userId: String(row.user_id), companyId: String(row.company_id), projectId: String(row.project_id) };
}

describe("Checkpoint 1 — a native job card stays bound to the project it was created under (real SQLite)", { skip }, () => {
  it("A: a Project A draft stays Project A after the active project changes to B, through reopen, submit and the outbox row sync reads", async () => {
    const db = await freshDb();
    const storage = new MemoryStorage();

    // Project A -> create draft -> save. The form captures its binding once, from the owner-checked pointer.
    setActiveProject(PROJECT_A, storage);
    const formBinding = { userId: "user-1", ...readActiveProjectForUser("user-1", storage)! };
    assert.deepEqual(formBinding, PROJECT_A);
    await saveViaConnection(db, draft(formBinding));

    // Active project changes to B (navigating elsewhere). Later autosaves still use the form's own binding.
    setActiveProject(PROJECT_B, storage);
    await saveViaConnection(db, draft(formBinding, { payload: { coreJob: { customer: "Jane Doe", notes: "later edit" } } }));
    assert.deepEqual(storedBinding(db.submission("sub-1")), PROJECT_A);

    // Reopen the Project A draft: the resume path binds from the stored row, not from the pointer (still B).
    const resumedBinding = storedBinding(db.submission("sub-1"))!;
    assert.deepEqual(resumedBinding, PROJECT_A);
    assert.equal(readActiveProjectForUser("user-1", storage)?.projectId, "project-B", "sanity: the pointer really is B");

    // Submit (offline — nothing here touches the network): the final check passes only for A.
    const check = verifyNativeSubmitBinding({ currentUserId: "user-1", sessionBinding: resumedBinding, storedBinding: resumedBinding });
    assert.ok(check.ok);
    await technicianSubmitAtomicallyViaConnection(db, submit(check.binding));

    // The outbox row — the only thing the sync engine reads — targets Project A.
    const outbox = db.outbox("sub-1");
    assert.equal(outbox?.company_id, "company-A");
    assert.equal(outbox?.project_id, "project-A");
    assert.equal(outbox?.user_id, "user-1");
    assert.equal(outbox?.sync_state, "pending");
  });

  it("an autosave attempting to rebind an existing row to another project leaves the stored row completely untouched", async () => {
    const db = await freshDb();
    await saveViaConnection(db, draft(PROJECT_A, { payload: { coreJob: { customer: "Original" } } }));
    const before = db.submission("sub-1");

    await saveViaConnection(db, draft(PROJECT_B, { payload: { coreJob: { customer: "Rebound" } } }));

    const after = db.submission("sub-1");
    assert.deepEqual(storedBinding(after), PROJECT_A);
    assert.equal(JSON.parse(String(after?.payload)).coreJob.customer, "Original", "a mis-bound write must not change the payload either");
    assert.deepEqual(after, before);
  });

  it("a submit whose binding differs from the stored row fails closed — no outbox row, and the draft stays unsubmitted", async () => {
    const db = await freshDb();
    await saveViaConnection(db, draft(PROJECT_A));

    await assert.rejects(() => technicianSubmitAtomicallyViaConnection(db, submit(PROJECT_B)), SubmissionBindingError);

    assert.equal(db.outboxCount(), 0);
    assert.equal(db.submission("sub-1")?.technician_submitted_at, null);
    assert.deepEqual(storedBinding(db.submission("sub-1")), PROJECT_A);
  });

  it("a different user can never submit another user's draft under the same id", async () => {
    const db = await freshDb();
    await saveViaConnection(db, draft(PROJECT_A));
    const otherUser: SubmissionBinding = { ...PROJECT_A, userId: "user-2" };

    await assert.rejects(() => technicianSubmitAtomicallyViaConnection(db, submit(otherUser)), SubmissionBindingError);
    assert.equal(db.outboxCount(), 0);
    assert.equal(db.submission("sub-1")?.user_id, "user-1");
  });

  it("J (phantom-outbox regression, real SQL): a submit with NO prior autosave row still creates the bound local row and the outbox row together", async () => {
    const db = await freshDb();
    assert.equal(db.submission("sub-1"), undefined);

    await technicianSubmitAtomicallyViaConnection(db, submit(PROJECT_A));

    assert.equal(db.submission("sub-1")?.technician_submitted_at, "2026-02-01T00:00:00.000Z");
    assert.deepEqual(storedBinding(db.submission("sub-1")), PROJECT_A);
    assert.equal(db.outbox("sub-1")?.project_id, "project-A");
  });

  it("K (duplicate prevention, real SQL): a second submit of the same job card is rejected and leaves exactly one outbox row", async () => {
    const db = await freshDb();
    await technicianSubmitAtomicallyViaConnection(db, submit(PROJECT_A));

    await assert.rejects(() =>
      technicianSubmitAtomicallyViaConnection(db, submit(PROJECT_A, { technicianSubmittedAt: "2026-02-02T00:00:00.000Z" })),
    );

    assert.equal(db.outboxCount(), 1);
    assert.equal(db.outbox("sub-1")?.snapshot_technician_submitted_at, "2026-02-01T00:00:00.000Z");
    assert.equal(
      db.submission("sub-1")?.technician_submitted_at,
      "2026-02-01T00:00:00.000Z",
      "the rejected second submit must be rolled back entirely",
    );
  });
});
