import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseServerEnv, createServiceRoleClient, extractBearerToken } from "@/lib/company-users/admin-api";
import { fetchZohoProjectInfo, UNLINKED_PROJECT_INFO } from "@/lib/zoho-fsm/project-info";

/**
 * Narrow, browser-safe Zoho FSM info for one project (WO#/SA#/summary only — never
 * raw_snapshot or any Zoho record id). zoho_fsm_service_appointments has no client-facing RLS
 * policies, so this server route is the only way client code can learn anything from it.
 * Auth requirement mirrors how projects/customers are already readable by any signed-in app
 * user today (no company-membership check) — this exposes nothing more sensitive than that.
 */
export async function GET(req: Request) {
  const env = getSupabaseServerEnv();
  if (env.missingPublic.length > 0 || env.missingServiceRole.length > 0) {
    return NextResponse.json(
      { error: "Server is missing required Supabase configuration." },
      { status: 500 },
    );
  }

  const accessToken = extractBearerToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: "Missing authorization token." }, { status: 401 });
  }

  const anonClient = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  }

  const serviceClient = createServiceRoleClient(env);
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Server is missing required Supabase service-role configuration." },
      { status: 500 },
    );
  }

  try {
    const info = await fetchZohoProjectInfo(serviceClient, projectId);
    return NextResponse.json(info);
  } catch (error) {
    console.error("[zoho-fsm] project-info lookup failed", error instanceof Error ? error.message : error);
    return NextResponse.json(UNLINKED_PROJECT_INFO);
  }
}
