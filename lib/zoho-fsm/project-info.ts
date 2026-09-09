import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Narrow, browser-safe view of a project's Zoho FSM link. Deliberately excludes raw_snapshot
 * and every Zoho record id — those stay server-only. This is the only sanctioned way for
 * client code to learn anything from zoho_fsm_service_appointments, which has no client-facing
 * RLS policies.
 */
export type ZohoProjectInfoViewModel = {
  linked: boolean;
  workOrderNumber: string | null;
  serviceAppointmentNumber: string | null;
  summary: string | null;
};

export const UNLINKED_PROJECT_INFO: ZohoProjectInfoViewModel = {
  linked: false,
  workOrderNumber: null,
  serviceAppointmentNumber: null,
  summary: null,
};

type LinkRow = {
  zoho_work_order_number: string | null;
  zoho_service_appointment_number: string | null;
  raw_snapshot: unknown;
};

function readSummaryFromSnapshot(rawSnapshot: unknown): string | null {
  if (!rawSnapshot || typeof rawSnapshot !== "object") return null;
  const workOrder = (rawSnapshot as { workOrder?: unknown }).workOrder;
  if (!workOrder || typeof workOrder !== "object") return null;
  const summary = (workOrder as { Summary?: unknown }).Summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

export function buildProjectInfoViewModel(link: LinkRow | null): ZohoProjectInfoViewModel {
  if (!link) return UNLINKED_PROJECT_INFO;
  return {
    linked: true,
    workOrderNumber: link.zoho_work_order_number,
    serviceAppointmentNumber: link.zoho_service_appointment_number,
    summary: readSummaryFromSnapshot(link.raw_snapshot),
  };
}

export async function fetchZohoProjectInfo(
  serviceClient: SupabaseClient,
  projectId: string,
): Promise<ZohoProjectInfoViewModel> {
  const { data, error } = await serviceClient
    .from("zoho_fsm_service_appointments")
    .select("zoho_work_order_number, zoho_service_appointment_number, raw_snapshot")
    .eq("project_id", projectId)
    .maybeSingle<LinkRow>();
  if (error) throw error;
  return buildProjectInfoViewModel(data ?? null);
}
