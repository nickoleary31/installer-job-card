import { NextResponse } from "next/server";
import { getSupabaseServerEnv, createServiceRoleClient } from "@/lib/company-users/admin-api";
import { getZohoFsmServerEnv } from "@/lib/zoho-fsm/env";
import { isValidWebhookSecret, ZOHO_FSM_WEBHOOK_SECRET_HEADER } from "@/lib/zoho-fsm/webhook-auth";
import { fetchServiceAppointment, fetchWorkOrder } from "@/lib/zoho-fsm/client";
import { extractWorkOrderIdFromServiceAppointment, mapZohoRecordsToInboundInput } from "@/lib/zoho-fsm/field-mapping";
import { resolveInboundServiceAppointment } from "@/lib/zoho-fsm/resolve";
import { createSupabaseZohoFsmRepo } from "@/lib/zoho-fsm/repo-supabase";

/**
 * Inbound Zoho FSM webhook. Configure the Zoho FSM Workflow Rule (Service Appointments module,
 * on create/schedule) to POST here with a JSON body:
 *   { "service_appointment_id": "${!Service_Appointments.id}" }
 * plus a static custom header carrying the shared secret (see ZOHO_FSM_WEBHOOK_SECRET_HEADER).
 * The webhook body is never trusted beyond this one id: the parent Work Order id is derived
 * server-side from the authoritative Service Appointment GET response (confirmed available via
 * Appointments_X_Services[].Work_Order — see lib/zoho-fsm/field-mapping.ts), and all customer/
 * company/site/core data comes from authoritative Zoho GET responses, never from the webhook
 * payload itself.
 */
export async function POST(req: Request) {
  const zohoEnv = getZohoFsmServerEnv();
  if (zohoEnv.missing.length > 0) {
    return NextResponse.json(
      { error: `Zoho FSM integration is not configured: missing ${zohoEnv.missing.join(", ")}.` },
      { status: 500 },
    );
  }

  const providedSecret = req.headers.get(ZOHO_FSM_WEBHOOK_SECRET_HEADER);
  if (!isValidWebhookSecret(providedSecret, zohoEnv.webhookSecret)) {
    return NextResponse.json({ error: "Invalid webhook secret." }, { status: 401 });
  }

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // Body is optional if ids arrive via query params instead.
  }

  const serviceAppointmentId =
    (typeof body.service_appointment_id === "string" && body.service_appointment_id.trim()) ||
    url.searchParams.get("service_appointment_id")?.trim() ||
    "";

  if (!serviceAppointmentId) {
    return NextResponse.json({ error: "Missing service_appointment_id." }, { status: 400 });
  }

  const supabaseEnv = getSupabaseServerEnv();
  const serviceClient = createServiceRoleClient(supabaseEnv);
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Server is missing required Supabase service-role configuration." },
      { status: 500 },
    );
  }

  const repo = createSupabaseZohoFsmRepo(serviceClient);

  try {
    // Never trust the webhook body beyond the service_appointment_id above — always re-fetch
    // authoritative data server-side before making any decision. The parent Work Order id is
    // derived from the SA response itself, not supplied by the caller.
    const serviceAppointment = await fetchServiceAppointment(zohoEnv, serviceAppointmentId);
    const workOrderId = extractWorkOrderIdFromServiceAppointment(serviceAppointment);
    if (!workOrderId) {
      const detail = `Service Appointment ${serviceAppointmentId} has no resolvable parent Work Order (empty Appointments_X_Services).`;
      await repo.logInboundEvent({
        zohoWorkOrderId: null,
        zohoServiceAppointmentId: serviceAppointmentId,
        installerSheetzCompanyValue: null,
        zohoServiceAddressIdValue: null,
        outcome: "error_work_order_unresolvable",
        detail,
        projectId: null,
      });
      return NextResponse.json({ error: detail }, { status: 422 });
    }
    const workOrder = await fetchWorkOrder(zohoEnv, workOrderId);

    const input = mapZohoRecordsToInboundInput({
      workOrder,
      serviceAppointment,
      companyFieldApiName: zohoEnv.workOrderCompanyFieldApiName,
    });

    const result = await resolveInboundServiceAppointment(repo, input);

    return NextResponse.json({ outcome: result.outcome, projectId: result.projectId });
  } catch (error) {
    console.error("[zoho-fsm] webhook processing failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to process Zoho FSM event." }, { status: 502 });
  }
}
