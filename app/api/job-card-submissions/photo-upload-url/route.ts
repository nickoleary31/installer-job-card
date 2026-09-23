import { NextResponse } from "next/server";
import { extractBearerToken, getSupabaseServerEnv } from "@/lib/company-users/admin-api";
import { handlePhotoUploadUrlRequest } from "@/lib/job-card-submissions/photo-upload-url";
import { createPhotoUploadAccess } from "@/lib/job-card-submissions/photo-upload-url-server";

export const maxDuration = 30;

type RequestBody = {
  companyId?: unknown;
  projectId?: unknown;
  localSubmissionId?: unknown;
  localPhotoId?: unknown;
  fieldName?: unknown;
  group?: unknown;
  mimeType?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Phase 2H — returns a signed, retry-safe upload URL for exactly one
 * photo, at a path this route derives/validates itself from stable
 * identity (never a client-supplied path). Thin wrapper — see
 * lib/job-card-submissions/photo-upload-url.ts for the actual,
 * unit-tested request-handling logic (photo-upload-url.test.ts) and
 * photo-upload-url-server.ts for the real Supabase Storage wiring.
 */
export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const env = getSupabaseServerEnv();
  const result = await handlePhotoUploadUrlRequest(
    {
      accessToken: extractBearerToken(req),
      companyId: asString(body.companyId).trim(),
      projectId: asString(body.projectId).trim(),
      localSubmissionId: asString(body.localSubmissionId),
      localPhotoId: asString(body.localPhotoId),
      fieldName: asString(body.fieldName),
      group: asString(body.group),
      mimeType: asString(body.mimeType),
    },
    createPhotoUploadAccess(env),
  );
  return NextResponse.json(result.body, { status: result.status });
}
