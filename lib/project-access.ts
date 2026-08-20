import {
  createServiceRoleClient,
  createUserScopedClient,
  type RequesterProfile,
  type SupabaseServerEnv,
} from "./company-users/admin-api";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type RequesterMembership = {
  role: "admin" | "technician";
  is_active: boolean;
};

type ProjectAssignmentRow = {
  project_id: string;
};

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
