import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseServerEnv, createServiceRoleClient, extractBearerToken } from "@/lib/company-users/admin-api";
import { fetchZohoProjectProgressForCompany } from "@/lib/zoho-fsm/project-progress";

/**
 * Narrow, browser-safe SA Target/Finalized Asset Count for every Zoho-linked project in one
 * company — feeds the admin Project card's "Completed submissions" denominator (see
 * lib/zoho-fsm/project-progress-display.ts). zoho_fsm_service_appointments has no client-facing
 * RLS policies, so this server route is the only way client code can learn these values — same
 * auth requirement as the existing project-info route (any signed-in app user, no
 * company-membership check — this exposes nothing more sensitive than the project list itself
 * already does).
 */
export async function GET(req: Request) {
  const env = getSupabaseServerEnv();
  if (env.missingPublic.length > 0 || env.missingServiceRole.length > 0) {
    return NextResponse.json({ error: "Server is missing required Supabase configuration." }, { status: 500 });
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

  const companyId = new URL(req.url).searchParams.get("companyId")?.trim();
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required." }, { status: 400 });
  }

  const serviceClient = createServiceRoleClient(env);
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Server is missing required Supabase service-role configuration." },
      { status: 500 },
    );
  }

  try {
    const byProjectId = await fetchZohoProjectProgressForCompany(serviceClient, companyId);
    return NextResponse.json(byProjectId);
  } catch (error) {
    console.error("[zoho-fsm] project-progress lookup failed", error instanceof Error ? error.message : error);
    return NextResponse.json({}, { status: 200 });
  }
}
