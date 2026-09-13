/**
 * Pure access-check for the SA-scoped evidence PDF endpoint (see
 * app/api/integrations/zoho-fsm/evidence/pdf/route.ts). Kept separate from the route so the
 * relationship logic — SA must exist, submission must exist, submission must belong to the SA's
 * OWN linked project — can be unit tested without a live Supabase client, matching how
 * buildEvidenceResponse/buildCompletedAsset in evidence.ts are tested against plain data rather
 * than the database.
 *
 * Every failure reason collapses to the SAME generic 404 at the route layer — a caller must never
 * be able to distinguish "unknown SA" from "submission belongs to a different project" from the
 * response shape, since that distinction would let an attacker enumerate valid SA/submission ids.
 */

export type EvidencePdfAccessResult =
  | { ok: true }
  | { ok: false; reason: "unknown_service_appointment" | "unknown_submission" | "submission_not_in_project" };

export function checkEvidencePdfAccess(args: {
  /** project_id linked to the requested zohoServiceAppointmentId, or null if no SA row matched. */
  serviceAppointmentProjectId: string | null;
  /** project_id the requested submissionId belongs to, or null if no submission row matched. */
  submissionProjectId: string | null;
}): EvidencePdfAccessResult {
  if (!args.serviceAppointmentProjectId) {
    return { ok: false, reason: "unknown_service_appointment" };
  }
  if (!args.submissionProjectId) {
    return { ok: false, reason: "unknown_submission" };
  }
  if (args.submissionProjectId !== args.serviceAppointmentProjectId) {
    return { ok: false, reason: "submission_not_in_project" };
  }
  return { ok: true };
}
