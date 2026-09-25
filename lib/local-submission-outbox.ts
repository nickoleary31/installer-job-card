import { getNativeLocalSubmissionOutbox, isOutboxRowClaimable } from "./native/local-submission-outbox.ts";
import { isNativeRuntime } from "./native/runtime.ts";
import { canonicalJsonStringify } from "./canonical-hash.ts";

/**
 * Phase 2H — the durable outbox: one row per LocalSubmission the technician
 * has explicitly submitted, created ATOMICALLY (in the same native SQLite
 * transaction) with local_submissions.technician_submitted_at — see
 * lib/native/local-submission-outbox.ts's technicianSubmitAtomically for the
 * real transaction, and this file's buildFrozenSnapshotPhotos/
 * computeSubmissionSnapshotHash for how the frozen contents are produced.
 *
 * DESIGN — frozen snapshot, not a live re-read: everything sync/retry logic
 * needs (the payload, the photo set, the definition version, the
 * technician-submit timestamp) is captured once, at submit time, into this
 * row's own snapshot_* columns. The sync engine (lib/submission-sync.ts)
 * NEVER re-reads local_submissions/local_photos for their current values —
 * only this row — so a technician continuing to edit a DIFFERENT, newer
 * local submission (or, in principle, an app upgrade changing draft shapes)
 * can never change what an in-flight retry sends to the server.
 *
 * DESIGN — the hash is a LOGICAL IDENTITY, not a hash of the raw payload:
 * the frozen payload is captured BEFORE photo upload, so its photoUploads
 * entries still carry `local-photo://<id>` sentinels (see
 * lib/local-photo.ts's LOCAL_PHOTO_URI_SCHEME doc). The eventual canonical
 * server payload carries real remote storagePath/publicUrl values instead.
 * Hashing the raw payload JSON at both ends would therefore never match.
 * computeSubmissionSnapshotHash() instead hashes a dedicated identity object
 * that represents each photo by its CONTENT (a sha256 of its bytes,
 * computed once at freeze time — see buildFrozenSnapshotPhotos) rather than
 * by where it currently lives — a value that is identical whether the photo
 * is still local-only or has since been uploaded. See
 * app/api/job-card-submissions/finalize/route.ts for the server side of
 * this same reconciliation contract.
 */

export type OutboxSyncState =
  | "pending"
  | "syncing"
  | "failed"
  | "authorization-blocked"
  | "server-confirmed";

/**
 * Phase 2H security reconciliation — classifies WHY a 'failed' row failed,
 * distinct from `syncState` itself (which stays "failed" either way — see
 * this file's own "do not proliferate unnecessary UI states" design note).
 * `null` for every row that has never failed (pending/syncing/server-
 * confirmed) and for any row written before this classification existed.
 *
 * 'retryable': a network/timeout/5xx/transient failure — the SAME frozen
 * snapshot may well succeed on the next attempt with no changes needed.
 * Eligible for automatic (ForegroundSyncMount) and manual (Retry button)
 * re-claim — see listClaimableOutboxEntries.
 *
 * 'terminal': a structural failure retrying the SAME snapshot can never fix
 * — project/company mismatch, a 409 submission-snapshot-hash conflict,
 * 4xx payload validation. Excluded from listClaimableOutboxEntries
 * entirely, so neither an automatic sync pass nor a manual Retry tap will
 * ever re-attempt it; see lib/submission-sync.ts's
 * classifySyncResponseStatus for the exact status-code mapping this is
 * derived from.
 *
 * Deliberately NOT a third syncState value — an authorization failure
 * (expired/invalid token, revoked project access) already has its own
 * distinct 'authorization-blocked' syncState, since that one MAY resolve
 * itself once the technician re-authenticates, unlike a terminal failure.
 */
export type OutboxErrorKind = "retryable" | "terminal";

/**
 * One photo, frozen at technician-submit time. `contentHash` is a sha256
 * hex digest of the photo's raw bytes (via WebCrypto, computed once at
 * freeze time) — re-verified (re-read + re-hash + compare) by the sync
 * engine before every upload attempt, so a file that changed on disk after
 * freezing blocks that item's sync truthfully instead of silently uploading
 * different bytes than what was reviewed/frozen. `filesystemPath` lets the
 * sync engine re-read the bytes without a second local_photos query.
 */
export type FrozenSnapshotPhoto = {
  localPhotoId: string;
  fieldName: string;
  group: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  filesystemPath: string;
};

export type LocalSubmissionOutboxEntry<TPayload = unknown> = {
  localSubmissionId: string;
  userId: string;
  companyId: string;
  projectId: string;
  syncState: OutboxSyncState;
  claimToken: string | null;
  claimedAt: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** See OutboxErrorKind's own doc. Meaningful only when syncState === "failed"; null otherwise. */
  errorKind: OutboxErrorKind | null;
  serverSubmissionId: string | null;
  snapshotPayload: TPayload;
  snapshotPhotos: FrozenSnapshotPhoto[];
  snapshotDefinitionSchemaVersion: number | null;
  snapshotTechnicianSubmittedAt: string;
  submissionSnapshotHash: string;
  createdAt: string;
  updatedAt: string;
};

export type TechnicianSubmitInput<TPayload = unknown, TLocalPayload = unknown> = {
  localSubmissionId: string;
  userId: string;
  companyId: string;
  projectId: string;
  /**
   * Phase 2H fix — the same fields persistLocalSubmissionNow()/
   * saveLocalSubmission() would write for this local_submissions row,
   * carried through so buildTechnicianSubmitUpsertStatement (see
   * lib/native/local-submission.ts) can create OR bring-up-to-date that row
   * as part of the SAME atomic transaction as the outbox insert below —
   * so a technician-submit can never leave "some submit state exists, some
   * doesn't", even when no prior autosave ever ran for this exact
   * submission (e.g. a brand-new online-native card — see this file's
   * module doc history on why that could previously happen).
   */
  formId: string | null;
  submissionType: string | null;
  selectedSections: string[];
  /** The local_submissions.payload shape (draft-shaped, same as saveLocalSubmission's input) — distinct from snapshotPayload below, which is the frozen submission-shaped payload the outbox/sync engine uses. */
  localSubmissionPayload: TLocalPayload;
  snapshotPayload: TPayload;
  snapshotPhotos: FrozenSnapshotPhoto[];
  snapshotDefinitionSchemaVersion: number | null;
  submissionSnapshotHash: string;
  /**
   * Caller-supplied (via buildSnapshotIdentity/computeSubmissionSnapshotHash
   * — see this file's module doc), NOT generated inside the atomic
   * transaction: submissionSnapshotHash's own formula includes this exact
   * value, so it must be fixed BEFORE the transaction runs, and the
   * transaction must persist this SAME value rather than reading a fresh
   * clock — otherwise the stored technician_submitted_at could never
   * exactly match what was hashed.
   */
  technicianSubmittedAt: string;
};

export interface LocalSubmissionOutboxRepository {
  /**
   * ONE atomic native transaction: sets local_submissions.technician_submitted_at
   * for input.localSubmissionId AND inserts the new local_submission_outbox
   * row — see lib/native/local-submission-outbox.ts for the real
   * executeSet()-based transaction and why it is genuinely atomic. Resolves
   * with the technicianSubmittedAt actually committed (same value recorded
   * in both places).
   */
  technicianSubmitAtomically<TPayload, TLocalPayload = unknown>(
    input: TechnicianSubmitInput<TPayload, TLocalPayload>,
  ): Promise<{ technicianSubmittedAt: string }>;
  loadOutboxEntry<TPayload>(localSubmissionId: string): Promise<LocalSubmissionOutboxEntry<TPayload> | null>;
  /** Every outbox row for this user regardless of state — used by the Submitted screen's local+server merge. */
  listAllOutboxEntriesForUser<TPayload>(userId: string): Promise<LocalSubmissionOutboxEntry<TPayload>[]>;
  /** Rows in pending/failed/authorization-blocked for this user, oldest-created first — sync candidates. */
  listClaimableOutboxEntries<TPayload>(userId: string): Promise<LocalSubmissionOutboxEntry<TPayload>[]>;
  /**
   * The real single-worker claim: an atomic compare-and-set UPDATE
   * (sync_state IN ('pending','failed','authorization-blocked') -> 'syncing',
   * claim_token = claimToken) — returns true iff this call's UPDATE actually
   * changed exactly one row (result.changes?.changes === 1), false if
   * another caller already claimed it first. See
   * lib/native/local-submission-outbox.ts for the exact verified primitive.
   */
  tryClaimOutboxEntry(localSubmissionId: string, claimToken: string, now: string): Promise<boolean>;
  /** errorKind: see OutboxErrorKind's own doc — determines automatic/manual retry eligibility, never the syncState value itself (always "failed"). */
  recordOutboxSyncFailure(
    localSubmissionId: string,
    claimToken: string,
    error: string,
    errorKind: OutboxErrorKind,
    now: string,
  ): Promise<void>;
  recordOutboxAuthorizationBlocked(localSubmissionId: string, claimToken: string, now: string): Promise<void>;
  recordOutboxServerConfirmed(
    localSubmissionId: string,
    claimToken: string,
    serverSubmissionId: string,
    now: string,
  ): Promise<void>;
  /**
   * Crash-orphan recovery: every row still `sync_state = 'syncing'` whose
   * claim_token does not match `currentSessionClaimToken` (always true for
   * every pre-existing row, since that token is freshly generated this
   * session) is moved to 'failed'. Called ONLY from
   * lib/submission-sync.ts's ensureSyncEngineInitialized() singleton — never
   * from a repository connection-open path — see that function's own doc
   * for why (a legitimate in-flight foreground sync from another code path
   * must never be reinterpreted as orphaned).
   */
  reconcileOrphanedClaims(currentSessionClaimToken: string, now: string): Promise<void>;
}

const WEB_NOT_IMPLEMENTED_MESSAGE =
  "Local submission outbox is not implemented for the web runtime. The web app submits directly online and has no local outbox concept.";

class WebLocalSubmissionOutboxNotImplemented implements LocalSubmissionOutboxRepository {
  technicianSubmitAtomically<TPayload, TLocalPayload = unknown>(): Promise<{ technicianSubmittedAt: string }> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  loadOutboxEntry<TPayload>(): Promise<LocalSubmissionOutboxEntry<TPayload> | null> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  listAllOutboxEntriesForUser<TPayload>(): Promise<LocalSubmissionOutboxEntry<TPayload>[]> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  listClaimableOutboxEntries<TPayload>(): Promise<LocalSubmissionOutboxEntry<TPayload>[]> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  tryClaimOutboxEntry(): Promise<boolean> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  recordOutboxSyncFailure(): Promise<void> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  recordOutboxAuthorizationBlocked(): Promise<void> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  recordOutboxServerConfirmed(): Promise<void> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  reconcileOrphanedClaims(): Promise<void> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
}

const webLocalSubmissionOutboxSingleton = new WebLocalSubmissionOutboxNotImplemented();

export function getLocalSubmissionOutboxRepository(): LocalSubmissionOutboxRepository {
  return isNativeRuntime() ? getNativeLocalSubmissionOutbox() : webLocalSubmissionOutboxSingleton;
}

/**
 * WebCrypto SHA-256 hex digest — the client-safe equivalent of
 * lib/canonical-hash.ts's computeContentHash, which uses node:crypto and
 * cannot run in the WebView. Exported so both photo-content hashing and
 * computeSubmissionSnapshotHash below share one implementation.
 */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Pure (given the hashes already computed) — builds the frozen photo array
 * from a submission's photoUploads-shaped source list, resolving each
 * `local-photo://<id>` sentinel against the loaded LocalPhoto rows for this
 * submission. Sorted by localPhotoId so the array element order is
 * deterministic for hashing (canonicalJsonStringify only sorts object KEYS,
 * never array order — see lib/canonical-hash.ts's own doc). A photo entry
 * that isn't a local-photo:// sentinel (already remote — e.g. this
 * submission was edited across an earlier online segment) is skipped: its
 * upload/verification is not this outbox's concern, it was already
 * server-durable before the technician ever pressed Submit.
 */
export function buildFrozenSnapshotPhotos(
  localPhotoUploads: ReadonlyArray<{
    localPhotoId: string;
    fieldName: string;
    group: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    filesystemPath: string;
    contentHash: string;
  }>,
): FrozenSnapshotPhoto[] {
  return [...localPhotoUploads]
    .sort((a, b) => a.localPhotoId.localeCompare(b.localPhotoId))
    .map((p) => ({
      localPhotoId: p.localPhotoId,
      fieldName: p.fieldName,
      group: p.group,
      originalFilename: p.originalFilename,
      mimeType: p.mimeType,
      sizeBytes: p.sizeBytes,
      contentHash: p.contentHash,
      filesystemPath: p.filesystemPath,
    }));
}

/**
 * Pure — the logical-identity object hashed for submissionSnapshotHash.
 * Deliberately built from EXPLICIT fields, not `{...payload}`: it must
 * never accidentally include payload.photoUploads (transport-dependent —
 * see this file's own module doc) or any other future field that could
 * vary between local-freeze-time and post-sync-finalize-time without the
 * technician's actual work changing.
 */
export function buildSnapshotIdentity(input: {
  localSubmissionId: string;
  companyId: string;
  projectId: string;
  definitionSchemaVersion: number | null;
  technicianSubmittedAt: string;
  /** The submission payload with photoUploads/productFiles removed — everything else the technician entered. */
  payloadWithoutTransportFields: unknown;
  photos: FrozenSnapshotPhoto[];
}): unknown {
  return {
    localSubmissionId: input.localSubmissionId,
    companyId: input.companyId,
    projectId: input.projectId,
    definitionSchemaVersion: input.definitionSchemaVersion,
    technicianSubmittedAt: input.technicianSubmittedAt,
    payload: input.payloadWithoutTransportFields,
    photos: input.photos.map((p) => ({
      localPhotoId: p.localPhotoId,
      fieldName: p.fieldName,
      group: p.group,
      contentHash: p.contentHash,
    })),
  };
}

/** WebCrypto SHA-256 hex digest of buildSnapshotIdentity()'s canonical JSON — the value stored as submissionSnapshotHash. */
export async function computeSubmissionSnapshotHash(identity: unknown): Promise<string> {
  const json = canonicalJsonStringify(identity);
  const encoded = new TextEncoder().encode(json);
  return sha256Hex(encoded);
}

/**
 * Pure — classifies a submission for the Submitted screen given its local
 * outbox entry (if any) and the matching server history row (if any),
 * keyed by shared stable identity (localSubmissionId === submission_id —
 * see this file's module doc and lib/local-submission.ts's own identity
 * doc). See app/api/job-card-submissions/route.ts for the server DTO this
 * reads.
 *
 * DURABLE LOCAL CONFIRMATION IS NOT DOWNGRADED BY MISSING SERVER DATA.
 * `syncState === "server-confirmed"` means THIS device already recorded a
 * genuinely successful finalize call for this exact frozen snapshot (see
 * lib/submission-sync.ts's recordOutboxServerConfirmed, only ever reached
 * after the finalize endpoint itself returned success). That is durable
 * knowledge, independent of whether a server response is available RIGHT
 * NOW: offline, a failed/omitted Submitted-history GET, or a server row
 * this device simply hasn't re-fetched yet are all "no live server result"
 * — absence of a fresh response is not evidence the submission became
 * unsynced, and must never downgrade a locally-confirmed row to "Local
 * only" (see this file's own resolveSubmittedDisplayStatus.test cases for
 * the exact offline/force-stop/refresh-failure scenarios this protects).
 * A server response that ACTIVELY reports a DIFFERENT hash for the same
 * submission_id is the only thing that can turn this into a genuine,
 * truthful conflict — never silently "Synced" in that case either.
 *
 * Checkpoint 1 — "Needs attention" is the terminal state, distinct from the
 * retryable "Sync failed": a failed row classified 'terminal' (and a
 * server-confirmed row whose live server hash disagrees) will never be
 * re-attempted by the sync engine, so it must not look retryable either. See
 * resolveSubmittedRowAction for which rows get an action at all.
 */
export type SubmittedDisplayStatus =
  | "Local only"
  | "Syncing"
  | "Sync failed"
  | "Needs attention"
  | "Authorization required"
  | "Synced";

export function resolveSubmittedDisplayStatus(
  outboxEntry: Pick<LocalSubmissionOutboxEntry, "syncState" | "submissionSnapshotHash" | "errorKind"> | null,
  serverSnapshotHash: string | null | undefined,
): SubmittedDisplayStatus {
  if (!outboxEntry) {
    // A canonical server submission with no local outbox row on this device
    // (never submitted from here, or the local row was since cleared) —
    // its mere existence on the server IS the synced state.
    return "Synced";
  }
  if (outboxEntry.syncState === "server-confirmed") {
    if (!serverSnapshotHash) {
      // No live server evidence to compare against (offline, history fetch
      // failed, or this row wasn't in the response) — trust the durable
      // local confirmation rather than treating silence as "unsynced".
      return "Synced";
    }
    return serverSnapshotHash === outboxEntry.submissionSnapshotHash ? "Synced" : "Needs attention";
  }
  switch (outboxEntry.syncState) {
    case "syncing":
      return "Syncing";
    case "failed":
      return outboxEntry.errorKind === "terminal" ? "Needs attention" : "Sync failed";
    case "authorization-blocked":
      return "Authorization required";
    case "pending":
    default:
      return "Local only";
  }
}

export type SubmittedRowAction = "Retry" | "Recheck Access" | "Sync now";

/**
 * Checkpoint 1 — the Submitted screen's per-row action, derived from the SAME
 * isOutboxRowClaimable gate the sync engine uses to decide what it will claim.
 * An action is offered only for a row the engine would actually pick up, so a
 * button can never be decorative: terminal failures, rows mid-sync, confirmed
 * rows and server-only rows get none.
 */
export function resolveSubmittedRowAction(
  outboxEntry: Pick<LocalSubmissionOutboxEntry, "syncState" | "errorKind"> | null,
): SubmittedRowAction | null {
  if (!outboxEntry) return null;
  if (!isOutboxRowClaimable(outboxEntry.syncState, outboxEntry.errorKind)) return null;
  switch (outboxEntry.syncState) {
    case "failed":
      return "Retry";
    case "authorization-blocked":
      return "Recheck Access";
    case "pending":
      return "Sync now";
    default:
      return null;
  }
}
