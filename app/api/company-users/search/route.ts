import { NextResponse } from "next/server";
import { asString, extractBearerToken, getSupabaseServerEnv } from "@/lib/company-users/admin-api";
import { handleCompanyUserSearch } from "@/lib/company-users/company-user-search";
import { createCompanyUserSearchDeps } from "@/lib/company-users/company-user-routes-server";

/**
 * Directory search for adding existing users to ONE company. Authorization,
 * fail-closed behavior and the response contract live in
 * lib/company-users/company-user-search.ts (handleCompanyUserSearch).
 */
export async function POST(req: Request) {
  let body: { companyId?: unknown; query?: unknown };
  try {
    body = (await req.json()) as { companyId?: unknown; query?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const result = await handleCompanyUserSearch(
    {
      accessToken: extractBearerToken(req),
      companyId: asString(body.companyId),
      query: asString(body.query),
    },
    createCompanyUserSearchDeps(getSupabaseServerEnv()),
  );
  return NextResponse.json(result.body, { status: result.status });
}
