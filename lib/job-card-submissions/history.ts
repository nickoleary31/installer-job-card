/**
 * Phase 2H's Submitted-history boundary, split into an injectable-dependency
 * core (this file) and a thin Next.js route wrapper
 * (app/api/job-card-submissions/route.ts) — same shape as finalize.ts.
 *
 * The native Submitted screen's server source: this project's canonical
 * job_card_submissions, WITHOUT the native client ever querying that table
 * directly (it has no client-facing RLS policies — see this table's own
 * migration comments — so a raw client-side select would be an unscoped
 * read of every company's submissions). This DTO is deliberately minimal —
 * NOT the raw stored `payload` column — and submissionSnapshotHash is
 * nullable: a submission the legacy web path created never set it, and the
 * Submitted screen's local+server merge (see
 * lib/local-submission-outbox.ts's resolveSubmittedDisplayStatus) must
 * treat a null hash as "cannot verify Synced," never as a false match.
 */

export type SubmissionHistoryDto = {
  submissionId: string;
  submissionSnapshotHash: string | null;
  customer: string | null;
  unitNumber: string | null;
  technicianSubmittedAt: string | null;
  createdAt: string;
};

export interface JobCardSubmissionsHistoryRepo {
  listForProject(companyId: string, projectId: string): Promise<{ rows: SubmissionHistoryDto[]; error: string | null }>;
}

export type HistoryAuthResult = { ok: true; repo: JobCardSubmissionsHistoryRepo } | { ok: false; status: number; error: string };

export interface HistoryAccess {
  authorize(args: { accessToken: string; companyId: string; projectId: string }): Promise<HistoryAuthResult>;
}

export type HistoryRequestInput = { accessToken: string; companyId: string; projectId: string };
export type HistoryResult = { status: number; body: Record<string, unknown> };

export async function handleHistoryRequest(input: HistoryRequestInput, access: HistoryAccess): Promise<HistoryResult> {
  const auth = await access.authorize(input);
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } };
  }

  const { rows, error } = await auth.repo.listForProject(input.companyId, input.projectId);
  if (error) {
    return { status: 500, body: { error } };
  }

  return { status: 200, body: { submissions: rows } };
}
