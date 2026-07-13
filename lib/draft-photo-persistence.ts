import type { UploadedPhotoMetadata } from "@/lib/job-card-submission";

export type DraftPhotoSaveStage =
  | "idle"
  | "saving_form"
  | "uploading_photos"
  | "verifying"
  | "saved"
  | "failed";

export type PhotoPersistStatus = "local_only" | "uploading" | "saved" | "failed";

export type DraftPhotoSaveDiagnostic = {
  stage: string;
  draftId: string;
  projectId?: string;
  formId?: string;
  userId?: string | null;
  existingRefCount: number;
  incomingRefCount: number;
  mergedRefCount: number;
  uploadSuccessCount?: number;
  uploadFailureCount?: number;
  thinPayloadProtected?: boolean;
  errorCategory?: string;
};

/** Extract durable photo uploads from a draft payload (top-level or photoSummary). */
export function extractPhotoUploadsFromPayload(payload: unknown): UploadedPhotoMetadata[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as {
    photoUploads?: unknown;
    photoSummary?: { photoUploads?: unknown };
  };
  const top = Array.isArray(p.photoUploads) ? (p.photoUploads as UploadedPhotoMetadata[]) : [];
  const nested = Array.isArray(p.photoSummary?.photoUploads)
    ? (p.photoSummary!.photoUploads as UploadedPhotoMetadata[])
    : [];
  return dedupePhotoUploadsByStoragePath([...top, ...nested]);
}

export function dedupePhotoUploadsByStoragePath(items: UploadedPhotoMetadata[]): UploadedPhotoMetadata[] {
  const byPath = new Map<string, UploadedPhotoMetadata>();
  for (const item of items) {
    const sp = String(item?.storagePath || "").trim();
    if (!sp) continue;
    if (!byPath.has(sp)) byPath.set(sp, item);
  }
  return [...byPath.values()];
}

/**
 * Merge cloud + in-memory durable photo refs by storagePath.
 * Never treats a thinner incoming list as authoritative over cloud.
 */
export function mergeDurablePhotoUploads(args: {
  cloudUploads: UploadedPhotoMetadata[];
  memoryUploads: UploadedPhotoMetadata[];
  newlyUploaded?: UploadedPhotoMetadata[];
}): {
  merged: UploadedPhotoMetadata[];
  thinPayloadProtected: boolean;
  existingRefCount: number;
  incomingRefCount: number;
  mergedRefCount: number;
} {
  const cloud = dedupePhotoUploadsByStoragePath(args.cloudUploads || []);
  const memory = dedupePhotoUploadsByStoragePath(args.memoryUploads || []);
  const newly = dedupePhotoUploadsByStoragePath(args.newlyUploaded || []);
  const incomingCombined = dedupePhotoUploadsByStoragePath([...memory, ...newly]);
  const thinPayloadProtected = cloud.length > 0 && incomingCombined.length < cloud.length;
  const merged = dedupePhotoUploadsByStoragePath([...cloud, ...incomingCombined]);
  return {
    merged,
    thinPayloadProtected,
    existingRefCount: cloud.length,
    incomingRefCount: incomingCombined.length,
    mergedRefCount: merged.length,
  };
}

/** Apply merged photoUploads onto payload without dropping unrelated fields. */
export function applyMergedPhotoUploadsToPayload<T extends Record<string, unknown>>(
  payload: T,
  merged: UploadedPhotoMetadata[],
): T {
  const next = { ...payload, photoUploads: merged } as T & {
    photoUploads: UploadedPhotoMetadata[];
    photoSummary?: Record<string, unknown>;
  };
  if (next.photoSummary && typeof next.photoSummary === "object") {
    next.photoSummary = { ...next.photoSummary, photoUploads: merged };
  } else {
    next.photoSummary = { photoUploads: merged };
  }
  return next as T;
}

export function verifyMergedStoragePathsPresent(
  savedPayload: unknown,
  expectedPaths: string[],
): { ok: boolean; missing: string[]; savedCount: number } {
  const saved = extractPhotoUploadsFromPayload(savedPayload);
  const savedSet = new Set(saved.map((u) => String(u.storagePath || "").trim()).filter(Boolean));
  const missing = expectedPaths
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !savedSet.has(p));
  return { ok: missing.length === 0, missing, savedCount: savedSet.size };
}

/** Safe diagnostic logger — never logs URLs, tokens, or image contents. */
export function logDraftPhotoSaveDiagnostic(diag: DraftPhotoSaveDiagnostic): void {
  console.info("[draft-photo-save]", {
    stage: diag.stage,
    draftId: diag.draftId,
    projectId: diag.projectId || "",
    formId: diag.formId || "",
    userId: diag.userId || "",
    existingRefCount: diag.existingRefCount,
    incomingRefCount: diag.incomingRefCount,
    mergedRefCount: diag.mergedRefCount,
    uploadSuccessCount: diag.uploadSuccessCount ?? null,
    uploadFailureCount: diag.uploadFailureCount ?? null,
    thinPayloadProtected: diag.thinPayloadProtected ?? false,
    errorCategory: diag.errorCategory || null,
  });
}

export function draftSaveStageLabel(stage: DraftPhotoSaveStage): string {
  switch (stage) {
    case "saving_form":
      return "Saving form data…";
    case "uploading_photos":
      return "Uploading photos…";
    case "verifying":
      return "Verifying saved draft…";
    case "saved":
      return "Draft saved.";
    case "failed":
      return "Draft save failed.";
    default:
      return "";
  }
}
