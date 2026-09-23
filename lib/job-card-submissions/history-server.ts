import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeProjectAccess } from "../project-access.ts";
import { requirePrivilegedServiceClient, type SupabaseServerEnv } from "../company-users/admin-api.ts";
import type { HistoryAccess, JobCardSubmissionsHistoryRepo, SubmissionHistoryDto } from "./history.ts";

type JobCardSubmissionHistoryRow = {
  submission_id: string;
  submission_snapshot_hash: string | null;
  customer: string | null;
  unit_number: string | null;
  technician_submitted_at: string | null;
  created_at: string;
};

export function createSupabaseJobCardSubmissionsHistoryRepo(dataClient: SupabaseClient): JobCardSubmissionsHistoryRepo {
  return {
    async listForProject(companyId: string, projectId: string) {
      const { data, error } = await dataClient
        .from("job_card_submissions")
        .select("submission_id, submission_snapshot_hash, customer, unit_number, technician_submitted_at, created_at")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) return { rows: [], error: error.message };

      const rows: SubmissionHistoryDto[] = ((data as JobCardSubmissionHistoryRow[] | null) || []).map((row) => ({
        submissionId: row.submission_id,
        submissionSnapshotHash: row.submission_snapshot_hash,
        customer: row.customer,
        unitNumber: row.unit_number,
        technicianSubmittedAt: row.technician_submitted_at,
        createdAt: row.created_at,
      }));
      return { rows, error: null };
    },
  };
}

export function createHistoryAccess(env: SupabaseServerEnv): HistoryAccess {
  return {
    async authorize(args) {
      // Phase 2H security reconciliation — fail closed before reading the
      // canonical job_card_submissions table (no client-facing RLS — see
      // this file's own module doc) if no privileged key is configured.
      const privileged = requirePrivilegedServiceClient(env);
      if (!privileged.ok) return privileged;
      const auth = await authorizeProjectAccess({ env, ...args });
      if (!auth.ok) return auth;
      return { ok: true, repo: createSupabaseJobCardSubmissionsHistoryRepo(auth.dataClient) };
    },
  };
}
