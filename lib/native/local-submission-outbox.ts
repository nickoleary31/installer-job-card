import { getNativeSqliteConnection, runMigrations } from "./database.ts";
import { MOBILE_MIGRATIONS } from "./mobile-migrations.ts";
import { buildTechnicianSubmitUpsertStatement } from "./local-submission.ts";
import { NATIVE_SUBMISSION_BINDING_MISMATCH_MESSAGE, SubmissionBindingError } from "../submission-binding.ts";
import type {
  FrozenSnapshotPhoto,
  LocalSubmissionOutboxEntry,
  LocalSubmissionOutboxRepository,
  OutboxErrorKind,
  OutboxSyncState,
  TechnicianSubmitInput,
} from "../local-submission-outbox.ts";

/**
 * Phase 2H native implementation. One row per localSubmissionId — see
 * lib/local-submission-outbox.ts's module doc for the frozen-snapshot and
 * hash design this table stores. Schema (version 7, plus version 8's
 * error_kind column — see that migration's own doc) lives in
 * mobile-migrations.ts's single canonical catalog, not here.
 */
const TABLE = "local_submission_outbox";

const COLUMNS = `local_submission_id, user_id, company_id, project_id, sync_state,
      claim_token, claimed_at, attempt_count, last_attempt_at, last_error,
      error_kind, server_submission_id, snapshot_payload, snapshot_photos,
      snapshot_definition_schema_version, snapshot_technician_submitted_at,
      submission_snapshot_hash, created_at, updated_at`;

/**
 * Checkpoint 1 — the outbox row is inserted ONLY when, inside the same
 * transaction, the paired local_submissions row exists with exactly this
 * submit's user/company/project binding and this submit's
 * technician_submitted_at (i.e. the preceding upsert actually applied to a
 * row bound the same way). Bind order: the 19 column values, then the five
 * guard values. See technicianSubmitAtomicallyViaConnection for the
 * post-transaction verification that turns a guarded no-op into an error.
 */
function buildInsertOutboxSql(): string {
  return `INSERT INTO ${TABLE} (${COLUMNS})
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM local_submissions
      WHERE local_submission_id = ? AND user_id = ? AND company_id = ? AND project_id = ?
        AND technician_submitted_at = ?
    )`;
}

function buildSelectByIdSql(): string {
  return `SELECT ${COLUMNS} FROM ${TABLE} WHERE local_submission_id = ?`;
}

function buildSelectBoundOutboxEntrySql(): string {
  return `SELECT local_submission_id FROM ${TABLE}
    WHERE local_submission_id = ? AND user_id = ? AND company_id = ? AND project_id = ?
      AND submission_snapshot_hash = ?`;
}

function buildSelectAllForUserSql(): string {
  return `SELECT ${COLUMNS} FROM ${TABLE} WHERE user_id = ? ORDER BY created_at DESC`;
}

/**
 * Pure mirror of buildSelectClaimableForUserSql's WHERE clause — exported so
 * the "is this row eligible for automatic/manual retry claim" decision is
 * directly unit-testable without a device or a real SQL engine (see this
 * file's own established pattern: every other repository decision here is
 * split into a pure/testable piece plus real SQL — see
 * local-submission-outbox.test.ts). Keep the two in sync by construction:
 * this is the single source of truth for the decision, and
 * buildSelectClaimableForUserSql's SQL must encode exactly this same logic.
 *
 * A 'failed' row is claimable ONLY when it is NOT classified 'terminal'
 * (NULL/'retryable' both count — NULL covers both a row written before
 * error_kind existed and a syncing→failed transition that hasn't set it,
 * and both must stay claimable rather than silently stop retrying).
 * 'pending' and 'authorization-blocked' are always claimable regardless of
 * error_kind (that column is only ever meaningful for 'failed' — see
 * OutboxErrorKind's own doc). This is the ONE gate both automatic
 * (ForegroundSyncMount) and manual (Retry button, which also calls
 * runForegroundSync) retry paths share — see this file's own repository
 * interface doc.
 */
export function isOutboxRowClaimable(syncState: OutboxSyncState, errorKind: OutboxErrorKind | null): boolean {
  if (syncState === "pending" || syncState === "authorization-blocked") return true;
  if (syncState === "failed") return errorKind !== "terminal";
  return false; // 'syncing' (already claimed by someone) or 'server-confirmed' (done)
}

function buildSelectClaimableForUserSql(): string {
  return `SELECT ${COLUMNS} FROM ${TABLE}
    WHERE user_id = ?
      AND (
        sync_state IN ('pending', 'authorization-blocked')
        OR (sync_state = 'failed' AND (error_kind IS NULL OR error_kind != 'terminal'))
      )
    ORDER BY created_at ASC`;
}

function buildTryClaimSql(): string {
  return `UPDATE ${TABLE} SET
      sync_state = 'syncing',
      claim_token = ?,
      claimed_at = ?,
      attempt_count = attempt_count + 1,
      last_attempt_at = ?,
      updated_at = ?
    WHERE local_submission_id = ? AND sync_state IN ('pending', 'failed', 'authorization-blocked')`;
}

function buildRecordSyncFailureSql(): string {
  return `UPDATE ${TABLE} SET sync_state = 'failed', last_error = ?, error_kind = ?, updated_at = ?
    WHERE local_submission_id = ? AND claim_token = ?`;
}

function buildRecordAuthorizationBlockedSql(): string {
  return `UPDATE ${TABLE} SET sync_state = 'authorization-blocked', last_error = ?, updated_at = ?
    WHERE local_submission_id = ? AND claim_token = ?`;
}

function buildRecordServerConfirmedSql(): string {
  return `UPDATE ${TABLE} SET sync_state = 'server-confirmed', server_submission_id = ?, last_error = NULL, updated_at = ?
    WHERE local_submission_id = ? AND claim_token = ?`;
}

/**
 * Crash-orphan recovery — see this table's own repository interface doc
 * (reconcileOrphanedClaims) for why this is called ONLY from
 * lib/submission-sync.ts's ensureSyncEngineInitialized() singleton, never
 * from getSchemaReadyConnection(). `claim_token IS NULL` never matches a
 * row genuinely 'syncing' (tryClaimOutboxEntry always sets a token in the
 * same UPDATE that sets sync_state='syncing'), but is included for
 * defense-in-depth against any row that somehow reached 'syncing' without one.
 */
function buildReconcileOrphansSql(): string {
  return `UPDATE ${TABLE} SET sync_state = 'failed', last_error = ?, updated_at = ?
    WHERE sync_state = 'syncing' AND (claim_token IS NULL OR claim_token != ?)`;
}

type OutboxRow = {
  local_submission_id: string;
  user_id: string;
  company_id: string;
  project_id: string;
  sync_state: string;
  claim_token: string | null;
  claimed_at: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  last_error: string | null;
  error_kind: string | null;
  server_submission_id: string | null;
  snapshot_payload: string;
  snapshot_photos: string;
  snapshot_definition_schema_version: number | null;
  snapshot_technician_submitted_at: string;
  submission_snapshot_hash: string;
  created_at: string;
  updated_at: string;
};

const VALID_SYNC_STATES: readonly OutboxSyncState[] = ["pending", "syncing", "failed", "authorization-blocked", "server-confirmed"];
const VALID_ERROR_KINDS: readonly OutboxErrorKind[] = ["retryable", "terminal"];

function parseSyncState(value: string): OutboxSyncState {
  return (VALID_SYNC_STATES as readonly string[]).includes(value) ? (value as OutboxSyncState) : "pending";
}

/** null/unrecognized -> null, never a thrown error — an unrecognized value must never crash the claimable-list read path. */
function parseErrorKind(value: string | null): OutboxErrorKind | null {
  return value && (VALID_ERROR_KINDS as readonly string[]).includes(value) ? (value as OutboxErrorKind) : null;
}

/** Pure — maps a stored row to the repository's public shape. Throws on malformed JSON — see local-submission-outbox.test.ts. */
export function parseStoredRow<TPayload>(row: OutboxRow): LocalSubmissionOutboxEntry<TPayload> {
  return {
    localSubmissionId: row.local_submission_id,
    userId: row.user_id,
    companyId: row.company_id,
    projectId: row.project_id,
    syncState: parseSyncState(row.sync_state),
    claimToken: row.claim_token,
    claimedAt: row.claimed_at,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    errorKind: parseErrorKind(row.error_kind),
    serverSubmissionId: row.server_submission_id,
    snapshotPayload: JSON.parse(row.snapshot_payload) as TPayload,
    snapshotPhotos: JSON.parse(row.snapshot_photos) as FrozenSnapshotPhoto[],
    snapshotDefinitionSchemaVersion: row.snapshot_definition_schema_version,
    snapshotTechnicianSubmittedAt: row.snapshot_technician_submitted_at,
    submissionSnapshotHash: row.submission_snapshot_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Minimal shape this file needs from a SQLiteDBConnection-like object, extended with the real executeSet() transaction primitive. */
export interface OutboxConnection {
  run(statement: string, values?: unknown[]): Promise<{ changes?: { changes?: number } }>;
  query(statement: string, values?: unknown[]): Promise<{ values?: Array<Record<string, unknown>> }>;
  executeSet(set: Array<{ statement: string; values?: unknown[] }>, transaction?: boolean): Promise<{ changes?: { changes?: number } }>;
}

/**
 * Pure — the two fully-parameterized statements composed into ONE real
 * atomic native transaction via executeSet(set, transaction: true). Verified
 * (not assumed) against @capacitor-community/sqlite's actual plugin source
 * (node_modules/@capacitor-community/sqlite/dist/plugin.js): executeSet's
 * `transaction` parameter defaults to true and is passed straight through
 * to the native bridge call — this is a real single native transaction, not
 * a semicolon-joined string (which would require interpolating the
 * technician's own JSON payload into raw SQL — see this phase's design
 * review correction on exactly this point). Split out and exported so it's
 * unit-testable without a device — see local-submission-outbox.test.ts.
 *
 * Phase 2H fix — statement[0] is now buildTechnicianSubmitUpsertStatement's
 * full INSERT ... ON CONFLICT upsert (was a plain UPDATE that silently
 * no-op'd when no local_submissions row already existed — see that
 * function's own doc). Both statements still commit or roll back together.
 */
export function buildTechnicianSubmitStatementSet<TPayload, TLocalPayload = unknown>(
  input: TechnicianSubmitInput<TPayload, TLocalPayload>,
): Array<{ statement: string; values: unknown[] }> {
  const upsertLocalSubmission = buildTechnicianSubmitUpsertStatement(
    {
      localSubmissionId: input.localSubmissionId,
      userId: input.userId,
      projectId: input.projectId,
      companyId: input.companyId,
      formId: input.formId,
      submissionType: input.submissionType,
      definitionSchemaVersion: input.snapshotDefinitionSchemaVersion,
      selectedSections: input.selectedSections,
      payload: input.localSubmissionPayload,
      serverSubmissionId: null,
    },
    input.technicianSubmittedAt,
  );
  return [
    upsertLocalSubmission,
    {
      statement: buildInsertOutboxSql(),
      values: [
        input.localSubmissionId,
        input.userId,
        input.companyId,
        input.projectId,
        "pending" satisfies OutboxSyncState,
        null,
        null,
        0,
        null,
        null,
        null, // error_kind — never set on a fresh 'pending' row, only by recordOutboxSyncFailure
        null,
        JSON.stringify(input.snapshotPayload),
        JSON.stringify(input.snapshotPhotos),
        input.snapshotDefinitionSchemaVersion,
        input.technicianSubmittedAt,
        input.submissionSnapshotHash,
        input.technicianSubmittedAt,
        input.technicianSubmittedAt,
        // Guard values for the WHERE EXISTS — see buildInsertOutboxSql.
        input.localSubmissionId,
        input.userId,
        input.companyId,
        input.projectId,
        input.technicianSubmittedAt,
      ],
    },
  ];
}

async function getSchemaReadyConnection() {
  const db = await getNativeSqliteConnection();
  await runMigrations(db, MOBILE_MIGRATIONS);
  return db as unknown as OutboxConnection;
}

/**
 * Connection-agnostic implementations, split out (mirroring
 * lib/native/local-submission.ts's saveViaConnection) so each one is
 * unit-testable against a fake connection without a real device — see
 * local-submission-outbox.test.ts. The NativeLocalSubmissionOutbox class
 * below is a thin wrapper that supplies the real device connection.
 */
export async function technicianSubmitAtomicallyViaConnection<TPayload, TLocalPayload = unknown>(
  db: OutboxConnection,
  input: TechnicianSubmitInput<TPayload, TLocalPayload>,
): Promise<{ technicianSubmittedAt: string }> {
  await db.executeSet(buildTechnicianSubmitStatementSet(input), true);
  // Checkpoint 1 — a binding mismatch makes both guarded statements no-ops
  // (nothing is written, so nothing needs rolling back); surface it as a
  // failed submit instead of reporting success for an entry that was never
  // queued.
  const check = await db.query(buildSelectBoundOutboxEntrySql(), [
    input.localSubmissionId,
    input.userId,
    input.companyId,
    input.projectId,
    input.submissionSnapshotHash,
  ]);
  if (!check.values?.length) {
    throw new SubmissionBindingError(NATIVE_SUBMISSION_BINDING_MISMATCH_MESSAGE);
  }
  return { technicianSubmittedAt: input.technicianSubmittedAt };
}

export async function tryClaimOutboxEntryViaConnection(
  db: OutboxConnection,
  localSubmissionId: string,
  claimToken: string,
  now: string,
): Promise<boolean> {
  const result = await db.run(buildTryClaimSql(), [claimToken, now, now, now, localSubmissionId]);
  return result.changes?.changes === 1;
}

export async function recordOutboxSyncFailureViaConnection(
  db: OutboxConnection,
  localSubmissionId: string,
  claimToken: string,
  error: string,
  errorKind: OutboxErrorKind,
  now: string,
): Promise<void> {
  await db.run(buildRecordSyncFailureSql(), [error, errorKind, now, localSubmissionId, claimToken]);
}

export async function recordOutboxAuthorizationBlockedViaConnection(
  db: OutboxConnection,
  localSubmissionId: string,
  claimToken: string,
  now: string,
): Promise<void> {
  await db.run(buildRecordAuthorizationBlockedSql(), ["Authorization required.", now, localSubmissionId, claimToken]);
}

export async function recordOutboxServerConfirmedViaConnection(
  db: OutboxConnection,
  localSubmissionId: string,
  claimToken: string,
  serverSubmissionId: string,
  now: string,
): Promise<void> {
  await db.run(buildRecordServerConfirmedSql(), [serverSubmissionId, now, localSubmissionId, claimToken]);
}

export async function reconcileOrphanedClaimsViaConnection(
  db: OutboxConnection,
  currentSessionClaimToken: string,
  now: string,
): Promise<void> {
  await db.run(buildReconcileOrphansSql(), [
    "Sync was interrupted (app closed or crashed mid-sync) and is retrying.",
    now,
    currentSessionClaimToken,
  ]);
}

export class NativeLocalSubmissionOutbox implements LocalSubmissionOutboxRepository {
  async technicianSubmitAtomically<TPayload, TLocalPayload = unknown>(
    input: TechnicianSubmitInput<TPayload, TLocalPayload>,
  ): Promise<{ technicianSubmittedAt: string }> {
    return technicianSubmitAtomicallyViaConnection(await getSchemaReadyConnection(), input);
  }

  async loadOutboxEntry<TPayload>(localSubmissionId: string): Promise<LocalSubmissionOutboxEntry<TPayload> | null> {
    const db = await getSchemaReadyConnection();
    const result = await db.query(buildSelectByIdSql(), [localSubmissionId]);
    const row = result.values?.[0] as unknown as OutboxRow | undefined;
    return row ? parseStoredRow<TPayload>(row) : null;
  }

  async listAllOutboxEntriesForUser<TPayload>(userId: string): Promise<LocalSubmissionOutboxEntry<TPayload>[]> {
    const db = await getSchemaReadyConnection();
    const result = await db.query(buildSelectAllForUserSql(), [userId]);
    return ((result.values ?? []) as unknown as OutboxRow[]).map((row) => parseStoredRow<TPayload>(row));
  }

  async listClaimableOutboxEntries<TPayload>(userId: string): Promise<LocalSubmissionOutboxEntry<TPayload>[]> {
    const db = await getSchemaReadyConnection();
    const result = await db.query(buildSelectClaimableForUserSql(), [userId]);
    const entries = ((result.values ?? []) as unknown as OutboxRow[]).map((row) => parseStoredRow<TPayload>(row));
    // Defense-in-depth: re-apply the SAME decision in JS (isOutboxRowClaimable)
    // rather than trusting the SQL WHERE clause alone — a terminal-classified
    // row must never reach the automatic/manual retry path even if the SQL
    // filter is ever wrong.
    return entries.filter((e) => isOutboxRowClaimable(e.syncState, e.errorKind));
  }

  async tryClaimOutboxEntry(localSubmissionId: string, claimToken: string, now: string): Promise<boolean> {
    return tryClaimOutboxEntryViaConnection(await getSchemaReadyConnection(), localSubmissionId, claimToken, now);
  }

  async recordOutboxSyncFailure(
    localSubmissionId: string,
    claimToken: string,
    error: string,
    errorKind: OutboxErrorKind,
    now: string,
  ): Promise<void> {
    return recordOutboxSyncFailureViaConnection(await getSchemaReadyConnection(), localSubmissionId, claimToken, error, errorKind, now);
  }

  async recordOutboxAuthorizationBlocked(localSubmissionId: string, claimToken: string, now: string): Promise<void> {
    return recordOutboxAuthorizationBlockedViaConnection(await getSchemaReadyConnection(), localSubmissionId, claimToken, now);
  }

  async recordOutboxServerConfirmed(
    localSubmissionId: string,
    claimToken: string,
    serverSubmissionId: string,
    now: string,
  ): Promise<void> {
    return recordOutboxServerConfirmedViaConnection(await getSchemaReadyConnection(), localSubmissionId, claimToken, serverSubmissionId, now);
  }

  async reconcileOrphanedClaims(currentSessionClaimToken: string, now: string): Promise<void> {
    return reconcileOrphanedClaimsViaConnection(await getSchemaReadyConnection(), currentSessionClaimToken, now);
  }
}

export function getNativeLocalSubmissionOutbox(): LocalSubmissionOutboxRepository {
  return new NativeLocalSubmissionOutbox();
}
