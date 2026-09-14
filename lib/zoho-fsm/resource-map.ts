// Resource-mapping foundation only: builds the catalog of Zoho Service Resources observed across
// stored Service Appointment snapshots, and diffs it against confirmed mappings. Does NOT perform
// any auto-assignment — that is explicitly out of scope for this feature (see
// zoho_resource_map migration comment). Kept separate from field-mapping.ts (which owns raw
// Zoho-record parsing) the same way project-progress.ts sits above it: this file owns the
// multi-row aggregation + Supabase fetch layer, testable independent of both Zoho and Supabase.

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractServiceResourceRefs, type ZohoServiceAppointmentRecord, type ZohoServiceResourceRef } from "./field-mapping.ts";

export type ResourceSeenOn = {
  zohoServiceAppointmentId: string;
  zohoServiceAppointmentNumber: string | null;
  projectId: string | null;
  projectName: string | null;
  companyId: string;
  companyName: string | null;
};

export type ObservedZohoResource = ZohoServiceResourceRef & {
  seenOn: ResourceSeenOn[];
};

export type SaCatalogRow = {
  zoho_service_appointment_id: string;
  zoho_service_appointment_number: string | null;
  project_id: string | null;
  company_id: string;
  raw_snapshot: unknown;
  projects: { project_name: string | null; customer_name: string | null } | Array<{
    project_name: string | null;
    customer_name: string | null;
  }> | null;
  companies: { name: string | null } | Array<{ name: string | null }> | null;
};

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * Defensive read of raw_snapshot (an untyped jsonb column — see lib/zoho-fsm/project-info.ts's
 * same `raw_snapshot: unknown` convention) down to the serviceAppointment object mapZohoRecordsTo
 * InboundInput stored verbatim. Never throws on malformed/legacy data — returns [] instead.
 */
export function extractServiceResourcesFromRawSnapshot(rawSnapshot: unknown): ZohoServiceResourceRef[] {
  if (!rawSnapshot || typeof rawSnapshot !== "object") return [];
  const sa = (rawSnapshot as Record<string, unknown>).serviceAppointment;
  if (!sa || typeof sa !== "object") return [];
  return extractServiceResourceRefs(sa as ZohoServiceAppointmentRecord);
}

/**
 * Aggregates every Zoho Service Resource seen across the given Service Appointment rows into one
 * catalog keyed by zohoResourceId, each with every SA/project/company it was observed on. Rows
 * should be ordered most-recently-updated-first by the caller so the first occurrence processed
 * for a given resource id — used for its display name/type — is the freshest one.
 */
export function buildObservedResourceCatalog(rows: SaCatalogRow[]): Map<string, ObservedZohoResource> {
  const catalog = new Map<string, ObservedZohoResource>();
  for (const row of rows) {
    const refs = extractServiceResourcesFromRawSnapshot(row.raw_snapshot);
    if (refs.length === 0) continue;
    const project = firstOrSelf(row.projects);
    const company = firstOrSelf(row.companies);
    const seenOnEntry: ResourceSeenOn = {
      zohoServiceAppointmentId: row.zoho_service_appointment_id,
      zohoServiceAppointmentNumber: row.zoho_service_appointment_number,
      projectId: row.project_id,
      projectName: project?.project_name?.trim() || project?.customer_name?.trim() || null,
      companyId: row.company_id,
      companyName: company?.name?.trim() || null,
    };
    for (const ref of refs) {
      const existing = catalog.get(ref.zohoResourceId);
      if (!existing) {
        catalog.set(ref.zohoResourceId, { ...ref, seenOn: [seenOnEntry] });
      } else {
        existing.seenOn.push(seenOnEntry);
      }
    }
  }
  return catalog;
}

/** Every distinct company id a given catalog entry has been observed on. */
export function companyIdsForResource(resource: ObservedZohoResource): Set<string> {
  return new Set(resource.seenOn.map((s) => s.companyId));
}

/** Catalog entries with no confirmed mapping yet, sorted by display name for a stable admin list. */
export function deriveUnmappedResources(
  catalog: Map<string, ObservedZohoResource>,
  mappedResourceIds: ReadonlySet<string>,
): ObservedZohoResource[] {
  const unmapped: ObservedZohoResource[] = [];
  for (const resource of catalog.values()) {
    if (!mappedResourceIds.has(resource.zohoResourceId)) unmapped.push(resource);
  }
  unmapped.sort((a, b) => (a.name || a.zohoResourceId).localeCompare(b.name || b.zohoResourceId));
  return unmapped;
}

export async function fetchObservedResourceCatalog(
  serviceClient: SupabaseClient,
): Promise<Map<string, ObservedZohoResource>> {
  const { data, error } = await serviceClient
    .from("zoho_fsm_service_appointments")
    .select(
      "zoho_service_appointment_id, zoho_service_appointment_number, project_id, company_id, raw_snapshot, projects(project_name, customer_name), companies(name)",
    )
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return buildObservedResourceCatalog((data as SaCatalogRow[] | null) || []);
}

export type ZohoResourceMapRow = {
  zoho_resource_id: string;
  zoho_user_id: string | null;
  user_id: string;
  mapped_by: string | null;
  mapped_at: string;
  created_at: string;
  updated_at: string;
};

export async function fetchMappedResourceIds(serviceClient: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await serviceClient.from("zoho_resource_map").select("zoho_resource_id");
  if (error) throw error;
  return new Set(((data as Array<{ zoho_resource_id: string }> | null) || []).map((r) => r.zoho_resource_id));
}
