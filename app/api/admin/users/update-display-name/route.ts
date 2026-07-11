import { NextResponse } from "next/server";
import {
  asString,
  authorizeGlobalAdmin,
  extractBearerToken,
  getSupabaseServerEnv,
} from "@/lib/company-users/admin-api";

export async function POST(req: Request) {
  const env = getSupabaseServerEnv();
  let body: { userId?: unknown; displayName?: unknown };
  try {
    body = (await req.json()) as { userId?: unknown; displayName?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userId = asString(body.userId).trim();
  const displayName = asString(body.displayName).trim();
  if (!userId) {
    return NextResponse.json({ error: "User is required." }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: "Display name is required." }, { status: 400 });
  }

  const auth = await authorizeGlobalAdmin({
    env,
    accessToken: extractBearerToken(req),
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { error } = await auth.serviceClient
    .from("user_profiles")
    .update({
      display_name: displayName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    userId,
    displayName,
    message: "Display name updated.",
  });
}
