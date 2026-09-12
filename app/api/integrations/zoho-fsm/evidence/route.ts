import { NextResponse } from "next/server";
import { getSupabaseServerEnv, createServiceRoleClient } from "@/lib/company-users/admin-api";
import { getZohoFsmServerEnv } from "@/lib/zoho-fsm/env";
import { isValidWebhookSecret, ZOHO_FSM_EVIDENCE_SECRET_HEADER } from "@/lib/zoho-fsm/webhook-auth";
import { fetchZohoFsmEvidence } from "@/lib/zoho-fsm/evidence";

/**
 * Read-only, server-to-server completion-evidence endpoint for a future external orchestrator
 * service (see docs discussion — under the locked V1 hybrid architecture, Installer Sheetz never
 * owns Zoho Work Order financial/billing mutation logic; this is the one narrow contract it
 * exposes instead). Keyed by zoho_service_appointment_id, matching the project-info route's
 * existing query-param convention:
 *   GET /api/integrations/zoho-fsm/evidence?zohoServiceAppointmentId=<id>
 * plus a static header carrying a shared secret (see ZOHO_FSM_EVIDENCE_SECRET_HEADER) — a
 * separate credential from the inbound SA webhook's own secret, since this is the opposite trust
 * direction (an external caller pulling data out, not Zoho pushing an event in).
 *
 * No outbound Zoho writes, no billing logic, no orchestration happen here — this endpoint only
 * reads and reshapes data Installer Sheetz already has.
 */
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

  const zohoServiceAppointmentId = new URL(req.url).searchParams.get("zohoServiceAppointmentId")?.trim();
  if (!zohoServiceAppointmentId) {
    return NextResponse.json({ error: "zohoServiceAppointmentId is required." }, { status: 400 });
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
    const evidence = await fetchZohoFsmEvidence(serviceClient, zohoServiceAppointmentId);
    if (!evidence) {
      return NextResponse.json({ error: "Unknown or unlinked Zoho Service Appointment id." }, { status: 404 });
    }
    return NextResponse.json(evidence);
  } catch (error) {
    // Never leak Supabase internals/SQL/stack traces to the caller — log server-side context
    // only, matching the existing webhook route's error-handling convention.
    console.error("[zoho-fsm] evidence lookup failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to load Zoho FSM evidence." }, { status: 500 });
  }
}
