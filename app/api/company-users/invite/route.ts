import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type RequestBody = {
  companyId?: unknown;
  email?: unknown;
  displayName?: unknown;
  role?: unknown;
};

type RequesterProfile = {
  id: string;
  global_role: "admin" | "technician" | null;
};

type RequesterMembership = {
  role: "admin" | "technician";
  is_active: boolean;
};

type UserProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  global_role: "admin" | "technician" | null;
  is_active: boolean | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isValidRole(value: string): value is "admin" | "technician" {
  return value === "admin" || value === "technician";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function findAuthUserByEmail(
  serviceClient: { auth: { admin: { listUsers: (args: { page: number; perPage: number }) => Promise<{ data: { users: Array<{ id: string; email?: string | null }> } | null; error: { message: string } | null }> } } },
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

  if (!serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured for user invitations." }, { status: 500 });
  }
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Server is missing Supabase configuration." }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") || "";
  const bearerPrefix = "Bearer ";
  const token = authHeader.startsWith(bearerPrefix) ? authHeader.slice(bearerPrefix.length).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing authorization token." }, { status: 401 });
  }

  const anonClient = createClient(url, anonKey);
  const serviceClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user: requesterUser },
    error: requesterAuthError,
  } = await anonClient.auth.getUser(token);
  if (requesterAuthError || !requesterUser) {
    return NextResponse.json({ error: "Unauthorized requester." }, { status: 401 });
  }

  let rawBody: RequestBody;
  try {
    rawBody = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const companyId = asString(rawBody.companyId).trim();
  const email = asString(rawBody.email).trim().toLowerCase();
  const displayName = asString(rawBody.displayName).trim();
  const role = asString(rawBody.role).trim();

  if (!companyId) return NextResponse.json({ error: "Company is required." }, { status: 400 });
  if (!isValidEmail(email)) return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  if (!isValidRole(role)) return NextResponse.json({ error: "Role must be admin or technician." }, { status: 400 });

  const { data: requesterProfile, error: requesterProfileError } = await serviceClient
    .from("user_profiles")
    .select("id, global_role")
    .eq("id", requesterUser.id)
    .maybeSingle<RequesterProfile>();
  if (requesterProfileError || !requesterProfile) {
    return NextResponse.json({ error: "Requester profile not found." }, { status: 403 });
  }

  const isGlobalAdmin = requesterProfile.global_role === "admin";
  let isActiveCompanyAdmin = false;
  if (!isGlobalAdmin) {
    const { data: requesterMembership, error: requesterMembershipError } = await serviceClient
      .from("company_memberships")
      .select("role, is_active")
      .eq("company_id", companyId)
      .eq("user_id", requesterUser.id)
      .maybeSingle<RequesterMembership>();
    if (requesterMembershipError) {
      return NextResponse.json({ error: "Failed to validate requester permissions." }, { status: 403 });
    }
    isActiveCompanyAdmin = !!requesterMembership && requesterMembership.role === "admin" && requesterMembership.is_active;
  }

  if (!isGlobalAdmin && !isActiveCompanyAdmin) {
    return NextResponse.json({ error: "Only global admins or active company admins can invite users." }, { status: 403 });
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
  }

  const { error: membershipError } = await serviceClient.from("company_memberships").upsert(
    {
      company_id: companyId,
      user_id: targetUserId,
      role,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,user_id" },
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
