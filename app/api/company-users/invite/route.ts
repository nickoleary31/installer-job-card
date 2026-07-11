import { NextResponse } from "next/server";
import {
  asString,
  authorizeCompanyUserManager,
  createServiceRoleClient,
  extractBearerToken,
  getSupabaseServerEnv,
  isValidEmail,
  isValidRole,
  missingConfigError,
} from "@/lib/company-users/admin-api";

type UserProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  global_role: "admin" | "technician" | null;
  is_active: boolean | null;
};

async function findAuthUserByEmail(
  serviceClient: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  email: string,
): Promise<{ id: string; email?: string } | null> {
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((u) => (u.email || "").trim().toLowerCase() === email);
    if (found) return { id: found.id, email: found.email ?? undefined };
    if (users.length < perPage) return null;
    page += 1;
  }
}

export async function POST(req: Request) {
  const env = getSupabaseServerEnv();

  if (env.missingServiceRole.length > 0) {
    return NextResponse.json({ error: missingConfigError(env.missingServiceRole) }, { status: 500 });
  }
  if (env.missingPublic.length > 0) {
    return NextResponse.json(
      {
        error: `User invitations are unavailable because ${env.missingPublic.join(" and ")} ${
          env.missingPublic.length === 1 ? "is" : "are"
        } not configured on the server.`,
      },
      { status: 500 },
    );
  }

  const serviceClient = createServiceRoleClient(env);
  if (!serviceClient) {
    return NextResponse.json({ error: missingConfigError(["SUPABASE_SERVICE_ROLE_KEY"]) }, { status: 500 });
  }

  let rawBody: { companyId?: unknown; email?: unknown; displayName?: unknown; role?: unknown };
  try {
    rawBody = (await req.json()) as typeof rawBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const companyId = asString(rawBody.companyId).trim();
  const email = asString(rawBody.email).trim().toLowerCase();
  const displayName = asString(rawBody.displayName).trim();
  const role = asString(rawBody.role).trim();

  if (!isValidEmail(email)) return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  if (!isValidRole(role)) return NextResponse.json({ error: "Role must be admin or technician." }, { status: 400 });

  const auth = await authorizeCompanyUserManager({
    env,
    accessToken: extractBearerToken(req),
    companyId,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data: existingProfileRows, error: existingProfileError } = await serviceClient
    .from("user_profiles")
    .select("id, email, display_name, global_role, is_active")
    .ilike("email", email)
    .limit(1);
  if (existingProfileError) {
    return NextResponse.json({ error: existingProfileError.message }, { status: 500 });
  }
  const existingProfile = ((existingProfileRows as UserProfileRow[] | null) || [])[0] || null;

  let targetUserId = existingProfile?.id || "";
  let wasExistingUser = !!existingProfile;
  let operationMessage = "Existing user linked to company.";

  if (!targetUserId) {
    try {
      const existingAuthUser = await findAuthUserByEmail(serviceClient, email);
      if (existingAuthUser?.id) {
        targetUserId = existingAuthUser.id;
        wasExistingUser = true;
        operationMessage = "Existing auth user linked to company.";
        const { error: profileUpsertError } = await serviceClient.from("user_profiles").upsert(
          {
            id: targetUserId,
            email,
            display_name: displayName || null,
            global_role: "technician",
            is_active: true,
          },
          { onConflict: "id" },
        );
        if (profileUpsertError) {
          return NextResponse.json({ error: profileUpsertError.message }, { status: 500 });
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to look up existing auth users.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (!targetUserId) {
    const { data: invitedData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      data: displayName ? { display_name: displayName } : undefined,
    });
    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
    }
    targetUserId = invitedData.user?.id || "";
    if (!targetUserId) {
      return NextResponse.json({ error: "Failed to create invited user." }, { status: 500 });
    }
    operationMessage = "User invited and linked to company.";
    const { error: profileInsertError } = await serviceClient.from("user_profiles").upsert(
      {
        id: targetUserId,
        email,
        display_name: displayName || null,
        global_role: "technician",
        is_active: true,
      },
      { onConflict: "id" },
    );
    if (profileInsertError) {
      return NextResponse.json({ error: profileInsertError.message }, { status: 500 });
    }
  } else if (existingProfile) {
    const { data: existingMembership } = await serviceClient
      .from("company_memberships")
      .select("is_active")
      .eq("company_id", companyId)
      .eq("user_id", targetUserId)
      .maybeSingle<{ is_active: boolean }>();
    if (existingMembership?.is_active) {
      return NextResponse.json({
        ok: true,
        userId: targetUserId,
        existingUser: true,
        alreadyActive: true,
        message: "This user is already an active member of this company. Use Add Existing User instead of inviting again.",
      });
    }
  }

  const { error: membershipError } = await serviceClient.from("company_memberships").upsert(
    {
      company_id: companyId,
      user_id: targetUserId,
      role,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,company_id" },
  );
  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    userId: targetUserId,
    existingUser: wasExistingUser,
    message: operationMessage,
  });
}
