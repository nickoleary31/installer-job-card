import type { JobCardSubmissionPayload } from "../job-card-submission.ts";
import { LOCAL_PHOTO_URI_SCHEME } from "../local-photo.ts";

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

export type FinalizeAuthResult = { ok: true; repo: JobCardSubmissionsRepo } | { ok: false; status: number; error: string };

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

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Pure — every photoUploads entry must already carry a real remote reference; finalize must never be reached before photo upload completes. */
export function payloadHasUnresolvedLocalPhotos(payload: JobCardSubmissionPayload): boolean {
  return (payload.photoUploads || []).some(
    (p) => p.storagePath?.startsWith(LOCAL_PHOTO_URI_SCHEME) || p.publicUrl?.startsWith(LOCAL_PHOTO_URI_SCHEME),
  );
}

export async function handleFinalizeRequest(
  input: FinalizeRequestInput,
  access: FinalizeAccess,
  autoPublish: FinalizeAutoPublishTrigger | null,
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

  const auth = await access.authorize(input);
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } };
  }
  const { repo } = auth;
  const submissionId = payload.submissionId;

  const { error: upsertError } = await repo.upsertIgnoringDuplicates({
    submissionId,
    companyId: input.companyId,
    projectId: input.projectId,
    customer: payload.coreJobInfo?.customer?.trim() || "—",
    unitNumber: payload.coreJobInfo?.unitNumber?.trim() || "—",
    payload,
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
