import { NextResponse } from "next/server";
import { extractBearerToken, getSupabaseServerEnv } from "@/lib/company-users/admin-api";
import { handleHistoryRequest } from "@/lib/job-card-submissions/history";
import { createHistoryAccess } from "@/lib/job-card-submissions/history-server";

export const maxDuration = 30;

/**
 * Phase 2H — the native Submitted screen's server source. Thin wrapper —
 * see lib/job-card-submissions/history.ts for the actual, unit-tested
 * request-handling logic (history.test.ts) and history-server.ts for the
 * real Supabase wiring.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const env = getSupabaseServerEnv();
  const result = await handleHistoryRequest(
    {
      accessToken: extractBearerToken(req),
      companyId: url.searchParams.get("companyId")?.trim() || "",
      projectId: url.searchParams.get("projectId")?.trim() || "",
    },
    createHistoryAccess(env),
  );
  return NextResponse.json(result.body, { status: result.status });
}
