import { after, NextResponse } from "next/server";
import { getSupabaseServerEnv, createServiceRoleClient, extractBearerToken } from "@/lib/company-users/admin-api";
import { handleAutoPublishRequest } from "@/lib/zoho-fsm/auto-publish";
import {
  createOrchestratorNotifier,
  createProjectAuthorizer,
  createSupabaseAutoPublishRepo,
} from "@/lib/zoho-fsm/orchestrator-client";

/**
 * Phase 0B auto-publish trigger. Called by the client — AWAITED, not fire-and-forget — immediately
 * after a completed Installer Sheetz job card is first submitted or an existing completed
 * submission is revised (never for draft save/edit); see app/page.tsx's
 * persistSubmittedJobCard/notifyZohoAutoPublish/handleFinalSubmit. By the time this route is
 * called, the Installer Sheetz submission/revision has ALREADY succeeded — this route's only job
 * is authorization plus scheduling the notification to the hosted Zoho FSM orchestrator, which
 * owns all publish/idempotency/revision logic itself.
 *
 * Authorization: this causes a privileged server-side chain that can ultimately write to Zoho, so
 * a projectId alone (however it got here) is never sufficient. handleAutoPublishRequest gates
 * everything behind authorizeProjectAccess (lib/project-access.ts) — the same check that already
 * guards other project-scoped server routes (e.g. the expense report export): the caller must be
 * a global admin, an active company admin, or a technician with an active assignment on this
 * specific project. Only once that passes does this route touch the service-role client that can
 * read zoho_fsm_service_appointments (which has no client-facing RLS policies at all).
 *
 * Response: 202 Accepted acknowledges that the request was authorized and the downstream work was
 * scheduled — it does NOT mean the Zoho publish itself has completed, and it never returns the
 * orchestrator's base URL, its admin token, or any other privileged data.
 *
 * after() scheduling: the actual orchestrator call is scheduled with next/server's after() so it
 * runs once this response has been sent. A slow or unavailable orchestrator can never delay or
 * fail this request — after() is guaranteed to run to completion on supported platforms (see
 * next/server's after() docs), unlike an un-awaited fire-and-forget fetch that risks the function
 * freezing mid-request. Duplicate notifications are acceptable; the orchestrator is the
 * idempotency authority.
 */
export async function POST(req: Request) {
  const env = getSupabaseServerEnv();
  if (env.missingPublic.length > 0 || env.missingServiceRole.length > 0) {
    return NextResponse.json({ error: "Server is missing required Supabase configuration." }, { status: 500 });
  }

  let companyId = "";
  let projectId = "";
  try {
    const body = (await req.json()) as { companyId?: unknown; projectId?: unknown };
    companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  } catch {
    // fall through — an empty companyId/projectId is rejected by authorizeProjectAccess below
  }

  const accessToken = extractBearerToken(req);

  const serviceClient = createServiceRoleClient(env);
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Server is missing required Supabase service-role configuration." },
      { status: 500 },
    );
  }

  const authorizer = createProjectAuthorizer(env);
  const repo = createSupabaseAutoPublishRepo(serviceClient);
  const notifier = createOrchestratorNotifier();

  const result = await handleAutoPublishRequest({ accessToken, companyId, projectId }, authorizer, repo, notifier);
  if ("scheduleAfterWork" in result) {
    after(result.scheduleAfterWork);
  }
  return NextResponse.json(result.body, { status: result.status });
}
