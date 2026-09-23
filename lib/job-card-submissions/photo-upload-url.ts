import { buildRemotePhotoStoragePath } from "../local-photo.ts";

/**
 * Phase 2H's signed-upload-URL boundary, split into an injectable-dependency
 * core (this file) and a thin Next.js route wrapper
 * (app/api/job-card-submissions/photo-upload-url/route.ts) — same shape as
 * finalize.ts. See buildRemotePhotoStoragePath's own doc for why the path
 * is derived/validated HERE, server-side, from stable identity inputs only
 * — a client never supplies a path directly, so there is no client-facing
 * field this route even reads to override it.
 */

const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface PhotoStorageRepo {
  createSignedUploadUrl(path: string): Promise<{ path: string; token: string } | { error: string }>;
}

export type PhotoUploadAuthResult = { ok: true; storage: PhotoStorageRepo } | { ok: false; status: number; error: string };

export interface PhotoUploadAccess {
  authorize(args: { accessToken: string; companyId: string; projectId: string }): Promise<PhotoUploadAuthResult>;
}

export type PhotoUploadRequestInput = {
  accessToken: string;
  companyId: string;
  projectId: string;
  localSubmissionId: string;
  localPhotoId: string;
  fieldName: string;
  group: string;
  mimeType: string;
};

export type PhotoUploadResult = { status: number; body: Record<string, unknown> };

/** No `/`, no `..`, no leading dot — every one of these becomes a raw path segment in buildRemotePhotoStoragePath. Pure, exported for direct unit coverage. */
export function isSafePathSegment(value: string): boolean {
  return SAFE_PATH_SEGMENT.test(value);
}

export async function handlePhotoUploadUrlRequest(
  input: PhotoUploadRequestInput,
  access: PhotoUploadAccess,
): Promise<PhotoUploadResult> {
  if (
    !input.companyId ||
    !input.projectId ||
    !input.localSubmissionId ||
    !input.localPhotoId ||
    !input.fieldName ||
    !input.group ||
    !isSafePathSegment(input.companyId) ||
    !isSafePathSegment(input.projectId) ||
    !isSafePathSegment(input.localSubmissionId) ||
    !isSafePathSegment(input.localPhotoId) ||
    !isSafePathSegment(input.fieldName) ||
    !isSafePathSegment(input.group)
  ) {
    return {
      status: 400,
      body: {
        error:
          "companyId, projectId, localSubmissionId, localPhotoId, fieldName, and group are required and must be simple identifiers.",
      },
    };
  }
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    return { status: 400, body: { error: "mimeType must be one of image/jpeg, image/png, image/webp." } };
  }

  const auth = await access.authorize(input);
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } };
  }

  // companyId/projectId are safe to use for the Storage path here ONLY
  // because access.authorize() just succeeded — i.e. authorizeProjectAccess
  // already proved project.company_id === input.companyId AND the
  // requester's access to that pair (see project-access.ts's
  // verifyProjectBelongsToCompany). Never derive this path from unverified
  // client input alone.
  const path = buildRemotePhotoStoragePath(
    input.companyId,
    input.projectId,
    input.localSubmissionId,
    input.group,
    input.fieldName,
    input.localPhotoId,
    input.mimeType,
  );
  const result = await auth.storage.createSignedUploadUrl(path);
  if ("error" in result) {
    return { status: 500, body: { error: result.error || "Could not create a signed upload URL." } };
  }
  return { status: 200, body: { path: result.path, token: result.token } };
}
