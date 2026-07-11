import { NextResponse } from "next/server";
import {
  authorizeGlobalAdmin,
  extractBearerToken,
  getSupabaseServerEnv,
} from "@/lib/company-users/admin-api";

export async function GET(req: Request) {
  const env = getSupabaseServerEnv();
  const auth = await authorizeGlobalAdmin({
    env,
    accessToken: extractBearerToken(req),
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.serviceClient
    .from("companies")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const companies = ((data as Array<{ id: string; name: string | null }> | null) || []).map((row) => ({
    id: row.id,
    name: row.name?.trim() || row.id.slice(0, 8),
  }));

  return NextResponse.json({ companies });
}
