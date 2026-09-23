import { NextResponse } from "next/server";
import { extractBearerToken, getSupabaseServerEnv } from "@/lib/company-users/admin-api";
import type { JobCardSubmissionPayload } from "@/lib/job-card-submission";
import { handleFinalizeRequest } from "@/lib/job-card-submissions/finalize";
import { createFinalizeAccess, createFinalizeAutoPublishTrigger } from "@/lib/job-card-submissions/finalize-server";

export const maxDuration = 30;

/**
 * Phase 2H's ONE new canonical server finalization boundary — every prior
 * write to job_card_submissions (the web app's own persistSubmittedJobCard
 * in components/NewSubmissionForm.tsx) does a non-atomic
 * select-then-insert-or-update with a real race window on the UNIQUE
 * submission_id constraint; this route exists because the native sync
 * engine (lib/submission-sync.ts) can legitimately retry the SAME
 * technician-submit event multiple times (crash, timeout, unknown outcome —
 * see that file's own partial-failure handling) and MUST NOT ever create a
 * duplicate or silently overwrite a different submission's content.
 *
 * RACE-SAFE IDEMPOTENCY: `INSERT ... ON CONFLICT (submission_id) DO
 * NOTHING`, then the row is read back by submission_id and reconciled by
 * submission_snapshot_hash:
 *   - stored hash === requested hash: this IS the same technician-submit
 *     event (whether we just inserted it, or a concurrent/earlier retry
 *     already did) -> return its confirmation. Simultaneous identical
 *     retries converge on the same canonical row.
 *   - stored hash !== requested hash (including a NULL/legacy stored hash,
 *     e.g. a row the web app's own insert path created) -> 409 Conflict.
 *     Never a blind UPDATE/overwrite — see job_card_submissions.
 *     submission_snapshot_hash's own migration doc.
 *
 * This route is a thin wrapper — see lib/job-card-submissions/finalize.ts
 * for the actual, unit-tested request-handling logic
 * (finalize.test.ts) and finalize-server.ts for the real Supabase wiring.
 */

type FinalizeRequestBody = {
  companyId?: unknown;
  projectId?: unknown;
  technicianSubmittedAt?: unknown;
  submissionSnapshotHash?: unknown;
  payload?: unknown;
};

export async function POST(req: Request) {
  let body: FinalizeRequestBody;
  try {
    body = (await req.json()) as FinalizeRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const env = getSupabaseServerEnv();
  const result = await handleFinalizeRequest(
    {
      accessToken: extractBearerToken(req),
      companyId: typeof body.companyId === "string" ? body.companyId.trim() : "",
      projectId: typeof body.projectId === "string" ? body.projectId.trim() : "",
      technicianSubmittedAt: typeof body.technicianSubmittedAt === "string" ? body.technicianSubmittedAt.trim() : "",
      submissionSnapshotHash: typeof body.submissionSnapshotHash === "string" ? body.submissionSnapshotHash.trim() : "",
      payload: body.payload as JobCardSubmissionPayload | undefined,
    },
    createFinalizeAccess(env),
    createFinalizeAutoPublishTrigger(env),
  );
  return NextResponse.json(result.body, { status: result.status });
}
