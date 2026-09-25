import {
  getLocalSubmissionOutboxRepository,
  sha256Hex,
  type LocalSubmissionOutboxEntry,
  type LocalSubmissionOutboxRepository,
} from "./local-submission-outbox.ts";
import { getLocalSubmissionRepository, type LocalSubmissionRepository } from "./local-submission.ts";
import { getLocalPhotoMetadataRepository, loadLocalPhotoBlob, type LocalPhotoMetadataRepository } from "./local-photo.ts";
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
 * uses to re-resolve auth on an online transition, plus (Checkpoint 1) the
 * native app returning to the foreground. Killing/backgrounding the app
 * stops sync outright; the NEXT foreground-while-online moment picks up
 * exactly where the durable outbox left off — no data is lost either way,
 * since nothing here is the only record of anything (see
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
 *   404 (Checkpoint 1) — classified by what actually answered.
 *     `hasStructuredErrorBody` true means the photo-upload-url/finalize
 *     route itself responded with its JSON `{ error }` body: the only 404
 *     those routes produce is authorizeProjectAccess's "Project not found."
 *     for this entry's frozen projectId, which retrying the same snapshot
 *     can never fix -> "terminal". A 404 without that body means the route
 *     wasn't found at the configured API origin at all (not deployed there,
 *     or a wrong NEXT_PUBLIC_API_ORIGIN) — an environment problem that a
 *     later attempt against a fixed server CAN succeed at, so it stays
 *     "retryable" (retried only on the same event triggers as any other
 *     transient failure, never in a loop).
 *
 *   "retryable" — every other 4xx/5xx status, and (by construction — see
 *     each caller below) any network-level failure that never produced an
 *     HTTP response at all (fetch throwing before a status exists).
 */
export type SyncOutcomeKind = "authorization" | "terminal" | "retryable";

export function classifySyncResponseStatus(status: number, hasStructuredErrorBody = false): SyncOutcomeKind {
  if (status === 401 || status === 403) return "authorization";
  if (status === 409 || status === 400 || status === 422) return "terminal";
  if (status === 404) return hasStructuredErrorBody ? "terminal" : "retryable";
  return "retryable";
}

class AuthorizationBlockedError extends Error {}

/**
 * Phase 2H security reconciliation — thrown for a classifySyncResponseStatus
 * "terminal" response (409 identity conflict, 400/422 validation, a route's
 * own 404) and (Checkpoint 1) for local evidence that can never become
 * uploadable again: a frozen photo whose metadata or file is gone from this
 * device, or whose bytes no longer match what was frozen at submit. Caught
 * distinctly in syncOneEntry's catch block and recorded with
 * errorKind: "terminal" — never automatically (or manually, via the same
 * claim mechanism) retried. Nothing is deleted: the outbox row, its frozen
 * snapshot and every remaining photo stay on the device. See
 * OutboxErrorKind's own doc.
 */
class TerminalSyncError extends Error {}

type ErrorBody = { error?: unknown } | null;

function readErrorMessage(body: ErrorBody): string | null {
  return typeof body?.error === "string" && body.error.trim() ? body.error.trim() : null;
}

function throwForFailedResponse(res: Response, body: ErrorBody, fallbackMessage: string): never {
  const structuredMessage = readErrorMessage(body);
  const kind = classifySyncResponseStatus(res.status, structuredMessage !== null);
  const message =
    structuredMessage ||
    (res.status === 404 ? "The sync service wasn't found at this server address (404)." : fallbackMessage);
  if (kind === "authorization") throw new AuthorizationBlockedError(message);
  if (kind === "terminal") throw new TerminalSyncError(message);
  throw new Error(message);
}

export type SyncSession = { accessToken: string; userId: string };

/**
 * Everything the engine touches, injectable so the full claim -> upload ->
 * finalize -> record path (and every failure classification along it) is
 * unit-testable without a device, a network or Supabase — see
 * lib/submission-sync.test.ts. defaultSyncEngineDeps() below is the real
 * wiring; runForegroundSync() is the only production caller.
 */
export type SyncEngineDeps = {
  outboxRepo: Pick<
    LocalSubmissionOutboxRepository,
    | "listClaimableOutboxEntries"
    | "tryClaimOutboxEntry"
    | "loadOutboxEntry"
    | "recordOutboxSyncFailure"
    | "recordOutboxAuthorizationBlocked"
    | "recordOutboxServerConfirmed"
  >;
  localSubmissionRepo: Pick<LocalSubmissionRepository, "recordServerConfirmation">;
  photoMetadataRepo: Pick<LocalPhotoMetadataRepository, "loadLocalPhotoMetadata" | "recordRemoteUpload">;
  loadLocalPhotoBlob: (localPhotoId: string) => Promise<Blob | null>;
  /** The signed-in session right now, from local storage only — never a network call. */
  getSession: () => Promise<SyncSession | null>;
  isOnlineFresh: () => Promise<boolean>;
  postJson: (path: string, accessToken: string, body: unknown) => Promise<Response>;
  uploadToSignedUrl: (path: string, token: string, blob: Blob, contentType: string) => Promise<{ error: string | null }>;
  getPublicUrl: (path: string) => string;
  now: () => string;
};

function defaultSyncEngineDeps(): SyncEngineDeps {
  return {
    outboxRepo: getLocalSubmissionOutboxRepository(),
    localSubmissionRepo: getLocalSubmissionRepository(),
    photoMetadataRepo: getLocalPhotoMetadataRepository(),
    loadLocalPhotoBlob: (localPhotoId) => loadLocalPhotoBlob(localPhotoId),
    getSession: async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      return session?.access_token && session.user?.id ? { accessToken: session.access_token, userId: session.user.id } : null;
    },
    isOnlineFresh: () => getNetworkStatus().isOnlineFresh(),
    postJson: (path, accessToken, body) =>
      fetch(apiUrl(path), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      }),
    uploadToSignedUrl: async (path, token, blob, contentType) => {
      const { error } = await supabase.storage.from(PHOTO_BUCKET).uploadToSignedUrl(path, token, blob, { contentType });
      return { error: error?.message ?? null };
    },
    getPublicUrl: (path) => supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl,
    now: () => new Date().toISOString(),
  };
}

/** Re-reads a frozen photo's bytes off disk and re-hashes them — a mismatch means the file changed since freezing, and must block this item's sync truthfully rather than upload different bytes than what was reviewed. */
async function verifyPhotoContentUnchanged(localPhotoId: string, expectedContentHash: string, deps: SyncEngineDeps): Promise<Blob> {
  const blob = await deps.loadLocalPhotoBlob(localPhotoId);
  if (!blob) {
    throw new TerminalSyncError(`Photo ${localPhotoId} is missing from this device's durable storage.`);
  }
  const actualHash = await sha256Hex(await blob.arrayBuffer());
  if (actualHash !== expectedContentHash) {
    throw new TerminalSyncError(`Photo ${localPhotoId} content changed on disk since it was submitted; refusing to upload it.`);
  }
  return blob;
}

type PhotoUploadUrlResponse = { path: string; token: string };

async function requestSignedUploadUrl(
  accessToken: string,
  args: { companyId: string; projectId: string; localSubmissionId: string; localPhotoId: string; fieldName: string; group: string; mimeType: string },
  deps: SyncEngineDeps,
): Promise<PhotoUploadUrlResponse> {
  const res = await deps.postJson("/api/job-card-submissions/photo-upload-url", accessToken, args);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorBody;
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
  deps: SyncEngineDeps,
): Promise<FinalizeResponse> {
  const res = await deps.postJson("/api/job-card-submissions/finalize", accessToken, args);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorBody;
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
  deps: SyncEngineDeps,
): Promise<JobCardSubmissionPayload> {
  const remotePathByLocalPhotoId = new Map<string, string>();

  for (const photo of entry.snapshotPhotos) {
    const existing = await deps.photoMetadataRepo.loadLocalPhotoMetadata(photo.localPhotoId);
    if (!existing) {
      throw new TerminalSyncError(`Photo ${photo.localPhotoId} is missing from this device's durable storage.`);
    }
    if (existing.remoteStoragePath) {
      remotePathByLocalPhotoId.set(photo.localPhotoId, existing.remoteStoragePath);
      continue;
    }

    const blob = await verifyPhotoContentUnchanged(photo.localPhotoId, photo.contentHash, deps);
    const { path, token } = await requestSignedUploadUrl(
      accessToken,
      {
        companyId: entry.companyId,
        projectId: entry.projectId,
        localSubmissionId: entry.localSubmissionId,
        localPhotoId: photo.localPhotoId,
        fieldName: photo.fieldName,
        group: photo.group,
        mimeType: photo.mimeType,
      },
      deps,
    );
    const { error: uploadError } = await deps.uploadToSignedUrl(path, token, blob, photo.mimeType);
    if (uploadError) {
      throw new Error(`Could not upload photo ${photo.originalFilename}: ${uploadError}`);
    }
    await deps.photoMetadataRepo.recordRemoteUpload(photo.localPhotoId, path, deps.now());
    remotePathByLocalPhotoId.set(photo.localPhotoId, path);
  }

  const photoUploads = entry.snapshotPayload.photoUploads.map((upload) => {
    const localPhotoId = matchLocalPhotoId(upload, entry.snapshotPhotos);
    if (!localPhotoId) return upload;
    const remotePath = remotePathByLocalPhotoId.get(localPhotoId);
    if (!remotePath) return upload;
    return { ...upload, storagePath: remotePath, publicUrl: deps.getPublicUrl(remotePath) };
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

/**
 * The session must belong to the user who submitted this entry, at both
 * network steps — so an entry can never be uploaded or finalized under a
 * different signed-in user's credentials (e.g. after a sign-out and a
 * different technician signing in mid-pass). A mismatch is recorded as
 * authorization-blocked, which stays claimable for when the original user
 * signs back in on this device.
 */
async function requireSessionFor(entry: LocalSubmissionOutboxEntry, deps: SyncEngineDeps): Promise<SyncSession> {
  const session = await deps.getSession();
  if (!session) throw new AuthorizationBlockedError("No active session to sync with.");
  if (session.userId !== entry.userId) {
    throw new AuthorizationBlockedError("A different user is signed in on this device.");
  }
  return session;
}

async function syncOneEntry(
  entry: LocalSubmissionOutboxEntry<JobCardSubmissionPayload>,
  claimToken: string,
  deps: SyncEngineDeps,
): Promise<void> {
  const { outboxRepo } = deps;
  try {
    const session = await requireSessionFor(entry, deps);
    const finalPayload = await uploadPhotosAndBuildFinalPayload(entry, session.accessToken, deps);

    // Re-read rather than reuse: uploads can take long enough for the access token to be refreshed.
    const freshSession = await requireSessionFor(entry, deps);
    const result = await callFinalize(
      freshSession.accessToken,
      {
        companyId: entry.companyId,
        projectId: entry.projectId,
        technicianSubmittedAt: entry.snapshotTechnicianSubmittedAt,
        submissionSnapshotHash: entry.submissionSnapshotHash,
        payload: finalPayload,
      },
      deps,
    );

    await deps.localSubmissionRepo.recordServerConfirmation(entry.localSubmissionId, result.submissionId);
    await outboxRepo.recordOutboxServerConfirmed(entry.localSubmissionId, claimToken, result.submissionId, deps.now());
  } catch (e) {
    if (e instanceof AuthorizationBlockedError) {
      await outboxRepo.recordOutboxAuthorizationBlocked(entry.localSubmissionId, claimToken, deps.now());
      return;
    }
    const message = e instanceof Error ? e.message : "Sync failed for an unknown reason.";
    // Phase 2H security reconciliation — TerminalSyncError is recorded
    // distinctly from an ordinary network/timeout/5xx failure, so
    // buildSelectClaimableForUserSql can exclude it from every future
    // automatic AND manual retry — retrying the SAME frozen snapshot against
    // the SAME server state (or the same missing local evidence) can never
    // succeed. See classifySyncResponseStatus's own doc.
    const errorKind = e instanceof TerminalSyncError ? "terminal" : "retryable";
    await outboxRepo.recordOutboxSyncFailure(entry.localSubmissionId, claimToken, message, errorKind, deps.now());
  }
}

/**
 * One sync pass: claims and processes every currently claimable outbox
 * entry for `userId`, serially (one submission's photos + finalize at a time
 * — simpler reasoning, avoids a burst of concurrent Storage uploads on a
 * technician's mobile connection). A no-op when offline, or when the
 * signed-in session isn't `userId`'s — this device never claims one user's
 * work under another user's session. The outbox's own atomic claim
 * (tryClaimOutboxEntry) is what prevents two passes from ever processing the
 * same entry; createSingleFlightSyncRunner below additionally keeps passes
 * within this app session from overlapping at all.
 */
export async function runSyncPass(userId: string, claimToken: string, deps: SyncEngineDeps): Promise<void> {
  if (!userId) return;
  if (!(await deps.isOnlineFresh())) return;
  const session = await deps.getSession();
  if (!session || session.userId !== userId) return;

  const claimable = await deps.outboxRepo.listClaimableOutboxEntries<JobCardSubmissionPayload>(userId);
  for (const candidate of claimable) {
    const claimed = await deps.outboxRepo.tryClaimOutboxEntry(candidate.localSubmissionId, claimToken, deps.now());
    if (!claimed) continue; // lost the race to another caller — skip, a later pass will pick it up
    const fresh = await deps.outboxRepo.loadOutboxEntry<JobCardSubmissionPayload>(candidate.localSubmissionId);
    if (!fresh) continue;
    await syncOneEntry(fresh, claimToken, deps);
  }
}

/**
 * Checkpoint 1 — at most ONE sync pass runs at a time in this app session,
 * however many triggers fire (startup, reconnect, app resume, submit, a
 * Retry tap). A request that arrives while a pass is running does not start
 * a second concurrent pass and is not dropped either: it schedules exactly
 * one follow-up pass after the current one finishes (several requests during
 * one pass collapse into that single follow-up), so an entry submitted
 * mid-pass is picked up without waiting for some later trigger. Every caller
 * gets the promise for the whole run, follow-ups included — the Submitted
 * screen's Retry awaits it before re-reading row state. `maxConsecutivePasses`
 * bounds the chain; a request past the bound is left for the next trigger.
 */
export function createSingleFlightSyncRunner(
  runPass: (userId: string) => Promise<void>,
  options: { maxConsecutivePasses?: number } = {},
): (userId: string) => Promise<void> {
  const maxConsecutivePasses = options.maxConsecutivePasses ?? 3;
  let active: Promise<void> | null = null;
  let followUpFor: string | null = null;

  return (userId: string): Promise<void> => {
    if (active) {
      followUpFor = userId;
      return active;
    }
    active = (async () => {
      let next: string | null = userId;
      let passes = 0;
      try {
        while (next && passes < maxConsecutivePasses) {
          followUpFor = null;
          passes += 1;
          try {
            await runPass(next);
          } catch (e) {
            console.warn("[submission-sync] foreground sync pass failed", e);
          }
          next = followUpFor;
        }
      } finally {
        active = null;
        followUpFor = null;
      }
    })();
    return active;
  };
}

const foregroundSyncRunner = createSingleFlightSyncRunner(async (userId) => {
  const claimToken = await ensureSyncEngineInitialized();
  await runSyncPass(userId, claimToken, defaultSyncEngineDeps());
});

/**
 * Runs (or joins) a foreground sync for `userId`. Safe to call whenever the
 * caller believes the device might be online — each pass re-checks
 * connectivity and the signed-in user, and this is a no-op off native.
 */
export async function runForegroundSync(userId: string): Promise<void> {
  if (!isNativeRuntime()) return;
  if (!userId) return;
  return foregroundSyncRunner(userId);
}
