import { getAppFilesystem } from "./native/filesystem.ts";
import { getNativeLocalPhotoMetadata } from "./native/local-photo.ts";
import { isNativeRuntime } from "./native/runtime.ts";

/**
 * Phase 2G — durable native photo persistence. Mirrors Phase 2F's
 * lib/local-submission.ts boundary shape, but deliberately splits two
 * concerns the way the phase spec asked for:
 *
 *  - PHOTO FILE I/O: the actual image bytes, via the EXISTING
 *    lib/native/filesystem.ts getAppFilesystem() boundary (Phase 1A/2A,
 *    already native/web-dispatched, already tested) — native writes to
 *    Capacitor's Directory.Data (app-private, survives force-close/normal
 *    app updates/device restart, never the public gallery), web writes to
 *    the Origin Private File System. This file does not reimplement that.
 *  - PHOTO METADATA/ASSOCIATION: local_photos SQLite rows, via
 *    LocalPhotoMetadataRepository below (native-only in practice — see
 *    that interface's own doc).
 *
 * savePhotoDurably()/deleteLocalPhotoDurably() are the HIGH-LEVEL
 * operations that combine both so a caller can never observe a
 * half-persisted state (a metadata row pointing at a missing file, or an
 * orphaned file nothing references) — see their own docs for the exact
 * ordering that makes one of those two failure modes structurally
 * impossible rather than merely handled.
 */
export type LocalPhoto = {
  localPhotoId: string;
  userId: string;
  projectId: string;
  localSubmissionId: string;
  /** NewSubmissionForm.tsx's UploadFieldName — kept as a plain string here; lib/ must not import components/. */
  fieldName: string;
  /** NewSubmissionForm.tsx's PhotoStorageGroup — display/organizational only, not part of identity. */
  group: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  /** The getAppFilesystem() key these bytes are stored under — see buildLocalPhotoFilesystemPath(). */
  filesystemPath: string;
  /**
   * Phase 2H — set once this photo's bytes have been durably uploaded via
   * the deterministic signed-upload path (see lib/submission-sync.ts and
   * lib/native/local-submission-outbox.ts's own docs). null means "not yet
   * uploaded" — the SAME truth findLocalPhotoUri/LOCAL_PHOTO_URI_SCHEME
   * already encodes in a submission payload's photoUploads entries, kept
   * here too so the sync engine can determine per-photo upload state
   * without re-deriving it from payload JSON. Never set by
   * saveLocalPhotoMetadata's own upsert (see that SQL's own doc) — only by
   * recordRemoteUpload below.
   */
  remoteStoragePath: string | null;
  remoteUploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocalPhotoMetadataInput = Omit<
  LocalPhoto,
  "createdAt" | "updatedAt" | "remoteStoragePath" | "remoteUploadedAt"
>;

/**
 * Pure metadata CRUD only — never touches the filesystem. Native-only in
 * practice: NewSubmissionForm.tsx only ever calls the orchestration
 * functions below on the authoritative isOfflineAuthorized branch, which
 * can never be true on web (isNativeRuntime() gate) — see
 * lib/auth/auth-state.ts. Mirrors LocalSubmissionRepository's exact
 * native/web split.
 */
export interface LocalPhotoMetadataRepository {
  saveLocalPhotoMetadata(input: LocalPhotoMetadataInput): Promise<LocalPhoto>;
  loadLocalPhotoMetadata(localPhotoId: string): Promise<LocalPhoto | null>;
  listLocalPhotosForSubmission(localSubmissionId: string): Promise<LocalPhoto[]>;
  listLocalPhotosForField(localSubmissionId: string, fieldName: string): Promise<LocalPhoto[]>;
  deleteLocalPhotoMetadata(localPhotoId: string): Promise<void>;
  clearLocalPhotosForSubmission(localSubmissionId: string): Promise<void>;
  /**
   * Phase 2H — narrow write recording that this photo's bytes now durably
   * exist at `remoteStoragePath` in Supabase Storage. Never touches any
   * other column.
   */
  recordRemoteUpload(localPhotoId: string, remoteStoragePath: string, remoteUploadedAt: string): Promise<void>;
}

const WEB_NOT_IMPLEMENTED_MESSAGE =
  "Local photo metadata storage is not implemented for the web runtime. The web app continues to use its existing File/Blob + Supabase Storage upload path directly.";

class WebLocalPhotoMetadataNotImplemented implements LocalPhotoMetadataRepository {
  saveLocalPhotoMetadata(): Promise<LocalPhoto> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  loadLocalPhotoMetadata(): Promise<LocalPhoto | null> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  listLocalPhotosForSubmission(): Promise<LocalPhoto[]> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  listLocalPhotosForField(): Promise<LocalPhoto[]> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  deleteLocalPhotoMetadata(): Promise<void> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  clearLocalPhotosForSubmission(): Promise<void> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
  recordRemoteUpload(): Promise<void> {
    throw new Error(WEB_NOT_IMPLEMENTED_MESSAGE);
  }
}

const webLocalPhotoMetadataSingleton = new WebLocalPhotoMetadataNotImplemented();

export function getLocalPhotoMetadataRepository(): LocalPhotoMetadataRepository {
  return isNativeRuntime() ? getNativeLocalPhotoMetadata() : webLocalPhotoMetadataSingleton;
}

function generateLocalPhotoId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Pure — normalized file extension for a photo mime type; shared by the local filesystem path and the Phase 2H remote storage path below. */
export function photoMimeTypeToExtension(mimeType: string): "png" | "webp" | "jpg" {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}

/**
 * Pure — deterministic, opaque, filename/PII-free. Never depends on the
 * original filename (only the localPhotoId + a normalized extension) — see
 * the phase's own "no PII in the filename/path" requirement.
 */
export function buildLocalPhotoFilesystemPath(localSubmissionId: string, localPhotoId: string, mimeType: string): string {
  return `submissions/${localSubmissionId}/photos/${localPhotoId}.${photoMimeTypeToExtension(mimeType)}`;
}

/**
 * Phase 2H — the deterministic REMOTE Supabase Storage path for a photo,
 * derived purely from stable identity (never a timestamp or random value —
 * a retry of the SAME photo must always resolve to the SAME remote object,
 * so a signed-upload retry overwrites in place instead of leaving orphans).
 * Computed identically on the server
 * (app/api/job-card-submissions/photo-upload-url/route.ts, which
 * derives/validates it from server-VERIFIED companyId/projectId rather than
 * trusting a client-supplied path) and reused client-side only to know what
 * publicUrl to expect once uploaded.
 *
 * Phase 2H security reconciliation — tenant-bound: the path is prefixed
 * with companyId/projectId (never just submissionId) so that two different
 * tenants can never collide on, or be confused with, each other's Storage
 * namespace, and so that a signed-upload URL issued for one project can
 * never be mistaken for a path under another. Both companyId and projectId
 * here must already be server-verified (authorizeProjectAccess having
 * proven project.company_id === companyId and the requester's access to
 * that pair) — see photo-upload-url.ts's own doc for why this function is
 * never called with raw, unauthorized client input.
 */
export function buildRemotePhotoStoragePath(
  companyId: string,
  projectId: string,
  localSubmissionId: string,
  group: string,
  fieldName: string,
  localPhotoId: string,
  mimeType: string,
): string {
  return `${companyId}/${projectId}/${localSubmissionId}/${group}/${fieldName}/${localPhotoId}.${photoMimeTypeToExtension(mimeType)}`;
}

export type SavePhotoDurablyInput = {
  userId: string;
  projectId: string;
  localSubmissionId: string;
  fieldName: string;
  group: string;
  /** Already compressed/finalized bytes — compression is a browser-context concern the caller (NewSubmissionForm.tsx) already owns via compressPhotoForUpload(). */
  bytes: Blob;
  originalFilename: string;
  mimeType: string;
};

/**
 * The one write path a caller should ever use. Ordering deliberately makes
 * "a LocalPhoto row exists but its file doesn't" structurally IMPOSSIBLE
 * rather than merely handled: the filesystem write always happens first,
 * and the metadata row is only ever created once it has already
 * succeeded. If the metadata write then fails, the just-written file is
 * deleted (best-effort) so it doesn't linger as an orphan nothing
 * references. If the filesystem write itself fails, nothing is written at
 * all — no metadata attempt, no possible dangling row.
 */
export type SavePhotoDurablyDeps = {
  fs: Pick<ReturnType<typeof getAppFilesystem>, "writeFile" | "deleteFile">;
  metadataRepo: Pick<LocalPhotoMetadataRepository, "saveLocalPhotoMetadata">;
  /** Overridable only for deterministic tests — see lib/local-photo.test.ts. */
  generateId?: () => string;
};

/** Real implementations by default; overridable for testing without a device — see lib/local-photo.test.ts. */
export async function savePhotoDurably(
  input: SavePhotoDurablyInput,
  deps: SavePhotoDurablyDeps = { fs: getAppFilesystem(), metadataRepo: getLocalPhotoMetadataRepository() },
): Promise<LocalPhoto> {
  const localPhotoId = (deps.generateId ?? generateLocalPhotoId)();
  const filesystemPath = buildLocalPhotoFilesystemPath(input.localSubmissionId, localPhotoId, input.mimeType);
  await deps.fs.writeFile(filesystemPath, input.bytes);
  try {
    return await deps.metadataRepo.saveLocalPhotoMetadata({
      localPhotoId,
      userId: input.userId,
      projectId: input.projectId,
      localSubmissionId: input.localSubmissionId,
      fieldName: input.fieldName,
      group: input.group,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.size,
      filesystemPath,
    });
  } catch (metadataError) {
    try {
      await deps.fs.deleteFile(filesystemPath);
    } catch {
      // best-effort orphan cleanup — the metadata write failure is the real error to surface
    }
    throw metadataError;
  }
}

/**
 * For preview restoration — reads the durable bytes back as a Blob; the caller owns
 * turning this into a short-lived object URL and revoking it. getAppFilesystem()'s
 * native implementation round-trips through base64 (see lib/native/filesystem.ts's
 * base64ToBlob) and never sets a MIME type on the result, which an <img> element
 * cannot reliably rely on for decoding — re-stamp it from the metadata's recorded
 * mimeType (set once, from the original upload, at save time) rather than trusting
 * whatever type the filesystem layer happened to return.
 */
export type LoadLocalPhotoBlobDeps = {
  fs: Pick<ReturnType<typeof getAppFilesystem>, "readFile">;
  metadataRepo: Pick<LocalPhotoMetadataRepository, "loadLocalPhotoMetadata">;
};

export async function loadLocalPhotoBlob(
  localPhotoId: string,
  deps: LoadLocalPhotoBlobDeps = { fs: getAppFilesystem(), metadataRepo: getLocalPhotoMetadataRepository() },
): Promise<Blob | null> {
  const metadata = await deps.metadataRepo.loadLocalPhotoMetadata(localPhotoId);
  if (!metadata) return null;
  const raw = await deps.fs.readFile(metadata.filesystemPath);
  if (!raw) return null;
  return raw.type ? raw : new Blob([raw], { type: metadata.mimeType });
}

/**
 * Metadata deleted BEFORE the filesystem delete is attempted — the
 * opposite order from savePhotoDurably(), deliberately: this guarantees a
 * failed filesystem delete only ever leaves an orphaned file (wasted disk
 * space, safe, a documented future-cleanup case), never a LocalPhoto row
 * pointing at a file that's already gone.
 */
export type DeleteLocalPhotoDurablyDeps = {
  fs: Pick<ReturnType<typeof getAppFilesystem>, "deleteFile">;
  metadataRepo: Pick<LocalPhotoMetadataRepository, "loadLocalPhotoMetadata" | "deleteLocalPhotoMetadata">;
};

export async function deleteLocalPhotoDurably(
  localPhotoId: string,
  deps: DeleteLocalPhotoDurablyDeps = { fs: getAppFilesystem(), metadataRepo: getLocalPhotoMetadataRepository() },
): Promise<void> {
  const metadata = await deps.metadataRepo.loadLocalPhotoMetadata(localPhotoId);
  await deps.metadataRepo.deleteLocalPhotoMetadata(localPhotoId);
  if (metadata) {
    try {
      await deps.fs.deleteFile(metadata.filesystemPath);
    } catch {
      // best-effort — an orphaned file is safe; see this function's own doc
    }
  }
}

/**
 * The sentinel scheme threaded through UploadedPhotoMetadata.publicUrl/storagePath so
 * Phase 2F's existing draft serialization/restoration and every counting/validation site
 * work unchanged — see components/NewSubmissionForm.tsx's own doc at the render/upload
 * integration points.
 *
 * SEMANTIC CONTRACT — read before touching any future sync/upload/outbox code:
 * `local-photo://<localPhotoId>` is a LOCAL-ONLY reference into THIS device's own
 * local_photos table + app-private filesystem. It is NOT, and must never be treated as:
 *   - a Supabase Storage path or public URL
 *   - a server-reachable URL of any kind
 *   - an upload destination
 *   - valid evidence that a server has ever seen this photo
 * A future Phase 2H is what resolves/uploads a LocalPhoto and maps this local identity to
 * the eventual remote storagePath/publicUrl — that mapping does not exist yet. Until then,
 * ANY code that serializes photo metadata toward a server (a submission payload, an
 * outbox entry, a sync request) MUST treat a value matching this scheme as "not yet
 * uploaded" and must never forward it to Supabase Storage, a webhook, or any other
 * server-facing API as though it were real remote evidence — doing so would hand the
 * server an unreachable, device-local, non-URL string.
 */
export const LOCAL_PHOTO_URI_SCHEME = "local-photo://";

export function buildLocalPhotoUri(localPhotoId: string): string {
  return `${LOCAL_PHOTO_URI_SCHEME}${localPhotoId}`;
}

export function parseLocalPhotoUri(value: string): string | null {
  return value.startsWith(LOCAL_PHOTO_URI_SCHEME) ? value.slice(LOCAL_PHOTO_URI_SCHEME.length) : null;
}

/**
 * Confirms a set of photo references (as they appear in
 * NewSubmissionForm.tsx's photoMetadataByField / a restored draft's
 * photoUploads) still resolve to a genuinely readable durable file before
 * the form is allowed to keep counting them as present evidence. A
 * non-sentinel reference (a real remote publicUrl, already uploaded) is
 * passed through unverified — this only concerns durable-local references,
 * which are the only ones that can silently go stale (file deleted/
 * corrupted on disk while the row referencing it still exists).
 *
 * Deliberately reuses loadLocalPhotoBlob() itself — the exact same
 * metadata-then-file read path the preview restoration UI (LocalPhotoImg)
 * uses — rather than a separate existence check, so "verified" and
 * "actually previewable" can never silently disagree.
 *
 * This performs NO repair/cleanup of the underlying LocalPhoto row or
 * file — a dropped reference just stops being counted as evidence in the
 * caller's own in-memory/next-persisted state. See this file's own delete
 * functions for how a genuinely orphaned row/file is documented as a safe,
 * separate, future-cleanup concern.
 */
export type VerifyDurablePhotoReferencesDeps = {
  loadBlob?: (localPhotoId: string) => Promise<Blob | null>;
};

export async function verifyDurablePhotoReferences<T extends { publicUrl?: string | null }>(
  references: T[],
  deps: VerifyDurablePhotoReferencesDeps = {},
): Promise<{ verified: T[]; droppedLocalPhotoIds: string[] }> {
  const loadBlob = deps.loadBlob ?? ((id: string) => loadLocalPhotoBlob(id));
  const verified: T[] = [];
  const droppedLocalPhotoIds: string[] = [];
  for (const ref of references) {
    const localPhotoId = parseLocalPhotoUri(ref.publicUrl || "");
    if (!localPhotoId) {
      verified.push(ref);
      continue;
    }
    let blob: Blob | null = null;
    try {
      blob = await loadBlob(localPhotoId);
    } catch {
      blob = null;
    }
    if (blob) {
      verified.push(ref);
    } else {
      droppedLocalPhotoIds.push(localPhotoId);
    }
  }
  return { verified, droppedLocalPhotoIds };
}
