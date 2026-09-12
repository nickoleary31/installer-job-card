import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Narrow, browser-safe SA Target/Finalized Asset Count for one Zoho-linked project — display
 * evidence only for the admin Project card's "Completed submissions" count (see
 * lib/zoho-fsm/project-progress-display.ts). zoho_fsm_service_appointments has no client-facing
 * RLS policies, so this server-side lookup (service-role client) is the only way client code can
 * learn these values — same narrow-exposure pattern as lib/zoho-fsm/project-info.ts, but
 * company-scoped/bulk rather than per-project, since the project list needs every project's
 * value in one request (mirrors how the project list already bulk-fetches
 * job_card_submissions for the whole company in one query).
 */
export type ZohoProjectProgress = {
  saTargetAssetCount: number | null;
  saFinalizedAssetCount: number | null;
};

type ProgressDbRow = {
  project_id: string;
  sa_target_asset_count: number | null;
  sa_finalized_asset_count: number | null;
};

export function buildProjectProgressByProjectId(rows: ProgressDbRow[]): Record<string, ZohoProjectProgress> {
  const byProjectId: Record<string, ZohoProjectProgress> = {};
  for (const row of rows) {
    if (!row.project_id) continue;
    byProjectId[row.project_id] = {
      saTargetAssetCount: row.sa_target_asset_count,
      saFinalizedAssetCount: row.sa_finalized_asset_count,
    };
  }
  return byProjectId;
}

export async function fetchZohoProjectProgressForCompany(
  serviceClient: SupabaseClient,
  companyId: string,
): Promise<Record<string, ZohoProjectProgress>> {
  const { data, error } = await serviceClient
    .from("zoho_fsm_service_appointments")
    .select("project_id, sa_target_asset_count, sa_finalized_asset_count")
    .eq("company_id", companyId);
  if (error) throw error;
  return buildProjectProgressByProjectId((data as ProgressDbRow[]) || []);
}
