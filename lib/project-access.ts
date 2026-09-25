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

/** How the requester qualified — for callers that scope results further (e.g. a technician's own assignments). */
export type ProjectAccessRole = "global-admin" | "company-admin" | "technician";

export type ProjectRecord = { id: string; companyId: string; active: boolean };

/**
 * Checkpoint 2 — every read the authorization decision depends on, as a
 * dependency so the decision itself (decideProjectAccess /
 * decideCompanyAccess) is unit-testable adversarially without a live
 * Supabase project — see lib/project-access.test.ts. Each read returns
 * `{ error: true }` for a failed query, which the decision always treats as
 * a denial (fail closed), never as "no row".
 */
export type ProjectAccessReads = {
  /** Server-side token verification — the ONLY source of requester identity. */
  verifyAccessToken(accessToken: string): Promise<{ userId: string } | null>;
  loadProject(projectId: string): Promise<{ project: ProjectRecord | null; error?: boolean }>;
  loadProfile(userId: string): Promise<{ profile: RequesterProfile | null; error?: boolean }>;
  loadMembership(companyId: string, userId: string): Promise<{ membership: RequesterMembership | null; error?: boolean }>;
  hasActiveAssignment(userId: string, projectId: string): Promise<{ assigned: boolean; error?: boolean }>;
};

export type ProjectAccessDecision =
  | { ok: true; requesterUserId: string; role: ProjectAccessRole; project: ProjectRecord }
  | { ok: false; status: number; error: string };

const NO_PROJECT_ACCESS_ERROR =
  "Only global admins, active company admins, or technicians assigned to this project can access it.";

/**
 * Server-side mirror of the client-side project access check used on the project dashboard
 * page: global admin, active company admin, or a technician with an active assignment on this
 * specific project. Kept as its own helper (distinct from lib/company-users/admin-api.ts, which
 * is company-admin-only) since project-scoped operations — like exporting an expense report —
 * must also allow the assigned field technician, not just admins.
 *
 * Checkpoint 2 additions, applied uniformly BEFORE any role check:
 *  - the requester's user_profiles.is_active must not be false (previously
 *    only the global-admin shortcut looked at it, so a deactivated
 *    technician with a still-active membership passed);
 *  - with `requireActiveProject`, the project must be active
 *    (projects.active): an inactive project is not a place NEW work can be
 *    recorded into, so the write routes (finalize, photo-upload-url) set it.
 *    Read routes (history, Zoho info, expense export, email resend) do not —
 *    an admin must still be able to see a completed project's data. 403
 *    (not 409), so the sync engine treats it as "authorization, may be
 *    restored" if the project is reactivated, never as a terminal identity
 *    conflict.
 */
export type ProjectAccessOptions = { requireActiveProject?: boolean };

export async function decideProjectAccess(
  args: { accessToken: string; companyId: string; projectId: string },
  reads: ProjectAccessReads,
  options: ProjectAccessOptions = {},
): Promise<ProjectAccessDecision> {
  const { accessToken, companyId, projectId } = args;
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing authorization token." };
  }
  if (!companyId || !projectId) {
    return { ok: false, status: 400, error: "Company and project are required." };
  }

  const requester = await reads.verifyAccessToken(accessToken);
  if (!requester) {
    return { ok: false, status: 401, error: "Unauthorized requester." };
  }

  // Phase 2H security reconciliation — load the requested project and prove
  // it actually belongs to the requested company BEFORE any role-specific
  // check, including the global-admin shortcut below. See
  // verifyProjectBelongsToCompany's own doc for why this must apply
  // uniformly to every requester, not just non-admins.
  const { project, error: projectError } = await reads.loadProject(projectId);
  if (projectError) {
    return { ok: false, status: 403, error: "Failed to validate the requested project." };
  }
  const binding = verifyProjectBelongsToCompany(project, projectId, companyId);
  if (!binding.ok) return binding;
  if (!project) return { ok: false, status: 404, error: "Project not found." }; // already refused above; narrows the type
  if (options.requireActiveProject && !project.active) {
    return { ok: false, status: 403, error: "This project is not active." };
  }

  const { profile, error: profileError } = await reads.loadProfile(requester.userId);
  if (profileError || !profile) {
    return { ok: false, status: 403, error: "Requester profile not found." };
  }
  if (profile.is_active === false) {
    return { ok: false, status: 403, error: "This user account is not active." };
  }

  if (profile.global_role === "admin") {
    return { ok: true, requesterUserId: requester.userId, role: "global-admin", project };
  }

  const { membership, error: membershipError } = await reads.loadMembership(companyId, requester.userId);
  if (membershipError) {
    return { ok: false, status: 403, error: "Failed to validate requester permissions." };
  }
  if (!membership || !membership.is_active) {
    return { ok: false, status: 403, error: NO_PROJECT_ACCESS_ERROR };
  }

  if (membership.role === "admin") {
    return { ok: true, requesterUserId: requester.userId, role: "company-admin", project };
  }

  if (membership.role === "technician") {
    const { assigned, error: assignmentError } = await reads.hasActiveAssignment(requester.userId, projectId);
    if (assignmentError) {
      return { ok: false, status: 403, error: "Failed to validate project assignment." };
    }
    if (assigned) {
      return { ok: true, requesterUserId: requester.userId, role: "technician", project };
    }
  }

  return { ok: false, status: 403, error: NO_PROJECT_ACCESS_ERROR };
}

export type CompanyAccessDecision =
  | { ok: true; requesterUserId: string; role: ProjectAccessRole }
  | { ok: false; status: number; error: string };

/**
 * Checkpoint 2 — company-scoped access using the SAME identity, profile and
 * membership rules as decideProjectAccess, for operations that are about a
 * company rather than one project (the Zoho project-progress lookup): a
 * global admin, or any ACTIVE member of that company. A technician
 * qualifies as a member here; callers that return per-project data must
 * then scope it to that technician's own active assignments (see
 * lib/zoho-fsm/project-routes-access.ts).
 */
export async function decideCompanyAccess(
  args: { accessToken: string; companyId: string },
  reads: Pick<ProjectAccessReads, "verifyAccessToken" | "loadProfile" | "loadMembership">,
): Promise<CompanyAccessDecision> {
  const { accessToken, companyId } = args;
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing authorization token." };
  }
  if (!companyId) {
    return { ok: false, status: 400, error: "Company is required." };
  }

  const requester = await reads.verifyAccessToken(accessToken);
  if (!requester) {
    return { ok: false, status: 401, error: "Unauthorized requester." };
  }

  const { profile, error: profileError } = await reads.loadProfile(requester.userId);
  if (profileError || !profile) {
    return { ok: false, status: 403, error: "Requester profile not found." };
  }
  if (profile.is_active === false) {
    return { ok: false, status: 403, error: "This user account is not active." };
  }
  if (profile.global_role === "admin") {
    return { ok: true, requesterUserId: requester.userId, role: "global-admin" };
  }

  const { membership, error: membershipError } = await reads.loadMembership(companyId, requester.userId);
  if (membershipError) {
    return { ok: false, status: 403, error: "Failed to validate requester permissions." };
  }
  if (!membership || !membership.is_active) {
    return { ok: false, status: 403, error: "Only global admins or active members of this company can access it." };
  }
  return {
    ok: true,
    requesterUserId: requester.userId,
    role: membership.role === "admin" ? "company-admin" : "technician",
  };
}

/**
 * The real reads, over the SAME dataClient every caller then uses for its
 * own work: the service-role client when configured, else the caller's own
 * user-scoped client (see admin-api.ts's requirePrivilegedServiceClient for
 * the routes that refuse to run without the former).
 */
export function createProjectAccessReads(env: SupabaseServerEnv, dataClient: SupabaseClient): ProjectAccessReads {
  const anonClient = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async verifyAccessToken(accessToken) {
      const {
        data: { user },
        error,
      } = await anonClient.auth.getUser(accessToken);
      return error || !user ? null : { userId: user.id };
    },
    async loadProject(projectId) {
      const { data, error } = await dataClient
        .from("projects")
        .select("id, company_id, active")
        .eq("id", projectId)
        .maybeSingle<{ id: string; company_id: string; active: boolean | null }>();
      if (error) return { project: null, error: true };
      return { project: data ? { id: data.id, companyId: data.company_id, active: data.active !== false } : null };
    },
    async loadProfile(userId) {
      const { data, error } = await dataClient
        .from("user_profiles")
        .select("id, global_role, is_active")
        .eq("id", userId)
        .maybeSingle<RequesterProfile>();
      if (error) return { profile: null, error: true };
      return { profile: data ?? null };
    },
    async loadMembership(companyId, userId) {
      const { data, error } = await dataClient
        .from("company_memberships")
        .select("role, is_active")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .maybeSingle<RequesterMembership>();
      if (error) return { membership: null, error: true };
      return { membership: data ?? null };
    },
    async hasActiveAssignment(userId, projectId) {
      const { data, error } = await dataClient
        .from("project_assignments")
        .select("project_id")
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .eq("is_active", true)
        .limit(1);
      if (error) return { assigned: false, error: true };
      return { assigned: ((data as ProjectAssignmentRow[] | null) || []).length > 0 };
    },
  };
}

function resolveDataClient(env: SupabaseServerEnv, accessToken: string): SupabaseClient {
  return createServiceRoleClient(env) || createUserScopedClient(env, accessToken);
}

export async function authorizeProjectAccess(args: {
  env: SupabaseServerEnv;
  accessToken: string;
  companyId: string;
  projectId: string;
  /** See ProjectAccessOptions — set by routes that record NEW work into the project. */
  requireActiveProject?: boolean;
}): Promise<
  | { ok: true; requesterUserId: string; role: ProjectAccessRole; project: ProjectRecord; dataClient: SupabaseClient }
  | { ok: false; status: number; error: string }
> {
  const { env, accessToken, companyId, projectId, requireActiveProject } = args;
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

  const dataClient = resolveDataClient(env, accessToken);
  const decision = await decideProjectAccess({ accessToken, companyId, projectId }, createProjectAccessReads(env, dataClient), {
    requireActiveProject,
  });
  if (!decision.ok) return decision;
  return { ...decision, dataClient };
}

/** Company-scoped counterpart of authorizeProjectAccess — see decideCompanyAccess. */
export async function authorizeCompanyAccess(args: {
  env: SupabaseServerEnv;
  accessToken: string;
  companyId: string;
}): Promise<
  | { ok: true; requesterUserId: string; role: ProjectAccessRole; dataClient: SupabaseClient }
  | { ok: false; status: number; error: string }
> {
  const { env, accessToken, companyId } = args;
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing authorization token." };
  }
  if (!companyId) {
    return { ok: false, status: 400, error: "Company is required." };
  }
  if (env.missingPublic.length > 0) {
    return {
      ok: false,
      status: 500,
      error: `Server is missing required configuration: ${env.missingPublic.join(", ")}.`,
    };
  }

  const dataClient = resolveDataClient(env, accessToken);
  const decision = await decideCompanyAccess({ accessToken, companyId }, createProjectAccessReads(env, dataClient));
  if (!decision.ok) return decision;
  return { ...decision, dataClient };
}
