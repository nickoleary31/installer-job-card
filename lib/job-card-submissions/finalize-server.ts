import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeProjectAccess } from "../project-access.ts";
import { createServiceRoleClient, requirePrivilegedServiceClient, type SupabaseServerEnv } from "../company-users/admin-api.ts";
import { createOrchestratorNotifier, createProjectAuthorizer, createSupabaseAutoPublishRepo } from "../zoho-fsm/orchestrator-client.ts";
import { handleAutoPublishRequest } from "../zoho-fsm/auto-publish.ts";
import type {
  CanonicalSubmissionRow,
  FinalizeAccess,
  FinalizeAutoPublishTrigger,
  JobCardSubmissionsRepo,
  JobCardSubmissionsRepoWriteInput,
} from "./finalize.ts";

type JobCardSubmissionRow = {
  submission_id: string;
  technician_submitted_at: string | null;
  submission_snapshot_hash: string | null;
  created_at: string;
};

/** Real Supabase-backed implementation — the actual ON CONFLICT (submission_id) DO NOTHING + read-back this route depends on. */
export function createSupabaseJobCardSubmissionsRepo(dataClient: SupabaseClient): JobCardSubmissionsRepo {
  return {
    async upsertIgnoringDuplicates(row: JobCardSubmissionsRepoWriteInput) {
      const { error } = await dataClient.from("job_card_submissions").upsert(
        {
          submission_id: row.submissionId,
          company_id: row.companyId,
          project_id: row.projectId,
          customer: row.customer,
          unit_number: row.unitNumber,
          payload: row.payload,
          technician_submitted_at: row.technicianSubmittedAt,
          submission_snapshot_hash: row.submissionSnapshotHash,
          created_at: row.technicianSubmittedAt,
        },
        { onConflict: "submission_id", ignoreDuplicates: true },
      );
      return { error: error?.message ?? null };
    },
    async getBySubmissionId(submissionId: string) {
      const { data, error } = await dataClient
        .from("job_card_submissions")
        .select("submission_id, technician_submitted_at, submission_snapshot_hash, created_at")
        .eq("submission_id", submissionId)
        .maybeSingle<JobCardSubmissionRow>();
      if (error || !data) return { row: null, error: error?.message ?? null };
      const row: CanonicalSubmissionRow = {
        submissionId: data.submission_id,
        technicianSubmittedAt: data.technician_submitted_at,
        submissionSnapshotHash: data.submission_snapshot_hash,
        createdAt: data.created_at,
      };
      return { row, error: null };
    },
  };
}

export function createFinalizeAccess(env: SupabaseServerEnv): FinalizeAccess {
  return {
    async authorize(args) {
      // Phase 2H security reconciliation — fail closed BEFORE any
      // authorization/DB work if no privileged key is configured; never
      // silently fall through to an anon/user-scoped client for this
      // privileged write path. See requirePrivilegedServiceClient's own doc.
      const privileged = requirePrivilegedServiceClient(env);
      if (!privileged.ok) return privileged;
      const auth = await authorizeProjectAccess({ env, ...args });
      if (!auth.ok) return auth;
      return { ok: true, repo: createSupabaseJobCardSubmissionsRepo(auth.dataClient) };
    },
  };
}

/**
 * Real orchestrator-notification wiring, reusing the SAME
 * handleAutoPublishRequest/createProjectAuthorizer/createSupabaseAutoPublishRepo/
 * createOrchestratorNotifier the existing auto-publish route uses — see that
 * route's own doc for why this must never throw into the finalize response,
 * and why duplicate notifications across finalize retries are safe (the
 * orchestrator is the idempotency authority there, not this route).
 */
export function createFinalizeAutoPublishTrigger(env: SupabaseServerEnv): FinalizeAutoPublishTrigger | null {
  const serviceClient = createServiceRoleClient(env);
  if (!serviceClient) return null;
  const authorizer = createProjectAuthorizer(env);
  const repo = createSupabaseAutoPublishRepo(serviceClient);
  const notifier = createOrchestratorNotifier();
  return {
    async trigger(args) {
      const result = await handleAutoPublishRequest(args, authorizer, repo, notifier);
      if ("scheduleAfterWork" in result) {
        after(result.scheduleAfterWork);
      }
    },
  };
}
