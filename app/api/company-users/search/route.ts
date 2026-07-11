import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  asString,
  authorizeCompanyUserManager,
  extractBearerToken,
  getSupabaseServerEnv,
} from "@/lib/company-users/admin-api";

type MembershipJoinRow = {
  user_id: string;
  company_id: string;
  role: "admin" | "technician";
  is_active: boolean;
  companies: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const env = getSupabaseServerEnv();
  let body: { companyId?: unknown; query?: unknown };
  try {
    body = (await req.json()) as { companyId?: unknown; query?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const companyId = asString(body.companyId).trim();
  const query = asString(body.query).trim();
  if (query.length < 2) {
    return NextResponse.json({ error: "Enter at least 2 characters to search." }, { status: 400 });
  }

  const auth = await authorizeCompanyUserManager({
    env,
    accessToken: extractBearerToken(req),
    companyId,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { dataClient } = auth;
  const pattern = `%${query}%`;
  const isUuid = UUID_RE.test(query);

  const merged = new Map<string, ProfileRow>();

  const { data: byEmail, error: emailError } = await dataClient
    .from("user_profiles")
    .select("id, email, display_name, is_active")
    .ilike("email", pattern)
    .limit(25);
  if (emailError) {
    return NextResponse.json({ error: emailError.message }, { status: 500 });
  }
  for (const row of (byEmail as ProfileRow[] | null) || []) merged.set(row.id, row);

  const { data: byName, error: nameError } = await dataClient
    .from("user_profiles")
    .select("id, email, display_name, is_active")
    .ilike("display_name", pattern)
    .limit(25);
  if (nameError) {
    return NextResponse.json({ error: nameError.message }, { status: 500 });
  }
  for (const row of (byName as ProfileRow[] | null) || []) merged.set(row.id, row);

  if (isUuid) {
    const { data: byId, error: idError } = await dataClient
      .from("user_profiles")
      .select("id, email, display_name, is_active")
      .eq("id", query)
      .limit(1);
    if (idError) {
      return NextResponse.json({ error: idError.message }, { status: 500 });
    }
    for (const row of (byId as ProfileRow[] | null) || []) merged.set(row.id, row);
  }

  const profiles = [...merged.values()]
    .sort((a, b) => {
      const an = (a.display_name || a.email || a.id).toLowerCase();
      const bn = (b.display_name || b.email || b.id).toLowerCase();
      return an.localeCompare(bn);
    })
    .slice(0, 25);

  return respondWithMemberships(dataClient, companyId, profiles);
}

async function respondWithMemberships(dataClient: SupabaseClient, companyId: string, profiles: ProfileRow[]) {
  if (profiles.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const userIds = profiles.map((p) => p.id);
  const { data: membershipData, error: membershipError } = await dataClient
    .from("company_memberships")
    .select("user_id, company_id, role, is_active, companies(id, name)")
    .in("user_id", userIds);
  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  const memberships = (membershipData as MembershipJoinRow[] | null) || [];
  const membershipsByUser = new Map<
    string,
    Array<{ companyId: string; companyName: string; role: string; isActive: boolean }>
  >();
  for (const row of memberships) {
    const companyRel = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    const companyName = companyRel?.name?.trim() || row.company_id.slice(0, 8);
    const list = membershipsByUser.get(row.user_id) || [];
    list.push({
      companyId: row.company_id,
      companyName,
      role: row.role,
      isActive: row.is_active,
    });
    membershipsByUser.set(row.user_id, list);
  }

  const results = profiles.map((profile) => {
    const membershipsForUser = membershipsByUser.get(profile.id) || [];
    const targetMembership = membershipsForUser.find((m) => m.companyId === companyId) || null;
    return {
      userId: profile.id,
      email: profile.email?.trim() || "",
      displayName: profile.display_name?.trim() || profile.email?.trim() || `User ${profile.id.slice(0, 8)}`,
      profileIsActive: profile.is_active !== false,
      companyMemberships: membershipsForUser.map((m) => ({
        companyId: m.companyId,
        companyName: m.companyName,
        role: m.role,
        isActive: m.isActive,
      })),
      targetCompanyMembership: targetMembership
        ? { role: targetMembership.role, isActive: targetMembership.isActive }
        : null,
    };
  });

  return NextResponse.json({ results });
}
