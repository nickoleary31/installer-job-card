import { getLocalSubmissionOutboxRepository, sha256Hex, type LocalSubmissionOutboxEntry } from "./local-submission-outbox.ts";
import { getLocalSubmissionRepository } from "./local-submission.ts";
import { getLocalPhotoMetadataRepository, loadLocalPhotoBlob } from "./local-photo.ts";
import { getNetworkStatus } from "./native/network-status.ts";
import { isNativeRuntime } from "./native/runtime.ts";
import { apiUrl } from "./api-base.ts";
import { supabase } from "./supabase/client.ts";
import type { JobCardSubmissionPayload } from "./job-card-submission.ts";

const PHOTO_BUCKET = "job-card-photos";

/**
 * Phase 2H — foreground-only sync engine. There is NO background
 * service/scheduler anywhere in this file or its callers (see
 * components/ForegroundSyncMount.tsx, the only mount point): sync runs
 * exclusively as a reaction to the app being open, foregrounded, and
 * online — the same JS-timer-free trigger AuthUserContextProvider already
 * uses to re-resolve auth on an online transition. Killing/backgrounding
 * the app stops sync outright; the NEXT foreground-while-online moment
 * picks up exactly where the durable outbox left off — no data is lost
 * either way, since nothing here is the only record of anything (see
 * local_submission_outbox's own frozen-snapshot doc).
 *
 * CRASH-ORPHAN RECOVERY SCOPE: ensureSyncEngineInitialized() below reconciles
 * stale 'syncing' rows exactly ONCE per app session, the first time sync is
 * ever attempted — deliberately NOT inside the outbox repository's own
 * getSchemaReadyConnection() (which runs on every connection acquisition,
 * including from unrelated code paths like the Submitted screen just
 * reading outbox state) — seeing this file's own design-review correction:
 * reconciling on every connection-open could incorrectly interrupt a
 * legitimate in-flight sync triggered by a different code path.
 */
let syncEngineInitPromise: Promise<string> | null = null;

function generateWorkerInstanceId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Memoized per-app-session singleton — mirrors lib/native/database.ts's nativeConnectionPromise pattern. Resolves to this session's own claim token. */
export function ensureSyncEngineInitialized(): Promise<string> {
  if (!syncEngineInitPromise) {
    syncEngineInitPromise = (async () => {
      const workerInstanceId = generateWorkerInstanceId();
      if (isNativeRuntime()) {
        try {
          await getLocalSubmissionOutboxRepository().reconcileOrphanedClaims(workerInstanceId, new Date().toISOString());
        } catch (e) {
          console.warn("[submission-sync] orphan claim reconciliation failed", e);
        }
      }
      return workerInstanceId;
    })();
  }
  return syncEngineInitPromise;
}

let syncInFlight = false;

async function getFreshAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

/**
 * Phase 2H security reconciliation — the pure status-code -> outcome
 * classification every server response in this file is run through, so a
 * terminal (never-retryable-by-simply-trying-again) failure is never
 * treated the same as a transient one. See local-submission-outbox.ts's
 * OutboxErrorKind for the full rationale and the durable states this
 * feeds.
 *
 *   "authorization" — 401 (no/invalid/expired session) or 403 (an
 *     ordinary access-denied — the requester IS authenticated but isn't
 *     currently allowed). Both MAY resolve themselves once the technician
 *     re-authenticates or access is restored — see recordOutboxAuthorizationBlocked.
 *
 *   "terminal" — 409 (an immutable-identity conflict: either a
 *     submission_snapshot_hash mismatch in finalize.ts, or a
 *     project/company mismatch from verifyProjectBelongsToCompany in
 *     project-access.ts — both status 409 for exactly this reason, see
 *     that function's own doc) or 400/422 (payload validation). Retrying
 *     the SAME frozen snapshot against the SAME server state can never
 *     succeed — see recordOutboxSyncFailure's errorKind parameter and
 *     buildSelectClaimableForUserSql's own doc for why this is excluded
 *     from automatic/manual retry entirely.
 *
 *   "retryable" — every other 4xx/5xx status, and (by construction — see
 *     each caller below) any network-level failure that never produced an
 *     HTTP response at all (fetch throwing before a status exists).
 */
export type SyncOutcomeKind = "authorization" | "terminal" | "retryable";

export function classifySyncResponseStatus(status: number): SyncOutcomeKind {
  if (status === 401 || status === 403) return "authorization";
  if (status === 409 || status === 400 || status === 422) return "terminal";
  return "retryable";
}

/** Re-reads a frozen photo's bytes off disk and re-hashes them — a mismatch means the file changed since freezing, and must block this item's sync truthfully rather than upload different bytes than what was reviewed. */
async function verifyPhotoContentUnchanged(localPhotoId: string, expectedContentHash: string): Promise<Blob> {
  const blob = await loadLocalPhotoBlob(localPhotoId);
  if (!blob) {
    throw new Error(`Photo ${localPhotoId} is missing from this device's durable storage.`);
  }
  const actualHash = await sha256Hex(await blob.arrayBuffer());
  if (actualHash !== expectedContentHash) {
    throw new Error(`Photo ${localPhotoId} content changed on disk since it was submitted; refusing to upload it.`);
  }
  return blob;
}

type PhotoUploadUrlResponse = { path: string; token: string };

class AuthorizationBlockedError extends Error {}

/**
 * Phase 2H security reconciliation — thrown for a classifySyncResponseStatus
 * "terminal" response (409 identity conflict, 400/422 validation). Caught
 * distinctly in syncOneEntry's catch block and recorded with
 * errorKind: "terminal" — never automatically (or manually, via the same
 * claim mechanism) retried. See OutboxErrorKind's own doc.
 */
class TerminalSyncError extends Error {}

function throwForFailedResponse(res: Response, body: { error?: string } | null, fallbackMessage: string): never {
  const kind = classifySyncResponseStatus(res.status);
  const message = body?.error || fallbackMessage;
  if (kind === "authorization") throw new AuthorizationBlockedError(message);
  if (kind === "terminal") throw new TerminalSyncError(message);
  throw new Error(message);
}

async function requestSignedUploadUrl(
  accessToken: string,
  args: { companyId: string; projectId: string; localSubmissionId: string; localPhotoId: string; fieldName: string; group: string; mimeType: string },
): Promise<PhotoUploadUrlResponse> {
  const res = await fetch(apiUrl("/api/job-card-submissions/photo-upload-url"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null as { error?: string } | null);
    throwForFailedResponse(res, body, `Could not get an upload URL (${res.status}).`);
  }
  return (await res.json()) as PhotoUploadUrlResponse;
}

type FinalizeResponse = { submissionId: string; technicianSubmittedAt: string; submissionSnapshotHash: string; serverConfirmedAt: string };

async function callFinalize(
  accessToken: string,
  args: {
    companyId: string;
    projectId: string;
    technicianSubmittedAt: string;
    submissionSnapshotHash: string;
    payload: JobCardSubmissionPayload;
  },
): Promise<FinalizeResponse> {
  const res = await fetch(apiUrl("/api/job-card-submissions/finalize"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null as { error?: string } | null);
    throwForFailedResponse(res, body, `Could not finalize this submission (${res.status}).`);
  }
  return (await res.json()) as FinalizeResponse;
}

/**
 * Uploads every not-yet-remote frozen photo for one outbox entry, then
 * returns the entry's frozen payload with every local-photo:// sentinel
 * (see lib/local-photo.ts's LOCAL_PHOTO_URI_SCHEME doc) replaced by its
 * real remote storagePath/publicUrl — the exact payload shape finalize
 * expects. Idempotent per photo: a photo whose LocalPhoto row already has
 * remoteStoragePath set (a prior partial sync attempt already uploaded it)
 * is never re-uploaded.
 */
async function uploadPhotosAndBuildFinalPayload(
  entry: LocalSubmissionOutboxEntry<JobCardSubmissionPayload>,
  accessToken: string,
): Promise<JobCardSubmissionPayload> {
  const photoMetadataRepo = getLocalPhotoMetadataRepository();
  const remotePathByLocalPhotoId = new Map<string, string>();

  for (const photo of entry.snapshotPhotos) {
    const existing = await photoMetadataRepo.loadLocalPhotoMetadata(photo.localPhotoId);
    if (!existing) {
      throw new Error(`Photo ${photo.localPhotoId} is missing from this device's durable storage.`);
    }
    if (existing.remoteStoragePath) {
      remotePathByLocalPhotoId.set(photo.localPhotoId, existing.remoteStoragePath);
      continue;
    }

    const blob = await verifyPhotoContentUnchanged(photo.localPhotoId, photo.contentHash);
    const { path, token } = await requestSignedUploadUrl(accessToken, {
      companyId: entry.companyId,
      projectId: entry.projectId,
      localSubmissionId: entry.localSubmissionId,
      localPhotoId: photo.localPhotoId,
      fieldName: photo.fieldName,
      group: photo.group,
      mimeType: photo.mimeType,
    });
    const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).uploadToSignedUrl(path, token, blob, {
      contentType: photo.mimeType,
    });
    if (uploadError) {
      throw new Error(`Could not upload photo ${photo.originalFilename}: ${uploadError.message}`);
    }
    const remoteUploadedAt = new Date().toISOString();
    await photoMetadataRepo.recordRemoteUpload(photo.localPhotoId, path, remoteUploadedAt);
    remotePathByLocalPhotoId.set(photo.localPhotoId, path);
  }

  const photoUploads = entry.snapshotPayload.photoUploads.map((upload) => {
    const localPhotoId = matchLocalPhotoId(upload, entry.snapshotPhotos);
    if (!localPhotoId) return upload;
    const remotePath = remotePathByLocalPhotoId.get(localPhotoId);
    if (!remotePath) return upload;
    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(remotePath);
    return { ...upload, storagePath: remotePath, publicUrl: data.publicUrl };
  });

  return { ...entry.snapshotPayload, photoUploads };
}

const LOCAL_PHOTO_URI_PREFIX = "local-photo://";

function matchLocalPhotoId(
  upload: JobCardSubmissionPayload["photoUploads"][number],
  photos: LocalSubmissionOutboxEntry["snapshotPhotos"],
): string | null {
  const raw = upload.storagePath || upload.publicUrl || "";
  if (!raw.startsWith(LOCAL_PHOTO_URI_PREFIX)) return null;
  const id = raw.slice(LOCAL_PHOTO_URI_PREFIX.length);
  return photos.some((p) => p.localPhotoId === id) ? id : null;
}

async function syncOneEntry(entry: LocalSubmissionOutboxEntry<JobCardSubmissionPayload>, claimToken: string): Promise<void> {
  const outboxRepo = getLocalSubmissionOutboxRepository();
  const now = () => new Date().toISOString();
  try {
    const accessToken = await getFreshAccessToken();
    if (!accessToken) throw new AuthorizationBlockedError("No active session to sync with.");

    const finalPayload = await uploadPhotosAndBuildFinalPayload(entry, accessToken);

    const freshToken = (await getFreshAccessToken()) || accessToken;
    const result = await callFinalize(freshToken, {
      companyId: entry.companyId,
      projectId: entry.projectId,
      technicianSubmittedAt: entry.snapshotTechnicianSubmittedAt,
      submissionSnapshotHash: entry.submissionSnapshotHash,
      payload: finalPayload,
    });

    await getLocalSubmissionRepository().recordServerConfirmation(entry.localSubmissionId, result.submissionId);
    await outboxRepo.recordOutboxServerConfirmed(entry.localSubmissionId, claimToken, result.submissionId, now());
  } catch (e) {
    if (e instanceof AuthorizationBlockedError) {
      await outboxRepo.recordOutboxAuthorizationBlocked(entry.localSubmissionId, claimToken, now());
      return;
    }
    const message = e instanceof Error ? e.message : "Sync failed for an unknown reason.";
    // Phase 2H security reconciliation — TerminalSyncError (409 identity
    // conflict, 400/422 validation) is recorded distinctly from an ordinary
    // network/timeout/5xx failure, so buildSelectClaimableForUserSql can
    // exclude it from every future automatic AND manual retry — retrying
    // the SAME frozen snapshot against the SAME server state can never
    // succeed. See classifySyncResponseStatus's own doc.
    const errorKind = e instanceof TerminalSyncError ? "terminal" : "retryable";
    await outboxRepo.recordOutboxSyncFailure(entry.localSubmissionId, claimToken, message, errorKind, now());
  }
}

/**
 * Runs one full foreground sync pass: claims and processes every currently
 * claimable outbox entry for `userId`, serially (one submission's photos +
 * finalize at a time — simpler reasoning, avoids a burst of concurrent
 * Storage uploads on a technician's mobile connection). Safe to call
 * whenever the caller believes the device might be online — this function
 * itself re-checks connectivity and is a no-op off native/offline. Guarded
 * against overlapping concurrent runs within this session; the outbox's own
 * atomic claim (tryClaimOutboxEntry) is what actually prevents a
 * cross-process/duplicate-tab race, this flag just avoids redundant work.
 */
export async function runForegroundSync(userId: string): Promise<void> {
  if (!isNativeRuntime()) return;
  if (!userId) return;
  if (syncInFlight) return;
  if (!(await getNetworkStatus().isOnlineFresh())) return;

  syncInFlight = true;
  try {
    const claimToken = await ensureSyncEngineInitialized();
    const outboxRepo = getLocalSubmissionOutboxRepository();
    const claimable = await outboxRepo.listClaimableOutboxEntries<JobCardSubmissionPayload>(userId);
    for (const candidate of claimable) {
      const now = new Date().toISOString();
      const claimed = await outboxRepo.tryClaimOutboxEntry(candidate.localSubmissionId, claimToken, now);
      if (!claimed) continue; // lost the race to another caller in this session — skip, a later pass will pick it up
      const fresh = await outboxRepo.loadOutboxEntry<JobCardSubmissionPayload>(candidate.localSubmissionId);
      if (!fresh) continue;
      await syncOneEntry(fresh, claimToken);
    }
  } catch (e) {
    console.warn("[submission-sync] foreground sync pass failed", e);
  } finally {
    syncInFlight = false;
  }
}
