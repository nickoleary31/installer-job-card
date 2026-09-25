import type { JobCardSubmissionPayload } from "./job-card-submission.ts";
import { LOCAL_PHOTO_URI_SCHEME } from "./local-photo.ts";

/**
 * Checkpoint 2 — server-side validation of every Storage reference a
 * submission payload carries, so a privileged route (finalize, send-email,
 * evidence) only ever acts on objects that belong to the company/project/
 * submission the requester has been authorized for. Nothing here is
 * "cleaned up" and re-used: an invalid reference rejects the request.
 *
 * Path families (every segment must be a safe path segment — no `/`, `..`,
 * or leading dot):
 *
 *  Photos, bucket job-card-photos (see lib/local-photo.ts's
 *  buildRemotePhotoStoragePath and NewSubmissionForm.tsx's web upload):
 *   - native, current:  company/project/uploaderUser/submission/group/field/photo.ext
 *   - native, pre-Checkpoint-2 (already-stored rows only): company/project/submission/group/field/photo.ext
 *   - web (legacy, still what the PC/Mac app writes today): submission/group/field/file.ext
 *
 *  Product / customer-site files, bucket customer-site-files (see
 *  lib/product-files/storage.ts and lib/ppd-json-storage.ts):
 *   - customer-sites/<customer>/product-files/<product>/<fileKey>/<project>/<file>
 *   - customer-sites/<customer>/ppd-json/<project>/<file>
 */

export const JOB_CARD_PHOTOS_BUCKET = "job-card-photos";
export const PRODUCT_FILES_BUCKET = "customer-site-files";

const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/;
/** Product file names keep dots (extensions) but never separators or traversal. */
const SAFE_FILE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

export function isSafePathSegment(value: string): boolean {
  return SAFE_PATH_SEGMENT.test(value);
}

function isSafeFileSegment(value: string): boolean {
  return SAFE_FILE_SEGMENT.test(value) && !value.startsWith(".") && !value.includes("..");
}

export type StorageScope = {
  companyId: string;
  projectId: string;
  submissionId: string;
  /**
   * When set, a native photo path must name exactly this uploader (the
   * requester finalizing their own submission). When null, any safe uploader
   * segment is accepted — used by send-email, where a company admin may be
   * emailing a technician's submission.
   */
  uploaderUserId: string | null;
  /** Whether the legacy web `submission/...` family is acceptable in this context. */
  allowLegacyWebPhotoPaths: boolean;
};

export type StorageReferenceResult = { ok: true } | { ok: false; error: string };

export function validatePhotoStoragePath(storagePath: string, scope: StorageScope): StorageReferenceResult {
  const path = (storagePath || "").trim();
  if (!path) return { ok: false, error: "A photo is missing its storage path." };
  if (path.startsWith(LOCAL_PHOTO_URI_SCHEME)) {
    return { ok: false, error: "Every photo must be uploaded to remote storage before finalizing this submission." };
  }
  const segments = path.split("/");
  const file = segments[segments.length - 1] ?? "";
  const dot = file.lastIndexOf(".");
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
  const stem = dot > 0 ? file.slice(0, dot) : file;

  const dirs = segments.slice(0, -1);
  if (!dirs.every(isSafePathSegment) || !isSafeFileSegment(file)) {
    return { ok: false, error: `Photo path "${path}" is not a valid storage path.` };
  }

  // Native, current: company/project/uploader/submission/group/field/photo.ext
  if (segments.length === 7) {
    const [companyId, projectId, uploaderUserId, submissionId] = segments;
    const uploaderOk = scope.uploaderUserId ? uploaderUserId === scope.uploaderUserId : isSafePathSegment(uploaderUserId);
    if (
      companyId === scope.companyId &&
      projectId === scope.projectId &&
      uploaderOk &&
      submissionId === scope.submissionId &&
      isSafePathSegment(stem) &&
      PHOTO_EXTENSIONS.has(ext)
    ) {
      return { ok: true };
    }
    return { ok: false, error: `Photo path "${path}" is outside this submission's authorized storage scope.` };
  }

  // Native, pre-Checkpoint-2: company/project/submission/group/field/photo.ext
  if (segments.length === 6 && !scope.uploaderUserId) {
    const [companyId, projectId, submissionId] = segments;
    if (companyId === scope.companyId && projectId === scope.projectId && submissionId === scope.submissionId && PHOTO_EXTENSIONS.has(ext)) {
      return { ok: true };
    }
    return { ok: false, error: `Photo path "${path}" is outside this submission's authorized storage scope.` };
  }

  // Web: submission/group/field/file
  if (segments.length === 4 && scope.allowLegacyWebPhotoPaths) {
    if (segments[0] === scope.submissionId) return { ok: true };
    return { ok: false, error: `Photo path "${path}" belongs to a different submission.` };
  }

  return { ok: false, error: `Photo path "${path}" is outside this submission's authorized storage scope.` };
}

export function validateProductFileReference(
  file: { storageBucket?: string | null; storagePath?: string | null },
  scope: Pick<StorageScope, "projectId">,
): StorageReferenceResult {
  const bucket = (file.storageBucket || "").trim() || PRODUCT_FILES_BUCKET;
  const path = (file.storagePath || "").trim();
  if (bucket !== PRODUCT_FILES_BUCKET) {
    return { ok: false, error: `Product file bucket "${bucket}" is not allowed.` };
  }
  if (!path) return { ok: false, error: "A product file is missing its storage path." };
  const segments = path.split("/");
  const dirs = segments.slice(0, -1);
  const file_ = segments[segments.length - 1] ?? "";
  if (!dirs.every(isSafePathSegment) || !isSafeFileSegment(file_)) {
    return { ok: false, error: `Product file path "${path}" is not a valid storage path.` };
  }
  // customer-sites/<customer>/product-files/<product>/<fileKey>/<project>/<file>
  if (segments.length === 7 && segments[0] === "customer-sites" && segments[2] === "product-files" && segments[5] === scope.projectId) {
    return { ok: true };
  }
  // customer-sites/<customer>/ppd-json/<project>/<file>
  if (segments.length === 5 && segments[0] === "customer-sites" && segments[2] === "ppd-json" && segments[3] === scope.projectId) {
    return { ok: true };
  }
  return { ok: false, error: `Product file path "${path}" is outside this project's authorized storage scope.` };
}

/**
 * Validates every Storage reference in the payload against the verified
 * scope. Pure; the caller decides what status to return. Checks
 * photoUploads[], productFiles[] (bucket + path) and the deprecated
 * ppd.jsonConfigFile mirror (path, plus its own companyId/projectId when
 * present).
 */
export function validatePayloadStorageReferences(
  payload: Pick<JobCardSubmissionPayload, "photoUploads" | "productFiles" | "ppd">,
  scope: StorageScope,
): StorageReferenceResult {
  for (const photo of payload.photoUploads || []) {
    const result = validatePhotoStoragePath(photo?.storagePath ?? "", scope);
    if (!result.ok) return result;
  }
  for (const file of payload.productFiles || []) {
    const result = validateProductFileReference(file ?? {}, scope);
    if (!result.ok) return result;
  }
  const mirror = payload.ppd?.jsonConfigFile;
  if (mirror && (mirror.storagePath?.trim() || mirror.publicUrl?.trim())) {
    if ((mirror.companyId && mirror.companyId !== scope.companyId) || (mirror.projectId && mirror.projectId !== scope.projectId)) {
      return { ok: false, error: "The PPD configuration file belongs to a different company or project." };
    }
    const result = validateProductFileReference({ storageBucket: PRODUCT_FILES_BUCKET, storagePath: mirror.storagePath }, scope);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** The public object URL Supabase Storage serves for a public-bucket path — re-derived server-side, never trusted from a client. */
export function buildPublicPhotoUrl(supabaseUrl: string, storagePath: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${JOB_CARD_PHOTOS_BUCKET}/${storagePath}`;
}

/** The prefix every legitimate signed download URL for a product file starts with. */
export function productFileSignedUrlPrefix(supabaseUrl: string, storagePath: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/sign/${PRODUCT_FILES_BUCKET}/${storagePath}`;
}

/**
 * Returns a copy of the payload whose derived URLs are rebuilt from the
 * (already validated) storage paths: photo publicUrl is always re-derived;
 * a product file's downloadUrl is kept only when it is a signed URL for its
 * own path, otherwise dropped. Text content is untouched.
 */
export function normalizePayloadStorageUrls<T extends Pick<JobCardSubmissionPayload, "photoUploads" | "productFiles" | "ppd">>(
  payload: T,
  supabaseUrl: string,
): T {
  const photoUploads = (payload.photoUploads || []).map((photo) => ({
    ...photo,
    publicUrl: buildPublicPhotoUrl(supabaseUrl, photo.storagePath),
  }));
  const productFiles = payload.productFiles?.map((file) => {
    const downloadUrl = (file.downloadUrl || "").trim();
    const keep = downloadUrl && downloadUrl.startsWith(productFileSignedUrlPrefix(supabaseUrl, file.storagePath));
    if (keep) return file;
    const rest = { ...file };
    delete rest.downloadUrl;
    return rest;
  });
  const mirror = payload.ppd?.jsonConfigFile;
  const ppd =
    payload.ppd && mirror
      ? {
          ...payload.ppd,
          jsonConfigFile: {
            ...mirror,
            publicUrl:
              mirror.publicUrl && mirror.publicUrl.startsWith(productFileSignedUrlPrefix(supabaseUrl, mirror.storagePath))
                ? mirror.publicUrl
                : "",
          },
        }
      : payload.ppd;
  return { ...payload, photoUploads, ...(productFiles ? { productFiles } : {}), ...(ppd ? { ppd } : {}) };
}
