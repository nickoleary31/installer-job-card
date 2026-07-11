import { NextResponse } from "next/server";
import {
  asString,
  authorizeGlobalAdmin,
  extractBearerToken,
  getSupabaseServerEnv,
} from "@/lib/company-users/admin-api";

type ProfileRow = {
  id: string;
  email: string | null;
  global_role: "admin" | "technician";
  is_active: boolean;
};

/**
 * Copies auth.users.email → user_profiles.email.
 * Does not change the Auth login email.
 */
export async function POST(req: Request) {
  const env = getSupabaseServerEnv();

  let body: { userId?: unknown };
  try {
    body = (await req.json()) as { userId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userId = asString(body.userId).trim();
  if (!userId) {
    return NextResponse.json({ error: "User is required." }, { status: 400 });
  }

  const auth = await authorizeGlobalAdmin({
    env,
    accessToken: extractBearerToken(req),
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { serviceClient } = auth;

  const { data: authUser, error: getUserError } = await serviceClient.auth.admin.getUserById(userId);
  if (getUserError || !authUser?.user) {
    return NextResponse.json(
      { error: getUserError?.message || "Auth user not found for this profile." },
      { status: 404 },
    );
  }

  const authEmail = (authUser.user.email || "").trim().toLowerCase();
  if (!authEmail) {
    return NextResponse.json(
      { error: "Auth user has no login email to sync from." },
      { status: 400 },
    );
  }

  const { data: profile, error: profileError } = await serviceClient
    .from("user_profiles")
    .select("id, email, global_role, is_active")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "User profile not found." }, { status: 404 });
  }

  const previousProfileEmail = profile.email?.trim() || null;
  const alreadySynced = (previousProfileEmail || "").toLowerCase() === authEmail;
  if (alreadySynced) {
    return NextResponse.json({
      ok: true,
      userId,
      authEmail,
      profileEmail: authEmail,
      unchanged: true,
      message: "Profile email already matches the Auth login email.",
    });
  }

  const { error: updateError } = await serviceClient
    .from("user_profiles")
    .update({
      email: authEmail,
      global_role: profile.global_role,
      is_active: profile.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    userId,
    authEmail,
    profileEmail: authEmail,
    previousProfileEmail,
    message: "Profile email synced to Auth login email. Login was not changed.",
  });
}
