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

/**
 * Resolve requester from JWT. Prefer service-role client for profile/membership reads when available
 * so permission checks stay reliable; fall back to the caller's scoped client.
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

  const isGlobalAdmin =
    requesterProfile.global_role === "admin" && requesterProfile.is_active !== false;
  if (!isGlobalAdmin) {
    const { data: requesterMembership, error: requesterMembershipError } = await dataClient
      .from("company_memberships")
      .select("role, is_active")
      .eq("company_id", companyId)
      .eq("user_id", requesterUser.id)
      .maybeSingle<RequesterMembership>();
    if (requesterMembershipError) {
      return { ok: false, status: 403, error: "Failed to validate requester permissions." };
    }
    const isActiveCompanyAdmin =
      !!requesterMembership && requesterMembership.role === "admin" && requesterMembership.is_active;
    if (!isActiveCompanyAdmin) {
      return {
        ok: false,
        status: 403,
        error: "Only global admins or active company admins can manage company users.",
      };
    }
  }

  return {
    ok: true,
    requesterUserId: requesterUser.id,
    dataClient,
    isGlobalAdmin,
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
