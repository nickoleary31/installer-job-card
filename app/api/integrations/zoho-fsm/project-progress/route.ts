import { NextResponse } from "next/server";
import { extractBearerToken, getSupabaseServerEnv, requirePrivilegedServiceClient } from "@/lib/company-users/admin-api";
import { authorizeCompanyAccess } from "@/lib/project-access";
import { fetchZohoProjectProgressForCompany } from "@/lib/zoho-fsm/project-progress";
import { handleProjectProgressRequest } from "@/lib/zoho-fsm/project-routes-access";

/**
 * Narrow, browser-safe SA Target/Finalized Asset Count for every Zoho-linked project in one
 * company — feeds the admin Project card's "Completed submissions" denominator (see
 * lib/zoho-fsm/project-progress-display.ts). zoho_fsm_service_appointments has no client-facing
 * RLS policies, so this server route is the only way client code can learn these values.
 *
 * Checkpoint 2 — authorized, not just authenticated: a global admin or an active member of
 * the company (lib/project-access.ts's authorizeCompanyAccess); a technician receives only
 * the projects they are actively assigned to. Thin wrapper — see
 * lib/zoho-fsm/project-routes-access.ts for the unit-tested handler.
 */
export async function GET(req: Request) {
  const env = getSupabaseServerEnv();
  if (env.missingPublic.length > 0) {
    return NextResponse.json({ error: "Server is missing required Supabase configuration." }, { status: 500 });
  }
  const privileged = requirePrivilegedServiceClient(env);
  if (!privileged.ok) {
    return NextResponse.json({ error: privileged.error }, { status: privileged.status });
  }
  const { serviceClient } = privileged;

  const result = await handleProjectProgressRequest(
    {
      accessToken: extractBearerToken(req),
      companyId: new URL(req.url).searchParams.get("companyId") ?? "",
    },
    {
      async authorizeCompany(args) {
        const auth = await authorizeCompanyAccess({ env, ...args });
        return auth.ok ? { ok: true, requesterUserId: auth.requesterUserId, role: auth.role } : auth;
      },
      fetchProgress: (companyId) => fetchZohoProjectProgressForCompany(serviceClient, companyId),
      async listActiveAssignedProjectIds(userId) {
        const { data, error } = await serviceClient
          .from("project_assignments")
          .select("project_id")
          .eq("user_id", userId)
          .eq("is_active", true);
        if (error) throw error;
        return ((data as { project_id: string }[] | null) || []).map((row) => row.project_id);
      },
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
