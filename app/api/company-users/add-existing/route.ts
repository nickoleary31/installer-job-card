import { NextResponse } from "next/server";
import {
  asString,
  authorizeCompanyUserManager,
  extractBearerToken,
  getSupabaseServerEnv,
  isValidRole,
} from "@/lib/company-users/admin-api";

type MembershipRow = {
  user_id: string;
  role: "admin" | "technician";
  is_active: boolean;
};

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean | null;
};

export async function POST(req: Request) {
  const env = getSupabaseServerEnv();
  let body: { companyId?: unknown; userId?: unknown; role?: unknown };
  try {
    body = (await req.json()) as { companyId?: unknown; userId?: unknown; role?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const companyId = asString(body.companyId).trim();
  const userId = asString(body.userId).trim();
  const role = asString(body.role).trim();

  if (!userId) {
    return NextResponse.json({ error: "User is required." }, { status: 400 });
  }
  if (!isValidRole(role)) {
    return NextResponse.json({ error: "Role must be admin or technician." }, { status: 400 });
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

  const { data: profile, error: profileError } = await dataClient
    .from("user_profiles")
    .select("id, email, display_name, is_active")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "User profile not found." }, { status: 404 });
  }

  const { data: existingMembership, error: membershipLookupError } = await dataClient
    .from("company_memberships")
    .select("user_id, role, is_active")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle<MembershipRow>();
  if (membershipLookupError) {
    return NextResponse.json({ error: membershipLookupError.message }, { status: 500 });
  }

  if (existingMembership?.is_active) {
    return NextResponse.json({
      ok: true,
      userId,
      alreadyActive: true,
      reactivated: false,
      created: false,
      displayName: profile.display_name?.trim() || profile.email?.trim() || userId,
      email: profile.email?.trim() || "",
      message: "This user is already an active member of this company.",
    });
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await dataClient.from("company_memberships").upsert(
    {
      company_id: companyId,
      user_id: userId,
      role,
      is_active: true,
      updated_at: now,
    },
    { onConflict: "user_id,company_id" },
  );
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const reactivated = !!existingMembership && !existingMembership.is_active;
  return NextResponse.json({
    ok: true,
    userId,
    alreadyActive: false,
    reactivated,
    created: !existingMembership,
    displayName: profile.display_name?.trim() || profile.email?.trim() || userId,
    email: profile.email?.trim() || "",
    message: reactivated
      ? "Existing membership reactivated for this company."
      : "Existing user added to this company.",
  });
}
