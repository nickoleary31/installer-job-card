import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeInstalledProductSystems } from "../product-devices/normalize.ts";
import type { JobCardSubmissionPayload } from "../job-card-submission.ts";

/**
 * Read-only completion-evidence for one Zoho Service Appointment's linked project — the stable
 * V1 contract between Installer Sheetz and a future external orchestrator service (see
 * app/api/integrations/zoho-fsm/evidence/route.ts). Installer Sheetz never owns Zoho Work Order
 * financial/billing mutation logic; this module only exposes existing field-execution evidence
 * already captured by the app, reusing the same data/counting logic the project list screen's
 * completedSubmissionCount already relies on (see app/companies/[companyId]/projects/page.tsx).
 *
 * Revision safety: the current supported job-card revision workflow (Edit an already-submitted
 * job card — see app/page.tsx's editSubmissionId handling) UPDATEs the existing
 * job_card_submissions row in place rather than inserting a new one, so a plain row count is
 * already revision-safe. This module intentionally does NOT deduplicate by unitNumber, does not
 * introduce a supersedes_submission_id concept, and does not build any revision graph — none of
 * that is needed for a supported revision, and inventing it for the narrower "technician started
 * an entirely new job card instead of using Edit" edge case is explicitly out of scope for this
 * PR (see assetIdentifiers below, which exists so a future orchestrator can reason about that
 * case itself during explicit batch finalization).
 */

export type ZohoFsmEvidenceInstalledProduct = {
  productKey: string;
  displayLabel: string;
  /**
   * Number of physical components (e.g. cameras, monitors, trackers) within THIS ONE installed
   * system — not the number of systems of this product type on this asset. If a technician
   * installs two separate systems of the same product on one asset, they appear as two separate
   * entries in installedProducts, each with its own componentCount; this module never sums or
   * collapses across them. A future orchestrator that needs "how many systems of product X" can
   * derive that itself by counting entries with a matching productKey.
   */
  componentCount: number;
};

export type ZohoFsmEvidenceAssetIdentifiers = {
  /**
   * CoreJobFields.equipmentSerial — the serial number of the physical customer asset (e.g. the
   * forklift/vehicle being serviced), distinct from any installed product/device's own serial
   * number (which lives separately, per-component, under installedProducts/installDetails).
   * This is the only additional stable customer-asset identifier that exists in the current job
   * card data model beyond unitNumber (already exposed as its own top-level field below) — no
   * VIN, customer asset number, or license plate field exists in CoreJobFields today, so none
   * are invented here.
   */
  equipmentSerial: string | null;
};

export type ZohoFsmEvidenceCompletedAsset = {
  submissionId: string;
  unitNumber: string | null;
  /**
   * The ORIGINAL submission timestamp only. job_card_submissions has no updated_at/revised_at
   * column — a revised (edited) submission keeps its original createdAt, so this must never be
   * read as "last revised at."
   */
  createdAt: string;
  assetIdentifiers: ZohoFsmEvidenceAssetIdentifiers;
  installedProducts: ZohoFsmEvidenceInstalledProduct[];
};

export type ZohoFsmEvidenceResponse = {
  zohoServiceAppointmentId: string;
  projectId: string;
  /**
   * Row count of job_card_submissions for the linked project — already revision-safe by
   * construction (see module docstring). Equal to completedAssets.length.
   */
  completedAssetCount: number;
  completedAssets: ZohoFsmEvidenceCompletedAsset[];
  /** Count of SERVER-VISIBLE job_card_drafts rows only — see pendingDraftCountScope. */
  pendingDraftCount: number;
  /**
   * Always "server_only": offline-only IndexedDB drafts are invisible to the IS server (no
   * background sync exists — see lib/offline-job-card-drafts.ts / lib/installer-offline-db.ts).
   * pendingDraftCount = 0 must NOT be read as "there is definitely no unfinished work anywhere."
   */
  pendingDraftCountScope: "server_only";
};

type SubmissionEvidenceRow = {
  submissionId: string;
  unitNumber: string | null;
  createdAt: string;
  payload: JobCardSubmissionPayload | null;
};

function buildInstalledProducts(payload: JobCardSubmissionPayload | null): ZohoFsmEvidenceInstalledProduct[] {
  if (!payload) return [];
  const systems = normalizeInstalledProductSystems({
    installedProductSystems: payload.installedProductSystems ?? null,
    installedDevices: payload.installedDevices ?? null,
  });
  return systems.map((system) => ({
    productKey: system.productKey,
    displayLabel: system.displayLabel,
    componentCount: Array.isArray(system.components) ? system.components.length : 0,
  }));
}

function buildAssetIdentifiers(payload: JobCardSubmissionPayload | null): ZohoFsmEvidenceAssetIdentifiers {
  const equipmentSerial = payload?.coreJobInfo?.equipmentSerial;
  return {
    equipmentSerial: typeof equipmentSerial === "string" && equipmentSerial.trim() ? equipmentSerial.trim() : null,
  };
}

export function buildCompletedAsset(row: SubmissionEvidenceRow): ZohoFsmEvidenceCompletedAsset {
  return {
    submissionId: row.submissionId,
    unitNumber: row.unitNumber,
    createdAt: row.createdAt,
    assetIdentifiers: buildAssetIdentifiers(row.payload),
    installedProducts: buildInstalledProducts(row.payload),
  };
}

export function buildEvidenceResponse(args: {
  zohoServiceAppointmentId: string;
  projectId: string;
  submissions: SubmissionEvidenceRow[];
  pendingDraftCount: number;
}): ZohoFsmEvidenceResponse {
  const completedAssets = args.submissions.map(buildCompletedAsset);
  return {
    zohoServiceAppointmentId: args.zohoServiceAppointmentId,
    projectId: args.projectId,
    completedAssetCount: completedAssets.length,
    completedAssets,
    pendingDraftCount: args.pendingDraftCount,
    pendingDraftCountScope: "server_only",
  };
}

type LinkRow = { project_id: string };
type SubmissionDbRow = {
  submission_id: string;
  unit_number: string | null;
  created_at: string;
  payload: JobCardSubmissionPayload | null;
};

/**
 * Resolves zoho_service_appointment_id -> zoho_fsm_service_appointments -> project_id -> current
 * Installer Sheetz field evidence. Returns null when the SA id is unknown/unlinked — callers
 * (see the evidence route) must treat that as a 404, not a 500.
 */
export async function fetchZohoFsmEvidence(
  serviceClient: SupabaseClient,
  zohoServiceAppointmentId: string,
): Promise<ZohoFsmEvidenceResponse | null> {
  const { data: link, error: linkError } = await serviceClient
    .from("zoho_fsm_service_appointments")
    .select("project_id")
    .eq("zoho_service_appointment_id", zohoServiceAppointmentId)
    .maybeSingle<LinkRow>();
  if (linkError) throw linkError;
  if (!link) return null;

  const { data: submissionRows, error: submissionError } = await serviceClient
    .from("job_card_submissions")
    .select("submission_id, unit_number, created_at, payload")
    .eq("project_id", link.project_id);
  if (submissionError) throw submissionError;

  const { count: pendingDraftCount, error: draftError } = await serviceClient
    .from("job_card_drafts")
    .select("id", { count: "exact", head: true })
    .eq("project_id", link.project_id);
  if (draftError) throw draftError;

  const submissions: SubmissionEvidenceRow[] = ((submissionRows as SubmissionDbRow[] | null) || []).map((row) => ({
    submissionId: row.submission_id,
    unitNumber: row.unit_number,
    createdAt: row.created_at,
    payload: row.payload,
  }));

  return buildEvidenceResponse({
    zohoServiceAppointmentId,
    projectId: link.project_id,
    submissions,
    pendingDraftCount: pendingDraftCount ?? 0,
  });
}
