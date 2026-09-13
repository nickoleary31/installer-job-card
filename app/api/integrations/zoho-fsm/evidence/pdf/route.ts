import { NextResponse } from "next/server";
import { getSupabaseServerEnv, createServiceRoleClient } from "@/lib/company-users/admin-api";
import { getZohoFsmServerEnv } from "@/lib/zoho-fsm/env";
import { isValidWebhookSecret, ZOHO_FSM_EVIDENCE_SECRET_HEADER } from "@/lib/zoho-fsm/webhook-auth";
import { checkEvidencePdfAccess } from "@/lib/zoho-fsm/evidence-pdf-access";
import { computeContentHash } from "@/lib/canonical-hash";
import { regenerateJobCardPdfForSubmission } from "@/lib/job-card-pdf-generation";
import type { JobCardSubmissionPayload } from "@/lib/job-card-submission";

/**
 * Read-only, server-to-server completion-evidence PDF for a future external orchestrator service
 * — the SA-scoped counterpart to app/api/integrations/zoho-fsm/evidence/route.ts:
 *   GET /api/integrations/zoho-fsm/evidence/pdf
 *     ?zohoServiceAppointmentId=<sa>&submissionId=<submission>
 * plus the same x-zoho-fsm-evidence-secret header (see ZOHO_FSM_EVIDENCE_SECRET_HEADER).
 *
 * A submissionId alone must never retrieve an arbitrary Installer Sheetz job card: the caller
 * must also name the zohoServiceAppointmentId that submission is evidence for, and the two must
 * resolve to the SAME project (see checkEvidencePdfAccess) before any PDF is generated. Every
 * relationship failure — unknown SA, unknown submission, or a submission that belongs to a
 * different project than the named SA — returns the identical generic 404 response so a caller
 * can never learn which check failed (that would let an attacker enumerate valid ids).
 *
 * No outbound Zoho writes happen here. The PDF is regenerated from the CURRENT stored submission
 * payload via the same rendering pipeline the outbound job-card email attachment uses (see
 * lib/job-card-pdf-generation.ts) — never cached, never persisted separately.
 */

const GENERIC_NOT_FOUND = { error: "Unknown or unlinked Zoho Service Appointment or submission." };

type ServiceAppointmentLinkRow = { project_id: string };
type SubmissionRow = { project_id: string; payload: JobCardSubmissionPayload | null };

export async function GET(req: Request) {
  const zohoEnv = getZohoFsmServerEnv();
  if (!zohoEnv.evidenceApiSecret) {
    return NextResponse.json(
      { error: "Zoho FSM evidence endpoint is not configured: missing ZOHO_FSM_EVIDENCE_API_SECRET." },
      { status: 500 },
    );
  }

  const providedSecret = req.headers.get(ZOHO_FSM_EVIDENCE_SECRET_HEADER);
  if (!isValidWebhookSecret(providedSecret, zohoEnv.evidenceApiSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(req.url);
  const zohoServiceAppointmentId = url.searchParams.get("zohoServiceAppointmentId")?.trim();
  if (!zohoServiceAppointmentId) {
    return NextResponse.json({ error: "zohoServiceAppointmentId is required." }, { status: 400 });
  }
  const submissionId = url.searchParams.get("submissionId")?.trim();
  if (!submissionId) {
    return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
  }

  const supabaseEnv = getSupabaseServerEnv();
  const serviceClient = createServiceRoleClient(supabaseEnv);
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Server is missing required Supabase service-role configuration." },
      { status: 500 },
    );
  }

  try {
    const { data: link, error: linkError } = await serviceClient
      .from("zoho_fsm_service_appointments")
      .select("project_id")
      .eq("zoho_service_appointment_id", zohoServiceAppointmentId)
      .maybeSingle<ServiceAppointmentLinkRow>();
    if (linkError) throw linkError;

    const { data: submission, error: submissionError } = await serviceClient
      .from("job_card_submissions")
      .select("project_id, payload")
      .eq("submission_id", submissionId)
      .maybeSingle<SubmissionRow>();
    if (submissionError) throw submissionError;

    const access = checkEvidencePdfAccess({
      serviceAppointmentProjectId: link?.project_id ?? null,
      submissionProjectId: submission?.project_id ?? null,
    });
    if (!access.ok || !submission) {
      return NextResponse.json(GENERIC_NOT_FOUND, { status: 404 });
    }

    if (!submission.payload) {
      console.error("[zoho-fsm] evidence PDF: submission row has no stored payload", { submissionId });
      return NextResponse.json({ error: "Failed to generate Zoho FSM evidence PDF." }, { status: 500 });
    }

    // Same helper, same stored payload the evidence endpoint hashes for this submission's
    // completedAssets[].contentHash — must always agree for the same submission.
    const contentHash = computeContentHash(submission.payload);
    const { buffer, filename } = await regenerateJobCardPdfForSubmission(submission.payload, {
      supabase: serviceClient,
    });

    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Hash": contentHash,
      },
    });
  } catch (error) {
    // Never leak Supabase internals/SQL/stack traces to the caller — log server-side context
    // only, matching the existing evidence/webhook routes' error-handling convention.
    console.error("[zoho-fsm] evidence PDF generation failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to generate Zoho FSM evidence PDF." }, { status: 500 });
  }
}
