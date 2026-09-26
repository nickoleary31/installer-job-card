import { NextResponse } from "next/server";
import { asString, extractBearerToken, getSupabaseServerEnv } from "@/lib/company-users/admin-api";
import { handleAddExistingUser } from "@/lib/company-users/add-existing-user";
import { createAddExistingDeps } from "@/lib/company-users/company-user-routes-server";

/**
 * Adds or reactivates an existing user in ONE company. Authorization,
 * fail-closed behavior and the response contract live in
 * lib/company-users/add-existing-user.ts (handleAddExistingUser).
 */
export async function POST(req: Request) {
  let body: { companyId?: unknown; userId?: unknown; role?: unknown };
  try {
    body = (await req.json()) as { companyId?: unknown; userId?: unknown; role?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const result = await handleAddExistingUser(
    {
      accessToken: extractBearerToken(req),
      companyId: asString(body.companyId),
      userId: asString(body.userId),
      role: asString(body.role),
    },
    createAddExistingDeps(getSupabaseServerEnv()),
  );
  return NextResponse.json(result.body, { status: result.status });
}
