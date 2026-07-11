import { NextResponse } from "next/server";
import {
  asString,
  authorizeGlobalAdmin,
  extractBearerToken,
  findAuthUserByEmail,
  getSupabaseServerEnv,
  isValidEmail,
} from "@/lib/company-users/admin-api";

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  global_role: "admin" | "technician";
  is_active: boolean;
};

export async function POST(req: Request) {
  const env = getSupabaseServerEnv();

  let body: { userId?: unknown; newEmail?: unknown };
  try {
    body = (await req.json()) as { userId?: unknown; newEmail?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userId = asString(body.userId).trim();
  const newEmail = asString(body.newEmail).trim().toLowerCase();

  if (!userId) {
    return NextResponse.json({ error: "User is required." }, { status: 400 });
  }
  if (!isValidEmail(newEmail)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const auth = await authorizeGlobalAdmin({
    env,
    accessToken: extractBearerToken(req),
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { serviceClient, requesterUserId } = auth;
  /** Self-service is allowed: a global admin may change their own login email. */
  const isSelfUpdate = requesterUserId === userId;

  const { data: profile, error: profileError } = await serviceClient
    .from("user_profiles")
    .select("id, email, display_name, global_role, is_active")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "User profile not found." }, { status: 404 });
  }

  const preservedGlobalRole = profile.global_role;
  const preservedIsActive = profile.is_active;

  const { data: authUser, error: getUserError } = await serviceClient.auth.admin.getUserById(userId);
  if (getUserError || !authUser?.user) {
    return NextResponse.json(
      { error: getUserError?.message || "Auth user not found for this profile." },
      { status: 404 },
    );
  }

  const currentAuthEmail = (authUser.user.email || "").trim().toLowerCase();
  if (currentAuthEmail && currentAuthEmail === newEmail) {
    // Auth already has this login email — still ensure profile matches.
    const profileAlreadyMatches = (profile.email || "").trim().toLowerCase() === newEmail;
    if (!profileAlreadyMatches) {
      const { error: syncProfileError } = await serviceClient
        .from("user_profiles")
        .update({
          email: newEmail,
          global_role: preservedGlobalRole,
          is_active: preservedIsActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);
      if (syncProfileError) {
        return NextResponse.json(
          {
            error: `Auth login email already matched, but profile email failed to update: ${syncProfileError.message}`,
          },
          { status: 500 },
        );
      }
      return NextResponse.json({
        ok: true,
        userId,
        email: newEmail,
        selfUpdate: isSelfUpdate,
        message: isSelfUpdate
          ? "Your Auth login email was already set; profile email was updated to match."
          : "Auth login email was already set; profile email was updated to match.",
      });
    }
    return NextResponse.json({
      ok: true,
      userId,
      email: newEmail,
      unchanged: true,
      selfUpdate: isSelfUpdate,
      message: isSelfUpdate
        ? "Your login email is already set to this address."
        : "Login email is already set to this address.",
    });
  }

  const { data: profileConflictRows, error: profileConflictError } = await serviceClient
    .from("user_profiles")
    .select("id, email")
    .ilike("email", newEmail)
    .neq("id", userId)
    .limit(1);
  if (profileConflictError) {
    return NextResponse.json({ error: profileConflictError.message }, { status: 500 });
  }
  if (((profileConflictRows as Array<{ id: string }> | null) || []).length > 0) {
    return NextResponse.json(
      { error: "That email is already used by another user profile." },
      { status: 409 },
    );
  }

  let existingAuthUser: { id: string; email?: string } | null = null;
  try {
    existingAuthUser = await findAuthUserByEmail(serviceClient, newEmail);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to check existing Auth users.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  // Same Auth user (self or target) keeping/claiming their own address is fine.
  if (existingAuthUser && existingAuthUser.id !== userId) {
    return NextResponse.json(
      { error: "That email is already used by another Auth user." },
      { status: 409 },
    );
  }

  // Auth update by id — UUID is unchanged.
  const { error: updateAuthError } = await serviceClient.auth.admin.updateUserById(userId, {
    email: newEmail,
    email_confirm: true,
  });
  if (updateAuthError) {
    return NextResponse.json({ error: updateAuthError.message }, { status: 500 });
  }

  // Profile email only — explicitly re-assert global_role / is_active so they cannot be cleared.
  const { error: updateProfileError } = await serviceClient
    .from("user_profiles")
    .update({
      email: newEmail,
      global_role: preservedGlobalRole,
      is_active: preservedIsActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (updateProfileError) {
    return NextResponse.json(
      {
        error: `Auth email was updated, but profile email failed to update: ${updateProfileError.message}`,
      },
      { status: 500 },
    );
  }

  const { data: verifiedProfile, error: verifyError } = await serviceClient
    .from("user_profiles")
    .select("id, global_role, is_active, email")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();
  if (verifyError || !verifiedProfile) {
    return NextResponse.json(
      { error: verifyError?.message || "Failed to verify profile after email update." },
      { status: 500 },
    );
  }
  if (verifiedProfile.global_role !== preservedGlobalRole) {
    await serviceClient
      .from("user_profiles")
      .update({
        global_role: preservedGlobalRole,
        is_active: preservedIsActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (preservedGlobalRole === "admin") {
      const { count: remainingAdmins } = await serviceClient
        .from("user_profiles")
        .select("id", { count: "exact", head: true })
        .eq("global_role", "admin")
        .eq("is_active", true);
      if ((remainingAdmins ?? 0) < 1) {
        await serviceClient
          .from("user_profiles")
          .update({
            global_role: "admin",
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
      }
    }

    return NextResponse.json(
      {
        error:
          "Login email was updated, but global role changed unexpectedly and was restored. Verify the account before continuing.",
      },
      { status: 500 },
    );
  }

  const message = isSelfUpdate
    ? "Your login email was updated. Sign out and sign back in using the new email before continuing."
    : "Login email updated. The user must sign out and log back in with the new email.";

  return NextResponse.json({
    ok: true,
    userId,
    email: newEmail,
    previousEmail: profile.email?.trim() || null,
    selfUpdate: isSelfUpdate,
    globalRole: verifiedProfile.global_role,
    message,
  });
}
