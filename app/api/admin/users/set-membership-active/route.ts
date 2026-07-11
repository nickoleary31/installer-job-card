import { NextResponse } from "next/server";
import {
  asString,
  authorizeGlobalAdmin,
  extractBearerToken,
  getSupabaseServerEnv,
} from "@/lib/company-users/admin-api";

export async function POST(req: Request) {
  const env = getSupabaseServerEnv();
  let body: { userId?: unknown; companyId?: unknown; isActive?: unknown };
  try {
    body = (await req.json()) as { userId?: unknown; companyId?: unknown; isActive?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userId = asString(body.userId).trim();
  const companyId = asString(body.companyId).trim();
  const isActive = body.isActive === true;

  if (!userId) {
    return NextResponse.json({ error: "User is required." }, { status: 400 });
  }
  if (!companyId) {
    return NextResponse.json({ error: "Company is required." }, { status: 400 });
  }

  const auth = await authorizeGlobalAdmin({
    env,
    accessToken: extractBearerToken(req),
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data: existing, error: lookupError } = await auth.serviceClient
    .from("company_memberships")
    .select("user_id, company_id, is_active")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle<{ user_id: string; company_id: string; is_active: boolean }>();
  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Company membership not found." }, { status: 404 });
  }

  if (existing.is_active === isActive) {
    return NextResponse.json({
      ok: true,
      userId,
      companyId,
      isActive,
      unchanged: true,
      message: isActive
        ? "Membership is already active for this company."
        : "Membership is already inactive for this company.",
    });
  }

  const { error: updateError } = await auth.serviceClient
    .from("company_memberships")
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("company_id", companyId);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    userId,
    companyId,
    isActive,
    message: isActive
      ? "Company membership reactivated. Auth user and other company memberships were not changed."
      : "Company membership deactivated. Auth user and other company memberships were not changed.",
  });
}
