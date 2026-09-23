import {
  createServiceRoleClient,
  createUserScopedClient,
  type RequesterProfile,
  type SupabaseServerEnv,
} from "./company-users/admin-api.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type RequesterMembership = {
  role: "admin" | "technician";
  is_active: boolean;
};

type ProjectAssignmentRow = {
  project_id: string;
};

export type ProjectCompanyBindingResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Phase 2H security reconciliation — the missing check the RLS/adversarial
 * review found: authorization here previously proved company_memberships
 * for the client-supplied companyId, and project_assignments for the
 * client-supplied projectId, INDEPENDENTLY — never that the two client-
 * supplied ids actually describe the SAME project. A company admin for
 * company A supplying a projectId that actually belongs to company B (or a
 * technician assigned to a project under company B while claiming
 * companyId A) would previously still pass. This pure function is the
 * explicit "prove project.company_id === requested companyId" step, called
 * BEFORE any role-specific check below (including the global-admin
 * shortcut) so it applies uniformly to every requester, not just
 * non-admins.
 *
 * status 409, not 403: this mirrors the SAME "immutable identity conflict,
 * never resolvable by retrying or re-authenticating" convention this
 * codebase already uses for job_card_submissions.submission_snapshot_hash
 * mismatches (see lib/job-card-submissions/finalize.ts) — the sync engine's
 * error classification (lib/submission-sync.ts) relies on exactly this
 * status code meaning "terminal", never "authorization, may be restored".
 */
export function verifyProjectBelongsToCompany(
  project: { id: string; companyId: string } | null,
  requestedProjectId: string,
  requestedCompanyId: string,
): ProjectCompanyBindingResult {
  if (!project || project.id !== requestedProjectId) {
    return { ok: false, status: 404, error: "Project not found." };
  }
  if (project.companyId !== requestedCompanyId) {
    return { ok: false, status: 409, error: "Project does not belong to the specified company." };
  }
  return { ok: true };
}

/**
 * Server-side mirror of the client-side project access check used on the project dashboard
 * page: global admin, active company admin, or a technician with an active assignment on this
 * specific project. Kept as its own helper (distinct from lib/company-users/admin-api.ts, which
 * is company-admin-only) since project-scoped operations — like exporting an expense report —
 * must also allow the assigned field technician, not just admins.
 */
export async function authorizeProjectAccess(args: {
  env: SupabaseServerEnv;
  accessToken: string;
  companyId: string;
  projectId: string;
}): Promise<
  | { ok: true; requesterUserId: string; dataClient: SupabaseClient }
  | { ok: false; status: number; error: string }
> {
  const { env, accessToken, companyId, projectId } = args;
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing authorization token." };
  }
  if (!companyId || !projectId) {
    return { ok: false, status: 400, error: "Company and project are required." };
  }
  if (env.missingPublic.length > 0) {
    return {
      ok: false,
      status: 500,
      error: `Server is missing required configuration: ${env.missingPublic.join(", ")}.`,
    };
  }

  const anonClient = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user: requesterUser },
    error: requesterAuthError,
  } = await anonClient.auth.getUser(accessToken);
  if (requesterAuthError || !requesterUser) {
    return { ok: false, status: 401, error: "Unauthorized requester." };
  }

  const serviceClient = createServiceRoleClient(env);
  const dataClient = serviceClient || createUserScopedClient(env, accessToken);

  // Phase 2H security reconciliation — load the requested project and prove
  // it actually belongs to the requested company BEFORE any role-specific
  // check, including the global-admin shortcut below. See
  // verifyProjectBelongsToCompany's own doc for why this must apply
  // uniformly to every requester, not just non-admins.
  const { data: projectRow, error: projectError } = await dataClient
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle<{ id: string; company_id: string }>();
  if (projectError) {
    return { ok: false, status: 403, error: "Failed to validate the requested project." };
  }
  const binding = verifyProjectBelongsToCompany(
    projectRow ? { id: projectRow.id, companyId: projectRow.company_id } : null,
    projectId,
    companyId,
  );
  if (!binding.ok) return binding;

  const { data: requesterProfile, error: requesterProfileError } = await dataClient
    .from("user_profiles")
    .select("id, global_role, is_active")
    .eq("id", requesterUser.id)
    .maybeSingle<RequesterProfile>();
  if (requesterProfileError || !requesterProfile) {
    return { ok: false, status: 403, error: "Requester profile not found." };
  }

  const isGlobalAdmin = requesterProfile.global_role === "admin" && requesterProfile.is_active !== false;
  if (isGlobalAdmin) {
    return { ok: true, requesterUserId: requesterUser.id, dataClient };
  }

  const { data: membership, error: membershipError } = await dataClient
    .from("company_memberships")
    .select("role, is_active")
    .eq("company_id", companyId)
    .eq("user_id", requesterUser.id)
    .maybeSingle<RequesterMembership>();
  if (membershipError) {
    return { ok: false, status: 403, error: "Failed to validate requester permissions." };
  }

  if (membership?.role === "admin" && membership.is_active) {
    return { ok: true, requesterUserId: requesterUser.id, dataClient };
  }

  if (membership?.role === "technician" && membership.is_active) {
    const { data: assignmentRows, error: assignmentError } = await dataClient
      .from("project_assignments")
      .select("project_id")
      .eq("user_id", requesterUser.id)
      .eq("project_id", projectId)
      .eq("is_active", true)
      .limit(1);
    if (assignmentError) {
      return { ok: false, status: 403, error: "Failed to validate project assignment." };
    }
    if (((assignmentRows as ProjectAssignmentRow[] | null) || []).length > 0) {
      return { ok: true, requesterUserId: requesterUser.id, dataClient };
    }
  }

  return {
    ok: false,
    status: 403,
    error: "Only global admins, active company admins, or technicians assigned to this project can access it.",
  };
}
