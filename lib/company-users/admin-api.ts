import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type CompanyRole = "admin" | "technician";

export type RequesterProfile = {
  id: string;
  global_role: "admin" | "technician" | null;
  is_active?: boolean | null;
};

export type RequesterMembership = {
  role: CompanyRole;
  is_active: boolean;
};

export type SupabaseServerEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string | null;
  missingPublic: string[];
  missingServiceRole: string[];
};

export function getSupabaseServerEnv(): SupabaseServerEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  return {
    url,
    anonKey,
    serviceRoleKey: serviceRoleKey || null,
    missingPublic: [
      ...(!url ? (["NEXT_PUBLIC_SUPABASE_URL"] as const) : []),
      ...(!anonKey ? (["NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) : []),
    ],
    missingServiceRole: !serviceRoleKey ? ["SUPABASE_SERVICE_ROLE_KEY"] : [],
  };
}

export function missingConfigError(varNames: string[]): string {
  if (varNames.length === 1) {
    return `This operation is unavailable because ${varNames[0]} is not configured on the server.`;
  }
  return `Server is missing required configuration: ${varNames.join(", ")}.`;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isValidRole(value: string): value is CompanyRole {
  return value === "admin" || value === "technician";
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function createServiceRoleClient(env: SupabaseServerEnv): SupabaseClient | null {
  if (!env.serviceRoleKey || !env.url) return null;
  return createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type PrivilegedServiceClientResult =
  | { ok: true; serviceClient: SupabaseClient }
  | { ok: false; status: number; error: string };

/**
 * The fail-closed gate a privileged route (send-email, the Zoho project
 * routes, and every company-user route via authorizeCompanyUserManager) must
 * call BEFORE doing anything else. Mirrors authorizeGlobalAdmin's
 * own existing service-role requirement below, extracted here so it's
 * directly unit-testable (pure given an env value — no live Supabase call)
 * and shared without each route reimplementing the same two checks.
 *
 * Deliberately does NOT touch authorizeProjectAccess's own
 * `serviceClient || createUserScopedClient(...)` fallback (lib/project-access.ts)
 * — that fallback remains intact for its other callers (expense-report, the
 * Zoho auto-publish trigger authorizer). A route that calls this gate first
 * simply never reaches that fallback branch, since authorizeProjectAccess's
 * own createServiceRoleClient(env) call is guaranteed to succeed once this
 * gate has already passed.
 */
export function requirePrivilegedServiceClient(env: SupabaseServerEnv): PrivilegedServiceClientResult {
  if (env.missingServiceRole.length > 0) {
    return { ok: false, status: 500, error: missingConfigError(env.missingServiceRole) };
  }
  const serviceClient = createServiceRoleClient(env);
  if (!serviceClient) {
    return { ok: false, status: 500, error: missingConfigError(["NEXT_PUBLIC_SUPABASE_URL"]) };
  }
  return { ok: true, serviceClient };
}

export function createUserScopedClient(env: SupabaseServerEnv, accessToken: string): SupabaseClient {
  return createClient(env.url, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function extractBearerToken(req: Request): string {
  const authHeader = req.headers.get("authorization") || "";
  const bearerPrefix = "Bearer ";
  return authHeader.startsWith(bearerPrefix) ? authHeader.slice(bearerPrefix.length).trim() : "";
}

export type CompanyUserManagerReads = {
  verifyAccessToken(accessToken: string): Promise<{ userId: string } | null>;
  loadProfile(userId: string): Promise<{ profile: RequesterProfile | null; error?: boolean }>;
  loadMembership(companyId: string, userId: string): Promise<{ membership: RequesterMembership | null; error?: boolean }>;
  companyExists(companyId: string): Promise<{ exists: boolean; error?: boolean }>;
};

export type CompanyUserManagerDecision =
  | { ok: true; requesterUserId: string; isGlobalAdmin: boolean }
  | { ok: false; status: number; error: string };

const COMPANY_USER_MANAGER_DENIED = "Only global admins or active company admins can manage company users.";

/**
 * Who may manage a company's users (search the directory for it, add existing
 * users, invite): an active global admin, or an ACTIVE user profile holding an
 * ACTIVE admin membership in exactly this company. The company is always the
 * one the route acts on, and the requester always comes from the verified
 * token, never from the request body.
 *
 * - An inactive (or missing) profile is refused for every requester. This
 *   matches decideProjectAccess/decideCompanyAccess in lib/project-access.ts.
 *   Before this, only the global-admin path checked it, so a deactivated
 *   company admin kept user-management authority.
 * - A read failure (e.g. an invalid/unusable service key) is a server error
 *   and never an authorization: it returns 500 and nothing proceeds.
 * - Only a global admin learns whether a non-existent company id exists
 *   (404). For everyone else, a membership is required, and it cannot exist
 *   for a missing company (FK on delete cascade), so they get the same 403 as
 *   any other company they don't administer.
 *
 * Pure given `reads`, so every branch is unit-tested without Supabase
 * (admin-api.test.ts).
 */
export async function decideCompanyUserManager(
  args: { accessToken: string; companyId: string },
  reads: CompanyUserManagerReads,
): Promise<CompanyUserManagerDecision> {
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
  if (profileError) {
    return { ok: false, status: 500, error: "Failed to validate requester permissions." };
  }
  if (!profile) {
    return { ok: false, status: 403, error: "Requester profile not found." };
  }
  if (profile.is_active === false) {
    return { ok: false, status: 403, error: "This user account is not active." };
  }

  if (profile.global_role === "admin") {
    const { exists, error: companyError } = await reads.companyExists(companyId);
    if (companyError) {
      return { ok: false, status: 500, error: "Failed to validate the requested company." };
    }
    if (!exists) {
      return { ok: false, status: 404, error: "Company not found." };
    }
    return { ok: true, requesterUserId: requester.userId, isGlobalAdmin: true };
  }

  const { membership, error: membershipError } = await reads.loadMembership(companyId, requester.userId);
  if (membershipError) {
    return { ok: false, status: 500, error: "Failed to validate requester permissions." };
  }
  if (!membership || membership.role !== "admin" || membership.is_active !== true) {
    return { ok: false, status: 403, error: COMPANY_USER_MANAGER_DENIED };
  }
  return { ok: true, requesterUserId: requester.userId, isGlobalAdmin: false };
}

/** Real reads for decideCompanyUserManager: token verification with the anon key, everything else with the service client. */
export function createCompanyUserManagerReads(env: SupabaseServerEnv, serviceClient: SupabaseClient): CompanyUserManagerReads {
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
    async loadProfile(userId) {
      const { data, error } = await serviceClient
        .from("user_profiles")
        .select("id, global_role, is_active")
        .eq("id", userId)
        .maybeSingle<RequesterProfile>();
      if (error) return { profile: null, error: true };
      return { profile: data ?? null };
    },
    async loadMembership(companyId, userId) {
      const { data, error } = await serviceClient
        .from("company_memberships")
        .select("role, is_active")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .maybeSingle<RequesterMembership>();
      if (error) return { membership: null, error: true };
      return { membership: data ?? null };
    },
    async companyExists(companyId) {
      const { data, error } = await serviceClient.from("companies").select("id").eq("id", companyId).maybeSingle<{ id: string }>();
      if (error) return { exists: false, error: true };
      return { exists: !!data };
    },
  };
}

/**
 * Authorizes a company-user management request (search, add-existing,
 * invite). FAIL CLOSED: it requires the service-role key and never falls back
 * to the caller's own client. The routes it guards read and write across the
 * whole user directory by design, which must never silently run with
 * different credentials. Previously a missing key substituted
 * createUserScopedClient(), which would quietly return partial data or wrong
 * 404s once RLS is enabled. The returned `dataClient` is always the service
 * client.
 */
export async function authorizeCompanyUserManager(args: {
  env: SupabaseServerEnv;
  accessToken: string;
  companyId: string;
}): Promise<
  | {
      ok: true;
      requesterUserId: string;
      dataClient: SupabaseClient;
      isGlobalAdmin: boolean;
    }
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
  const privileged = requirePrivilegedServiceClient(env);
  if (!privileged.ok) return privileged;

  const decision = await decideCompanyUserManager(
    { accessToken, companyId },
    createCompanyUserManagerReads(env, privileged.serviceClient),
  );
  if (!decision.ok) return decision;
  return {
    ok: true,
    requesterUserId: decision.requesterUserId,
    dataClient: privileged.serviceClient,
    isGlobalAdmin: decision.isGlobalAdmin,
  };
}

/**
 * Global-admin-only operations that require the service-role Auth Admin API
 * (e.g. changing a user's login email).
 */
export async function authorizeGlobalAdmin(args: {
  env: SupabaseServerEnv;
  accessToken: string;
}): Promise<
  | {
      ok: true;
      requesterUserId: string;
      serviceClient: SupabaseClient;
    }
  | { ok: false; status: number; error: string }
> {
  const { env, accessToken } = args;
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing authorization token." };
  }
  if (env.missingPublic.length > 0) {
    return {
      ok: false,
      status: 500,
      error: `Server is missing required configuration: ${env.missingPublic.join(", ")}.`,
    };
  }
  if (env.missingServiceRole.length > 0) {
    return { ok: false, status: 500, error: missingConfigError(env.missingServiceRole) };
  }

  const serviceClient = createServiceRoleClient(env);
  if (!serviceClient) {
    return { ok: false, status: 500, error: missingConfigError(["SUPABASE_SERVICE_ROLE_KEY"]) };
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

  const { data: requesterProfile, error: requesterProfileError } = await serviceClient
    .from("user_profiles")
    .select("id, global_role, is_active")
    .eq("id", requesterUser.id)
    .maybeSingle<RequesterProfile>();
  if (requesterProfileError || !requesterProfile) {
    return { ok: false, status: 403, error: "Requester profile not found." };
  }
  if (requesterProfile.global_role !== "admin" || requesterProfile.is_active === false) {
    return { ok: false, status: 403, error: "Only active global admins can perform this action." };
  }

  return {
    ok: true,
    requesterUserId: requesterUser.id,
    serviceClient,
  };
}

export async function findAuthUserByEmail(
  serviceClient: SupabaseClient,
  email: string,
): Promise<{ id: string; email?: string } | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((u) => (u.email || "").trim().toLowerCase() === normalized);
    if (found) return { id: found.id, email: found.email ?? undefined };
    if (users.length < perPage) return null;
    page += 1;
  }
}
