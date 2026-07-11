import { NextResponse } from "next/server";
import {
  authorizeGlobalAdmin,
  extractBearerToken,
  getSupabaseServerEnv,
} from "@/lib/company-users/admin-api";

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  global_role: "admin" | "technician";
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type MembershipJoinRow = {
  user_id: string;
  company_id: string;
  role: "admin" | "technician";
  is_active: boolean;
  created_at: string | null;
  companies: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
};

function normalizeEmail(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

export async function GET(req: Request) {
  const env = getSupabaseServerEnv();
  const auth = await authorizeGlobalAdmin({
    env,
    accessToken: extractBearerToken(req),
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { serviceClient } = auth;

  const { data: profileData, error: profileError } = await serviceClient
    .from("user_profiles")
    .select("id, email, display_name, global_role, is_active, created_at, updated_at")
    .order("display_name", { ascending: true });
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  const profiles = (profileData as ProfileRow[] | null) || [];

  const { data: membershipData, error: membershipError } = await serviceClient
    .from("company_memberships")
    .select("user_id, company_id, role, is_active, created_at, companies(id, name)")
    .order("created_at", { ascending: true });
  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }
  const memberships = (membershipData as MembershipJoinRow[] | null) || [];

  const membershipsByUser = new Map<
    string,
    Array<{
      companyId: string;
      companyName: string;
      role: "admin" | "technician";
      isActive: boolean;
      createdAt: string | null;
    }>
  >();
  for (const row of memberships) {
    const companyRel = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    const list = membershipsByUser.get(row.user_id) || [];
    list.push({
      companyId: row.company_id,
      companyName: companyRel?.name?.trim() || row.company_id.slice(0, 8),
      role: row.role,
      isActive: row.is_active,
      createdAt: row.created_at,
    });
    membershipsByUser.set(row.user_id, list);
  }

  /** Auth metadata keyed by Auth UID (same as user_profiles.id). Never overwrite with profile email. */
  const authEmailById = new Map<string, string>();
  const lastSignInById = new Map<string, string | null>();
  const authCreatedById = new Map<string, string | null>();
  try {
    let page = 1;
    const perPage = 200;
    while (true) {
      const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const users = data?.users || [];
      for (const u of users) {
        authEmailById.set(u.id, (u.email || "").trim());
        lastSignInById.set(u.id, u.last_sign_in_at ?? null);
        authCreatedById.set(u.id, u.created_at ?? null);
      }
      if (users.length < perPage) break;
      page += 1;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load Auth user metadata.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const users = profiles.map((profile) => {
    const authEmail = authEmailById.get(profile.id) || "";
    const profileEmail = profile.email?.trim() || "";
    const authNorm = normalizeEmail(authEmail);
    const profileNorm = normalizeEmail(profileEmail);
    const emailMismatch = Boolean(authNorm || profileNorm) && authNorm !== profileNorm;

    return {
      userId: profile.id,
      authEmail,
      profileEmail,
      emailMismatch,
      displayName:
        profile.display_name?.trim() ||
        authEmail ||
        profileEmail ||
        `User ${profile.id.slice(0, 8)}`,
      globalRole: profile.global_role,
      isActive: profile.is_active,
      createdAt: profile.created_at || authCreatedById.get(profile.id) || null,
      lastSignInAt: lastSignInById.get(profile.id) || null,
      companyMemberships: membershipsByUser.get(profile.id) || [],
    };
  });

  return NextResponse.json({ users });
}
