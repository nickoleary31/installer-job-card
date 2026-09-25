import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTechnicianSubmitStatementSet,
  isOutboxRowClaimable,
  parseStoredRow,
  reconcileOrphanedClaimsViaConnection,
  recordOutboxAuthorizationBlockedViaConnection,
  recordOutboxServerConfirmedViaConnection,
  recordOutboxSyncFailureViaConnection,
  technicianSubmitAtomicallyViaConnection,
  tryClaimOutboxEntryViaConnection,
  type OutboxConnection,
} from "./local-submission-outbox.ts";
import type { TechnicianSubmitInput } from "../local-submission-outbox.ts";

function submitInput(overrides: Partial<TechnicianSubmitInput> = {}): TechnicianSubmitInput {
  return {
    localSubmissionId: "sub-1",
    userId: "user-1",
    companyId: "company-1",
    projectId: "project-1",
    formId: "vac4",
    submissionType: "VAC4",
    selectedSections: ["VAC4"],
    localSubmissionPayload: { coreJob: { customer: "Jane Doe" } },
    snapshotPayload: { coreJobInfo: { customer: "Jane Doe" } },
    snapshotPhotos: [],
    snapshotDefinitionSchemaVersion: 2,
    submissionSnapshotHash: "hash-abc",
    technicianSubmittedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildTechnicianSubmitStatementSet (pure) — the two statements composed into one atomic transaction", () => {
  it("is exactly two fully-parameterized statements: upsert local_submissions, then insert-outbox", () => {
    const set = buildTechnicianSubmitStatementSet(submitInput());
    assert.equal(set.length, 2);
    assert.match(set[0].statement, /^INSERT INTO local_submissions/);
    assert.match(set[0].statement, /ON CONFLICT\(local_submission_id\) DO UPDATE SET/);
    assert.match(set[1].statement, /^INSERT INTO local_submission_outbox/);
  });

  it("the local_submissions upsert never overwrites created_at on conflict — an existing draft's identity survives", () => {
    const set = buildTechnicianSubmitStatementSet(submitInput());
    assert.ok(!set[0].statement.includes("created_at = excluded"), "created_at must never be in the UPDATE SET clause");
  });

  it("never interpolates the technician's own JSON payload into the SQL text — it only ever appears in the parameterized values array", () => {
    const input = submitInput({ snapshotPayload: { coreJobInfo: { customer: "Robert'); DROP TABLE local_submissions;--" } } });
    const set = buildTechnicianSubmitStatementSet(input);
    for (const { statement } of set) {
      assert.ok(!statement.includes("DROP TABLE"), "raw payload content must never be interpolated into SQL text");
      assert.ok(!statement.includes("Robert"), "raw payload content must never be interpolated into SQL text");
    }
    assert.ok(JSON.parse(set[1].values[12] as string).coreJobInfo.customer.includes("DROP TABLE"));
  });

  it("both statements carry the SAME technicianSubmittedAt value — the hash and the stored value must never diverge", () => {
    const input = submitInput({ technicianSubmittedAt: "2026-03-05T12:00:00.000Z" });
    const set = buildTechnicianSubmitStatementSet(input);
    assert.equal(set[0].values[10], "2026-03-05T12:00:00.000Z"); // local_submissions.technician_submitted_at
    assert.equal(set[1].values[15], "2026-03-05T12:00:00.000Z"); // snapshot_technician_submitted_at
  });

  it("Phase 2H security reconciliation — the fresh outbox row's error_kind starts NULL — never pre-classified before any failure has occurred", () => {
    const set = buildTechnicianSubmitStatementSet(submitInput());
    assert.equal(set[1].values[10], null);
  });

  it("the local_submissions upsert is keyed on the SAME localSubmissionId as the outbox row it's paired with", () => {
    const set = buildTechnicianSubmitStatementSet(submitInput({ localSubmissionId: "sub-xyz" }));
    assert.equal(set[0].values[0], "sub-xyz");
    assert.equal(set[1].values[0], "sub-xyz");
  });

  it("inserts the outbox row with sync_state = 'pending' and attempt_count = 0", () => {
    const set = buildTechnicianSubmitStatementSet(submitInput());
    assert.equal(set[1].values[4], "pending");
    assert.equal(set[1].values[7], 0);
  });

  it("Checkpoint 1 — the outbox insert is guarded on the paired local_submissions row carrying this exact binding and submit time", () => {
    const set = buildTechnicianSubmitStatementSet(
      submitInput({ userId: "user-9", companyId: "company-9", projectId: "project-9", technicianSubmittedAt: "2026-04-04T00:00:00.000Z" }),
    );
    assert.match(set[1].statement, /WHERE EXISTS/);
    assert.match(set[1].statement, /FROM local_submissions/);
    assert.deepEqual(set[1].values.slice(19), ["sub-1", "user-9", "company-9", "project-9", "2026-04-04T00:00:00.000Z"]);
  });

  it("Checkpoint 1 — the local_submissions upsert never rewrites user/company/project and only applies to a row with the same binding", () => {
    const [upsert] = buildTechnicianSubmitStatementSet(submitInput());
    for (const column of ["user_id", "company_id", "project_id"]) {
      assert.ok(!upsert.statement.includes(`${column} = excluded.${column},`), `${column} must never be in the UPDATE SET clause`);
    }
    assert.match(upsert.statement, /WHERE local_submissions\.user_id = excluded\.user_id/);
    assert.match(upsert.statement, /local_submissions\.company_id = excluded\.company_id/);
    assert.match(upsert.statement, /local_submissions\.project_id = excluded\.project_id/);
  });
});

describe("parseStoredRow (pure) — the read-side counterpart", () => {
  it("decodes a well-formed row, JSON-parsing the two snapshot columns", () => {
    const row = {
      local_submission_id: "sub-1",
      user_id: "user-1",
      company_id: "company-1",
      project_id: "project-1",
      sync_state: "pending",
      claim_token: null,
      claimed_at: null,
      attempt_count: 0,
      last_attempt_at: null,
      last_error: null,
      error_kind: null,
      server_submission_id: null,
      snapshot_payload: JSON.stringify({ coreJobInfo: { customer: "Jane Doe" } }),
      snapshot_photos: JSON.stringify([{ localPhotoId: "p1" }]),
      snapshot_definition_schema_version: 2,
      snapshot_technician_submitted_at: "2026-01-01T00:00:00.000Z",
      submission_snapshot_hash: "hash-abc",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const parsed = parseStoredRow(row);
    assert.equal(parsed.syncState, "pending");
    assert.deepEqual(parsed.snapshotPayload, { coreJobInfo: { customer: "Jane Doe" } });
    assert.deepEqual(parsed.snapshotPhotos, [{ localPhotoId: "p1" }]);
    assert.equal(parsed.errorKind, null);
  });

  it("Phase 2H security reconciliation — decodes a 'terminal' error_kind, and normalizes an unrecognized value to null rather than throwing", () => {
    const base = {
      local_submission_id: "sub-1",
      user_id: "user-1",
      company_id: "company-1",
      project_id: "project-1",
      sync_state: "failed",
      claim_token: null,
      claimed_at: null,
      attempt_count: 1,
      last_attempt_at: null,
      last_error: "Project does not belong to the specified company.",
      server_submission_id: null,
      snapshot_payload: "{}",
      snapshot_photos: "[]",
      snapshot_definition_schema_version: null,
      snapshot_technician_submitted_at: "2026-01-01T00:00:00.000Z",
      submission_snapshot_hash: "hash-abc",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(parseStoredRow({ ...base, error_kind: "terminal" }).errorKind, "terminal");
    assert.equal(parseStoredRow({ ...base, error_kind: "retryable" }).errorKind, "retryable");
    assert.equal(parseStoredRow({ ...base, error_kind: "some-future-value" }).errorKind, null);
    assert.equal(parseStoredRow({ ...base, error_kind: null }).errorKind, null);
  });

  it("normalizes an unrecognized sync_state to 'pending' rather than throwing", () => {
    const row = {
      local_submission_id: "sub-1",
      user_id: "user-1",
      company_id: "company-1",
      project_id: "project-1",
      sync_state: "some-future-state",
      claim_token: null,
      claimed_at: null,
      attempt_count: 0,
      last_attempt_at: null,
      last_error: null,
      server_submission_id: null,
      snapshot_payload: "{}",
      snapshot_photos: "[]",
      snapshot_definition_schema_version: null,
      snapshot_technician_submitted_at: "2026-01-01T00:00:00.000Z",
      submission_snapshot_hash: "hash-abc",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(parseStoredRow(row).syncState, "pending");
  });
});

/**
 * A fake that mirrors real SQLite semantics closely enough to prove the
 * things this phase's design review specifically required verified: (1) the
 * technician-submit transaction is genuinely atomic (a failure in the
 * second statement leaves the first's effect rolled back, never a half-
 * applied state), (2) the claim is a real compare-and-set (only one of two
 * concurrent callers ever wins), (3) reconcileOrphanedClaims only ever
 * touches 'syncing' rows with a mismatched claim_token.
 */
class FakeOutboxConnection implements OutboxConnection {
  outboxRows = new Map<string, Record<string, unknown>>();
  submissionRows = new Map<string, Record<string, unknown>>();
  failSecondStatement = false;

  async executeSet(set: Array<{ statement: string; values?: unknown[] }>, _transaction?: boolean) {
    const outboxSnapshot = new Map(this.outboxRows);
    const submissionSnapshot = new Map(this.submissionRows);
    try {
      let last: { changes?: { changes?: number } } = {};
      for (let i = 0; i < set.length; i += 1) {
        if (this.failSecondStatement && i === 1) throw new Error("simulated second-statement failure");
        last = await this.run(set[i].statement, set[i].values);
      }
      return last;
    } catch (e) {
      // Real SQLite executeSet(set, transaction: true) rolls back entirely on any failure.
      this.outboxRows = outboxSnapshot;
      this.submissionRows = submissionSnapshot;
      throw e;
    }
  }

  async run(statement: string, values: unknown[] = []) {
    if (statement.startsWith("INSERT INTO local_submissions")) {
      // values: [id, userId, projectId, companyId, formId, submissionType, defSchemaVersion,
      //          selectedSections, payload, serverSubmissionId, technicianSubmittedAt, createdAt, updatedAt]
      const localSubmissionId = values[0] as string;
      const technicianSubmittedAt = values[10] as string;
      const createdAtCandidate = values[11] as string;
      const existing = this.submissionRows.get(localSubmissionId);
      // Real ON CONFLICT DO UPDATE never touches created_at — preserve whatever was already there.
      this.submissionRows.set(localSubmissionId, {
        technicianSubmittedAt,
        createdAt: existing ? existing.createdAt : createdAtCandidate,
      });
      return { changes: { changes: 1 } };
    }
    if (statement.startsWith("INSERT INTO local_submission_outbox")) {
      const [localSubmissionId, userId, companyId, projectId, syncState] = values as [string, string, string, string, string];
      this.outboxRows.set(localSubmissionId, { userId, companyId, projectId, syncState, claimToken: null, errorKind: null });
      return { changes: { changes: 1 } };
    }
    if (statement.includes("WHERE local_submission_id = ? AND claim_token = ?")) {
      // recordOutboxSyncFailure / recordOutboxAuthorizationBlocked / recordOutboxServerConfirmed
      // — checked first: this WHERE clause text is unique to these three statements.
      const localSubmissionId = values[values.length - 2] as string;
      const claimToken = values[values.length - 1] as string;
      const row = this.outboxRows.get(localSubmissionId);
      if (!row || row.claimToken !== claimToken) return { changes: { changes: 0 } };
      const isSyncFailure = statement.includes("error_kind = ?");
      const nextState = statement.includes("'failed'") ? "failed" : statement.includes("'authorization-blocked'") ? "authorization-blocked" : "server-confirmed";
      // buildRecordSyncFailureSql values: [error, errorKind, now, localSubmissionId, claimToken].
      const errorKind = isSyncFailure ? (values[1] as string) : row.errorKind ?? null;
      this.outboxRows.set(localSubmissionId, { ...row, syncState: nextState, errorKind });
      return { changes: { changes: 1 } };
    }
    if (statement.includes("WHERE local_submission_id = ? AND sync_state IN")) {
      // The atomic claim (tryClaimOutboxEntry).
      const [claimToken, , , , localSubmissionId] = values as [string, string, string, string, string];
      const row = this.outboxRows.get(localSubmissionId);
      const claimable = row && ["pending", "failed", "authorization-blocked"].includes(row.syncState as string);
      if (!claimable) return { changes: { changes: 0 } };
      this.outboxRows.set(localSubmissionId, { ...row, syncState: "syncing", claimToken });
      return { changes: { changes: 1 } };
    }
    if (statement.includes("WHERE sync_state = 'syncing' AND")) {
      // reconcileOrphanedClaims
      const currentSessionClaimToken = values[values.length - 1] as string;
      let changed = 0;
      for (const [id, row] of this.outboxRows) {
        if (row.syncState === "syncing" && row.claimToken !== currentSessionClaimToken) {
          this.outboxRows.set(id, { ...row, syncState: "failed" });
          changed += 1;
        }
      }
      return { changes: { changes: changed } };
    }
    return { changes: { changes: 0 } };
  }

  async query(statement: string, values: unknown[] = []): Promise<{ values?: Array<Record<string, unknown>> }> {
    if (statement.includes("SELECT local_submission_id FROM local_submission_outbox")) {
      // Checkpoint 1's post-transaction binding verification.
      const [localSubmissionId, userId, companyId, projectId] = values as [string, string, string, string];
      const row = this.outboxRows.get(localSubmissionId);
      const matches = row && row.userId === userId && row.companyId === companyId && row.projectId === projectId;
      return { values: matches ? [{ local_submission_id: localSubmissionId }] : [] };
    }
    return { values: [] };
  }
}

describe("technicianSubmitAtomicallyViaConnection — real atomicity via executeSet(set, transaction: true)", () => {
  it("both statements apply together on success", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    assert.equal(db.submissionRows.get("sub-1")?.technicianSubmittedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(db.outboxRows.get("sub-1")?.syncState, "pending");
  });

  it("creates the backing local_submissions row atomically when it did NOT already exist — e.g. a brand-new online-native card with no prior autosave (the exact defect this fix addresses)", async () => {
    const db = new FakeOutboxConnection();
    assert.equal(db.submissionRows.has("sub-1"), false, "sanity: no row exists yet");
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    assert.equal(db.submissionRows.get("sub-1")?.technicianSubmittedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(db.outboxRows.get("sub-1")?.syncState, "pending");
  });

  it("preserves an EXISTING local_submissions row's created_at/identity while bringing it to the final submitted state", async () => {
    const db = new FakeOutboxConnection();
    db.submissionRows.set("sub-1", { technicianSubmittedAt: null, createdAt: "2025-06-01T00:00:00.000Z" });
    await technicianSubmitAtomicallyViaConnection(db, submitInput({ technicianSubmittedAt: "2026-01-01T00:00:00.000Z" }));
    assert.equal(db.submissionRows.get("sub-1")?.createdAt, "2025-06-01T00:00:00.000Z", "created_at/identity must survive unchanged");
    assert.equal(db.submissionRows.get("sub-1")?.technicianSubmittedAt, "2026-01-01T00:00:00.000Z");
  });

  it("the outbox row never exists without a backing local_submissions row after a successful submit — either all local submit state exists, or none does", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    assert.ok(db.outboxRows.has("sub-1"));
    assert.ok(db.submissionRows.has("sub-1"), "outbox row must never exist without its backing local_submissions row");
  });

  it("a failure partway through leaves NEITHER statement's effect applied — no half-submitted state", async () => {
    const db = new FakeOutboxConnection();
    db.failSecondStatement = true;
    await assert.rejects(() => technicianSubmitAtomicallyViaConnection(db, submitInput()));
    assert.equal(db.submissionRows.has("sub-1"), false, "technician_submitted_at must NOT be set if the outbox insert failed");
    assert.equal(db.outboxRows.has("sub-1"), false);
  });
});

describe("tryClaimOutboxEntryViaConnection — atomic compare-and-set single-worker claim", () => {
  it("only one of two concurrent claim attempts on the same row succeeds", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    const claimA = await tryClaimOutboxEntryViaConnection(db, "sub-1", "token-A", "now");
    const claimB = await tryClaimOutboxEntryViaConnection(db, "sub-1", "token-B", "now");
    assert.equal(claimA, true, "the first claim must win");
    assert.equal(claimB, false, "the second claim must lose — the row is no longer in a claimable state");
  });

  it("a non-claimable state (already syncing, or server-confirmed) can never be claimed", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    db.outboxRows.set("sub-1", { ...db.outboxRows.get("sub-1"), syncState: "server-confirmed" });
    assert.equal(await tryClaimOutboxEntryViaConnection(db, "sub-1", "token-A", "now"), false);
  });
});

describe("recordOutboxSyncFailure / AuthorizationBlocked / ServerConfirmed — only apply with the CURRENT claim_token", () => {
  it("recordOutboxServerConfirmed transitions a claimed row to server-confirmed", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    await tryClaimOutboxEntryViaConnection(db, "sub-1", "token-A", "now");
    await recordOutboxServerConfirmedViaConnection(db, "sub-1", "token-A", "server-sub-1", "now");
    assert.equal(db.outboxRows.get("sub-1")?.syncState, "server-confirmed");
  });

  it("recordOutboxSyncFailure transitions a claimed row to failed (retryable)", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    await tryClaimOutboxEntryViaConnection(db, "sub-1", "token-A", "now");
    await recordOutboxSyncFailureViaConnection(db, "sub-1", "token-A", "network error", "retryable", "now");
    assert.equal(db.outboxRows.get("sub-1")?.syncState, "failed");
  });

  it("Phase 2H security reconciliation — recordOutboxSyncFailure persists the errorKind it's given, distinguishing retryable from terminal", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    await tryClaimOutboxEntryViaConnection(db, "sub-1", "token-A", "now");
    await recordOutboxSyncFailureViaConnection(db, "sub-1", "token-A", "project/company mismatch", "terminal", "now");
    assert.equal(db.outboxRows.get("sub-1")?.errorKind, "terminal");
  });

  it("recordOutboxAuthorizationBlocked transitions a claimed row to authorization-blocked", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    await tryClaimOutboxEntryViaConnection(db, "sub-1", "token-A", "now");
    await recordOutboxAuthorizationBlockedViaConnection(db, "sub-1", "token-A", "now");
    assert.equal(db.outboxRows.get("sub-1")?.syncState, "authorization-blocked");
  });

  it("a write with a STALE claim_token (a superseded attempt) never applies", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    await tryClaimOutboxEntryViaConnection(db, "sub-1", "token-A", "now");
    // Simulate: token-A's attempt failed and was reclaimed under token-B before token-A's own
    // (stale) confirmation write arrives.
    await recordOutboxSyncFailureViaConnection(db, "sub-1", "token-A", "timed out", "retryable", "now");
    await tryClaimOutboxEntryViaConnection(db, "sub-1", "token-B", "now");
    await recordOutboxServerConfirmedViaConnection(db, "sub-1", "token-A", "server-sub-1", "now");
    assert.equal(db.outboxRows.get("sub-1")?.syncState, "syncing", "token-A's stale write must not clobber token-B's active claim");
  });
});

describe("isOutboxRowClaimable (pure) — Phase 2H security reconciliation's automatic/manual retry eligibility gate", () => {
  it("a 'pending' row is always claimable, regardless of errorKind", () => {
    assert.equal(isOutboxRowClaimable("pending", null), true);
    assert.equal(isOutboxRowClaimable("pending", "terminal"), true, "errorKind is only ever meaningful for 'failed'");
  });

  it("an 'authorization-blocked' row is always claimable — the technician may have already re-authenticated", () => {
    assert.equal(isOutboxRowClaimable("authorization-blocked", null), true);
  });

  it("a 'failed' row with errorKind null (legacy row, or written before classification) is claimable — never silently stop retrying", () => {
    assert.equal(isOutboxRowClaimable("failed", null), true);
  });

  it("a 'failed' row with errorKind 'retryable' is claimable", () => {
    assert.equal(isOutboxRowClaimable("failed", "retryable"), true);
  });

  it("a 'failed' row with errorKind 'terminal' is NEVER claimable — excluded from both automatic AND manual retry (they share this one gate)", () => {
    assert.equal(isOutboxRowClaimable("failed", "terminal"), false);
  });

  it("'syncing' (already claimed) and 'server-confirmed' (done) are never claimable", () => {
    assert.equal(isOutboxRowClaimable("syncing", null), false);
    assert.equal(isOutboxRowClaimable("server-confirmed", null), false);
  });
});

describe("reconcileOrphanedClaimsViaConnection — crash-orphan recovery scope", () => {
  it("moves a stale 'syncing' row (claimed by a since-gone session) to 'failed'", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    await tryClaimOutboxEntryViaConnection(db, "sub-1", "dead-session-token", "now");
    assert.equal(db.outboxRows.get("sub-1")?.syncState, "syncing");

    await reconcileOrphanedClaimsViaConnection(db, "fresh-session-token", "now");
    assert.equal(db.outboxRows.get("sub-1")?.syncState, "failed");
  });

  it("never touches a row genuinely claimed by THIS session's own token", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    await tryClaimOutboxEntryViaConnection(db, "sub-1", "this-session-token", "now");

    await reconcileOrphanedClaimsViaConnection(db, "this-session-token", "now");
    assert.equal(
      db.outboxRows.get("sub-1")?.syncState,
      "syncing",
      "a row this same session legitimately claimed must never be reinterpreted as orphaned",
    );
  });

  it("never touches a 'pending' or 'server-confirmed' row", async () => {
    const db = new FakeOutboxConnection();
    await technicianSubmitAtomicallyViaConnection(db, submitInput());
    assert.equal(db.outboxRows.get("sub-1")?.syncState, "pending");

    await reconcileOrphanedClaimsViaConnection(db, "any-token", "now");
    assert.equal(db.outboxRows.get("sub-1")?.syncState, "pending", "a merely-pending row (never claimed) must never be marked failed");
  });
});
