import { NextResponse } from "next/server";
import { extractBearerToken, getSupabaseServerEnv, requirePrivilegedServiceClient } from "@/lib/company-users/admin-api";
import { authorizeProjectAccess } from "@/lib/project-access";
import { fetchZohoProjectInfo } from "@/lib/zoho-fsm/project-info";
import { handleProjectInfoRequest } from "@/lib/zoho-fsm/project-routes-access";

/**
 * Narrow, browser-safe Zoho FSM info for one project (WO#/SA#/summary only — never
 * raw_snapshot or any Zoho record id). zoho_fsm_service_appointments has no client-facing RLS
 * policies, so this server route is the only way client code can learn anything from it.
 *
 * Checkpoint 2 — authorized, not just authenticated: the project's company is derived from
 * the project row server-side and the requester must pass the shared project-access check
 * (lib/project-access.ts). Thin wrapper — see lib/zoho-fsm/project-routes-access.ts for the
 * unit-tested handler.
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

  const result = await handleProjectInfoRequest(
    {
      accessToken: extractBearerToken(req),
      projectId: new URL(req.url).searchParams.get("projectId") ?? "",
    },
    {
      async loadProjectCompany(projectId) {
        const { data, error } = await serviceClient
          .from("projects")
          .select("company_id")
          .eq("id", projectId)
          .maybeSingle<{ company_id: string }>();
        if (error) return { companyId: null, error: true };
        return { companyId: data?.company_id ?? null };
      },
      async authorizeProject(args) {
        const auth = await authorizeProjectAccess({ env, ...args });
        return auth.ok ? { ok: true, requesterUserId: auth.requesterUserId, role: auth.role } : auth;
      },
      fetchInfo: (projectId) => fetchZohoProjectInfo(serviceClient, projectId),
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
