import type { JobCardSubmissionPayload } from "../job-card-submission.ts";
import { LOCAL_PHOTO_URI_SCHEME } from "../local-photo.ts";
import { isSafePathSegment, normalizePayloadStorageUrls, validatePayloadStorageReferences } from "../storage-references.ts";

/**
 * Phase 2H's race-safe server finalization boundary, split into an
 * injectable-dependency core (this file) and a thin Next.js route wrapper
 * (app/api/job-card-submissions/finalize/route.ts) — same rationale and
 * shape as lib/zoho-fsm/auto-publish.ts's handleAutoPublishRequest: the
 * security-critical authorization gate and the idempotency-critical
 * upsert/reconcile logic need to be unit-testable without a live Supabase
 * project or a constructed Next.js Request.
 *
 * See the route file's own doc for the full race-safety rationale
 * (INSERT ... ON CONFLICT DO NOTHING, then read-back-and-reconcile-by-hash).
 *
 * Checkpoint 2 — what the server now refuses to take on trust, in order:
 *  1. identity: only the verified token (access.authorize) — never any
 *     user id in the body;
 *  2. scope: payload.companyId/projectId, when present, must equal the ids
 *     the requester was authorized for (409 — an identity conflict, never
 *     retryable);
 *  3. storage references: every photo / product-file path must lie inside
 *     the authorized company/project/submission — and, for photos, under
 *     the requester's own uploader namespace (see
 *     lib/storage-references.ts); derived URLs are rebuilt server-side;
 *  4. timestamps: technicianSubmittedAt must be a real ISO timestamp within
 *     a plausible window before it can become the row's own timestamp.
 * Everything else about the write is unchanged: insert-if-absent, then
 * reconcile by snapshot hash, so a legitimate retry converges and a
 * conflicting one is a 409.
 */

export type JobCardSubmissionsRepoWriteInput = {
  submissionId: string;
  companyId: string;
  projectId: string;
  customer: string;
  unitNumber: string;
  payload: JobCardSubmissionPayload;
  technicianSubmittedAt: string;
  submissionSnapshotHash: string;
};

export type CanonicalSubmissionRow = {
  submissionId: string;
  technicianSubmittedAt: string | null;
  submissionSnapshotHash: string | null;
  createdAt: string;
};

/**
 * Abstracts the two DB operations this route needs, never a raw Supabase
 * client shape — keeps fakes in tests trivial (see finalize.test.ts) and
 * keeps the ON-CONFLICT-DO-NOTHING contract explicit in the method name
 * itself rather than buried in call-site options.
 */
export interface JobCardSubmissionsRepo {
  /** Real INSERT ... ON CONFLICT (submission_id) DO NOTHING — must never overwrite an existing row. */
  upsertIgnoringDuplicates(row: JobCardSubmissionsRepoWriteInput): Promise<{ error: string | null }>;
  getBySubmissionId(submissionId: string): Promise<{ row: CanonicalSubmissionRow | null; error: string | null }>;
}

export type FinalizeAuthResult =
  | {
      ok: true;
      repo: JobCardSubmissionsRepo;
      /** The server-verified requester — the only identity this route ever acts as. */
      requesterUserId: string;
      /** The Supabase project URL, for re-deriving public object URLs server-side. */
      supabaseUrl: string;
    }
  | { ok: false; status: number; error: string };

/**
 * Authorization and repo-provisioning are ONE dependency, not two: the
 * repo must be built from the SAME dataClient authorizeProjectAccess
 * already resolved (which may be a service-role client or a user-scoped
 * fallback — see lib/project-access.ts) so the write happens under exactly
 * the access level that was actually granted.
 */
export interface FinalizeAccess {
  authorize(args: { accessToken: string; companyId: string; projectId: string }): Promise<FinalizeAuthResult>;
}

/** Best-effort, duplicate-safe — must never throw into the caller; a failure here must never turn a successful finalize into an error response. */
export interface FinalizeAutoPublishTrigger {
  trigger(args: { accessToken: string; companyId: string; projectId: string }): Promise<void>;
}

export type FinalizeRequestInput = {
  accessToken: string;
  companyId: string;
  projectId: string;
  technicianSubmittedAt: string;
  submissionSnapshotHash: string;
  payload: JobCardSubmissionPayload | null | undefined;
};

export type FinalizeResult = { status: number; body: Record<string, unknown> };

export type FinalizeOptions = {
  /** Injectable clock for the timestamp window — see validateTechnicianSubmittedAt. */
  now?: () => number;
};

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Pure — every photoUploads entry must already carry a real remote reference; finalize must never be reached before photo upload completes. */
export function payloadHasUnresolvedLocalPhotos(payload: JobCardSubmissionPayload): boolean {
  return (payload.photoUploads || []).some(
    (p) => p.storagePath?.startsWith(LOCAL_PHOTO_URI_SCHEME) || p.publicUrl?.startsWith(LOCAL_PHOTO_URI_SCHEME),
  );
}

const SNAPSHOT_HASH = /^[0-9a-f]{64}$/;

/** computeSubmissionSnapshotHash (lib/local-submission-outbox.ts) always produces a lowercase sha256 hex digest; anything else is not a hash this route can reconcile by. */
export function isValidSnapshotHash(value: string): boolean {
  return SNAPSHOT_HASH.test(value);
}

export const TECHNICIAN_SUBMITTED_AT_MAX_PAST_MS = 180 * 24 * 60 * 60 * 1000;
export const TECHNICIAN_SUBMITTED_AT_MAX_FUTURE_MS = 15 * 60 * 1000;

/**
 * Pure — the client's technician-submit time becomes this row's own
 * technician_submitted_at AND created_at (the latter is what the Zoho
 * evidence trail reads), so an unparseable, far-past or future value must
 * never be stored. The window is deliberately generous in the past: a
 * device can legitimately hold a submission for weeks before it is back
 * online and re-authenticated.
 */
export function validateTechnicianSubmittedAt(value: string, nowMs: number): { ok: true } | { ok: false; error: string } {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return { ok: false, error: "technicianSubmittedAt must be an ISO-8601 timestamp." };
  }
  if (parsed > nowMs + TECHNICIAN_SUBMITTED_AT_MAX_FUTURE_MS) {
    return { ok: false, error: "technicianSubmittedAt is in the future." };
  }
  if (parsed < nowMs - TECHNICIAN_SUBMITTED_AT_MAX_PAST_MS) {
    return { ok: false, error: "technicianSubmittedAt is too far in the past to be accepted." };
  }
  return { ok: true };
}

export async function handleFinalizeRequest(
  input: FinalizeRequestInput,
  access: FinalizeAccess,
  autoPublish: FinalizeAutoPublishTrigger | null,
  options: FinalizeOptions = {},
): Promise<FinalizeResult> {
  const payload = input.payload;
  if (!payload || !isNonEmptyString(payload.submissionId)) {
    return { status: 400, body: { error: "A submission payload with a submissionId is required." } };
  }
  if (!input.technicianSubmittedAt || !input.submissionSnapshotHash) {
    return { status: 400, body: { error: "technicianSubmittedAt and submissionSnapshotHash are required." } };
  }
  if (payloadHasUnresolvedLocalPhotos(payload)) {
    return {
      status: 400,
      body: { error: "Every photo must be uploaded to remote storage before finalizing this submission." },
    };
  }
  const submissionId = payload.submissionId.trim();
  if (!isSafePathSegment(submissionId)) {
    return { status: 400, body: { error: "submissionId must be a simple identifier." } };
  }
  if (!isValidSnapshotHash(input.submissionSnapshotHash)) {
    return { status: 400, body: { error: "submissionSnapshotHash must be a sha256 hex digest." } };
  }
  const timestamp = validateTechnicianSubmittedAt(input.technicianSubmittedAt, (options.now ?? Date.now)());
  if (!timestamp.ok) {
    return { status: 400, body: { error: timestamp.error } };
  }

  const auth = await access.authorize(input);
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } };
  }
  const { repo, requesterUserId, supabaseUrl } = auth;

  // The ids the requester was authorized for are the ONLY scope this write
  // may land in. A payload naming a different company/project is an
  // identity conflict (409, terminal), never something to quietly correct.
  if (
    (isNonEmptyString(payload.companyId) && payload.companyId.trim() !== input.companyId) ||
    (isNonEmptyString(payload.projectId) && payload.projectId.trim() !== input.projectId)
  ) {
    return { status: 409, body: { error: "The submission payload names a different company or project than the one authorized." } };
  }

  const references = validatePayloadStorageReferences(payload, {
    companyId: input.companyId,
    projectId: input.projectId,
    submissionId,
    uploaderUserId: requesterUserId,
    allowLegacyWebPhotoPaths: false,
  });
  if (!references.ok) {
    return { status: 400, body: { error: references.error } };
  }
  const canonicalPayload = normalizePayloadStorageUrls({ ...payload, submissionId }, supabaseUrl);

  const { error: upsertError } = await repo.upsertIgnoringDuplicates({
    submissionId,
    companyId: input.companyId,
    projectId: input.projectId,
    customer: payload.coreJobInfo?.customer?.trim() || "—",
    unitNumber: payload.coreJobInfo?.unitNumber?.trim() || "—",
    payload: canonicalPayload,
    technicianSubmittedAt: input.technicianSubmittedAt,
    submissionSnapshotHash: input.submissionSnapshotHash,
  });
  if (upsertError) {
    return { status: 500, body: { error: upsertError } };
  }

  const { row, error: readBackError } = await repo.getBySubmissionId(submissionId);
  if (readBackError || !row) {
    return { status: 500, body: { error: readBackError || "Submission was written but could not be read back." } };
  }

  if (row.submissionSnapshotHash !== input.submissionSnapshotHash) {
    return {
      status: 409,
      body: {
        error:
          "A different submission already exists with this submission id (snapshot hash mismatch). This is not a safe idempotent retry.",
      },
    };
  }

  if (autoPublish) {
    try {
      await autoPublish.trigger(input);
    } catch (autoPublishError) {
      console.warn("[job-card-submissions/finalize] auto-publish notification failed", autoPublishError);
    }
  }

  return {
    status: 200,
    body: {
      submissionId: row.submissionId,
      technicianSubmittedAt: row.technicianSubmittedAt,
      submissionSnapshotHash: row.submissionSnapshotHash,
      serverConfirmedAt: row.createdAt,
    },
  };
}
