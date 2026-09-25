import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Phase 2H security reconciliation — classifySyncResponseStatus is the
 * pure heart of the terminal-vs-retryable-vs-authorization classification:
 * every server response lib/submission-sync.ts's sync engine sees (from
 * /api/job-card-submissions/finalize and /photo-upload-url) is run through
 * this exact function before deciding how to record an outbox failure. See
 * lib/local-submission-outbox.ts's OutboxErrorKind and
 * lib/native/local-submission-outbox.ts's isOutboxRowClaimable for what
 * consumes the result.
 *
 * submission-sync.ts's real `supabase` client (lib/supabase/client.ts)
 * throws at module-evaluation time if NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are
 * unset — never actually needed by classifySyncResponseStatus itself, but
 * the import still has to resolve. Same established workaround as
 * lib/auth/userContext.test.ts's own doc: dummy values set before the
 * dynamic import below (NOT hoisted, unlike a static import), touching
 * neither lib/supabase/client.ts nor the shared test env for every other file.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.local";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

const { classifySyncResponseStatus } = await import("./submission-sync.ts");
describe("classifySyncResponseStatus (pure)", () => {
  it("401 (no/invalid/expired session) -> authorization", () => {
    assert.equal(classifySyncResponseStatus(401), "authorization");
  });

  it("403 (authenticated but not currently allowed) -> authorization", () => {
    assert.equal(classifySyncResponseStatus(403), "authorization");
  });

  it("409 (immutable identity conflict — project/company mismatch OR snapshot-hash conflict) -> terminal", () => {
    assert.equal(classifySyncResponseStatus(409), "terminal");
  });

  it("400 and 422 (payload validation) -> terminal", () => {
    assert.equal(classifySyncResponseStatus(400), "terminal");
    assert.equal(classifySyncResponseStatus(422), "terminal");
  });

  it("500/502/503 (transient server failure) -> retryable", () => {
    assert.equal(classifySyncResponseStatus(500), "retryable");
    assert.equal(classifySyncResponseStatus(502), "retryable");
    assert.equal(classifySyncResponseStatus(503), "retryable");
  });

  it("an unrecognized/unexpected status defaults to retryable — never silently classified terminal by surprise", () => {
    assert.equal(classifySyncResponseStatus(418), "retryable");
    assert.equal(classifySyncResponseStatus(0), "retryable");
  });
});

const { createSingleFlightSyncRunner, runSyncPass } = await import("./submission-sync.ts");
const { isOutboxRowClaimable } = await import("./native/local-submission-outbox.ts");
const { sha256Hex } = await import("./local-submission-outbox.ts");
type SyncEngineDeps = import("./submission-sync.ts").SyncEngineDeps;
type Entry = import("./local-submission-outbox.ts").LocalSubmissionOutboxEntry<import("./job-card-submission.ts").JobCardSubmissionPayload>;
type LocalPhoto = import("./local-photo.ts").LocalPhoto;

describe("classifySyncResponseStatus — Checkpoint 1: 404 is classified by what actually answered", () => {
  it("F: a 404 carrying the route's own JSON error (authorizeProjectAccess's 'Project not found.') -> terminal", () => {
    assert.equal(classifySyncResponseStatus(404, true), "terminal");
  });

  it("a 404 WITHOUT the route's JSON error body (the route isn't at this API origin) -> retryable environment problem", () => {
    assert.equal(classifySyncResponseStatus(404, false), "retryable");
    assert.equal(classifySyncResponseStatus(404), "retryable");
  });

  it("the structured-body flag never changes any other status's classification", () => {
    assert.equal(classifySyncResponseStatus(401, true), "authorization");
    assert.equal(classifySyncResponseStatus(403, true), "authorization");
    assert.equal(classifySyncResponseStatus(409, false), "terminal");
    assert.equal(classifySyncResponseStatus(500, true), "retryable");
  });
});

const PHOTO_BYTES = "photo-bytes-1";
const PHOTO_HASH = await sha256Hex(new TextEncoder().encode(PHOTO_BYTES));

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    localSubmissionId: "sub-1",
    userId: "user-1",
    companyId: "company-A",
    projectId: "project-A",
    syncState: "pending",
    claimToken: null,
    claimedAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    errorKind: null,
    serverSubmissionId: null,
    snapshotPayload: {
      submissionId: "sub-1",
      photoUploads: [{ storagePath: "local-photo://photo-1", publicUrl: "local-photo://photo-1", filename: "a.jpg" }],
    } as unknown as Entry["snapshotPayload"],
    snapshotPhotos: [
      {
        localPhotoId: "photo-1",
        fieldName: "vehiclePhoto",
        group: "vehicle",
        originalFilename: "a.jpg",
        mimeType: "image/jpeg",
        sizeBytes: PHOTO_BYTES.length,
        contentHash: PHOTO_HASH,
        filesystemPath: "photos/photo-1.jpg",
      },
    ],
    snapshotDefinitionSchemaVersion: 2,
    snapshotTechnicianSubmittedAt: "2026-02-01T00:00:00.000Z",
    submissionSnapshotHash: "hash-abc",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const DEFAULT_PHOTO: LocalPhoto = {
  localPhotoId: "photo-1",
  userId: "user-1",
  projectId: "project-A",
  localSubmissionId: "sub-1",
  fieldName: "vehiclePhoto",
  group: "vehicle",
  originalFilename: "a.jpg",
  mimeType: "image/jpeg",
  sizeBytes: PHOTO_BYTES.length,
  filesystemPath: "photos/photo-1.jpg",
  remoteStoragePath: null,
  remoteUploadedAt: null,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

/** An in-memory outbox with the real claim semantics: CAS claim, claim-token-guarded records, isOutboxRowClaimable listing. */
function fakeEngine(
  options: {
    photoMetadata?: LocalPhoto | null;
    photoBlob?: Blob | null;
    sessions?: Array<{ accessToken: string; userId: string } | null>;
    respond?: (path: string) => Response;
  } = {},
) {
  const rows = new Map<string, Entry>([["sub-1", makeEntry()]]);
  const requests: string[] = [];
  const uploads: string[] = [];
  const serverConfirmations: string[] = [];
  const sessions = options.sessions ?? [];
  let sessionCall = 0;
  const photoMetadata = options.photoMetadata === undefined ? DEFAULT_PHOTO : options.photoMetadata;

  const deps: SyncEngineDeps = {
    outboxRepo: {
      async listClaimableOutboxEntries<T>(userId: string) {
        return [...rows.values()].filter((r) => r.userId === userId && isOutboxRowClaimable(r.syncState, r.errorKind)) as unknown as T[];
      },
      async tryClaimOutboxEntry(id, claimToken) {
        const row = rows.get(id);
        if (!row || !["pending", "failed", "authorization-blocked"].includes(row.syncState)) return false;
        rows.set(id, { ...row, syncState: "syncing", claimToken, attemptCount: row.attemptCount + 1 });
        return true;
      },
      async loadOutboxEntry<T>(id: string) {
        return (rows.get(id) ?? null) as unknown as T;
      },
      async recordOutboxSyncFailure(id, claimToken, error, errorKind) {
        const row = rows.get(id);
        if (row?.claimToken === claimToken) rows.set(id, { ...row, syncState: "failed", lastError: error, errorKind });
      },
      async recordOutboxAuthorizationBlocked(id, claimToken) {
        const row = rows.get(id);
        if (row?.claimToken === claimToken) rows.set(id, { ...row, syncState: "authorization-blocked" });
      },
      async recordOutboxServerConfirmed(id, claimToken, serverSubmissionId) {
        const row = rows.get(id);
        if (row?.claimToken === claimToken) rows.set(id, { ...row, syncState: "server-confirmed", serverSubmissionId, lastError: null });
      },
    },
    localSubmissionRepo: {
      async recordServerConfirmation(id) {
        serverConfirmations.push(id);
      },
    },
    photoMetadataRepo: {
      async loadLocalPhotoMetadata() {
        return photoMetadata;
      },
      async recordRemoteUpload() {},
    },
    loadLocalPhotoBlob: async () => (options.photoBlob === undefined ? new Blob([PHOTO_BYTES]) : options.photoBlob),
    getSession: async () => {
      const session = sessions.length ? sessions[Math.min(sessionCall, sessions.length - 1)] : { accessToken: "token-1", userId: "user-1" };
      sessionCall += 1;
      return session;
    },
    isOnlineFresh: async () => true,
    postJson: async (path) => {
      requests.push(path);
      if (options.respond) return options.respond(path);
      if (path.endsWith("/photo-upload-url")) return jsonResponse(200, { path: "company-A/project-A/sub-1/vehicle/vehiclePhoto/photo-1.jpg", token: "t" });
      return jsonResponse(200, { submissionId: "sub-1", technicianSubmittedAt: "t", submissionSnapshotHash: "hash-abc", serverConfirmedAt: "x" });
    },
    uploadToSignedUrl: async (path) => {
      uploads.push(path);
      return { error: null };
    },
    getPublicUrl: (path) => `https://storage.example/${path}`,
    now: () => "2026-02-02T00:00:00.000Z",
  };
  return { deps, rows, requests, uploads, serverConfirmations };
}

const finalizeCalls = (requests: string[]) => requests.filter((p) => p.endsWith("/finalize")).length;

describe("runSyncPass — Checkpoint 1 failure classification end to end", () => {
  it("K: a successful sync confirms once, and a later pass never re-sends it", async () => {
    const engine = fakeEngine();
    await runSyncPass("user-1", "claim-1", engine.deps);
    await runSyncPass("user-1", "claim-1", engine.deps);
    assert.equal(engine.rows.get("sub-1")?.syncState, "server-confirmed");
    assert.equal(finalizeCalls(engine.requests), 1);
    assert.deepEqual(engine.serverConfirmations, ["sub-1"]);
  });

  it("F: the finalize route's own 404 (project not found) is terminal — recorded once, never re-attempted", async () => {
    const engine = fakeEngine({
      respond: (path) =>
        path.endsWith("/finalize") ? jsonResponse(404, { error: "Project not found." }) : jsonResponse(200, { path: "p", token: "t" }),
    });
    await runSyncPass("user-1", "claim-1", engine.deps);
    const row = engine.rows.get("sub-1")!;
    assert.equal(row.syncState, "failed");
    assert.equal(row.errorKind, "terminal");
    assert.equal(row.lastError, "Project not found.");

    await runSyncPass("user-1", "claim-1", engine.deps);
    await runSyncPass("user-1", "claim-1", engine.deps);
    assert.equal(finalizeCalls(engine.requests), 1, "a terminal 404 must never loop");
    assert.equal(engine.rows.get("sub-1")?.attemptCount, 1);
  });

  it("F: a 404 without the route's JSON body is a retryable environment problem with a clear message", async () => {
    const engine = fakeEngine({
      respond: () => new Response("<html>Not Found</html>", { status: 404, headers: { "Content-Type": "text/html" } }),
    });
    await runSyncPass("user-1", "claim-1", engine.deps);
    const row = engine.rows.get("sub-1")!;
    assert.equal(row.syncState, "failed");
    assert.equal(row.errorKind, "retryable");
    assert.match(row.lastError ?? "", /wasn't found at this server address \(404\)/);
    assert.equal(isOutboxRowClaimable(row.syncState, row.errorKind), true);
  });

  it("G: a frozen photo whose local metadata is gone is terminal — not retried, nothing sent", async () => {
    const engine = fakeEngine({ photoMetadata: null });
    await runSyncPass("user-1", "claim-1", engine.deps);
    await runSyncPass("user-1", "claim-1", engine.deps);
    const row = engine.rows.get("sub-1")!;
    assert.equal(row.errorKind, "terminal");
    assert.match(row.lastError ?? "", /missing from this device's durable storage/);
    assert.equal(row.attemptCount, 1);
    assert.equal(engine.requests.length, 0);
  });

  it("G: a frozen photo whose file is gone is terminal — not retried", async () => {
    const engine = fakeEngine({ photoBlob: null });
    await runSyncPass("user-1", "claim-1", engine.deps);
    await runSyncPass("user-1", "claim-1", engine.deps);
    assert.equal(engine.rows.get("sub-1")?.errorKind, "terminal");
    assert.equal(engine.rows.get("sub-1")?.attemptCount, 1);
  });

  it("G: a frozen photo whose bytes changed on disk is terminal — the different bytes are never uploaded", async () => {
    const engine = fakeEngine({ photoBlob: new Blob(["tampered"]) });
    await runSyncPass("user-1", "claim-1", engine.deps);
    assert.equal(engine.rows.get("sub-1")?.errorKind, "terminal");
    assert.equal(engine.uploads.length, 0);
  });

  it("E: a transient 503 stays retryable — the next pass tries again and can succeed", async () => {
    let failFinalize = true;
    const engine = fakeEngine({
      respond: (path) => {
        if (path.endsWith("/photo-upload-url")) return jsonResponse(200, { path: "p", token: "t" });
        if (failFinalize) return jsonResponse(503, { error: "Service unavailable" });
        return jsonResponse(200, { submissionId: "sub-1", technicianSubmittedAt: "t", submissionSnapshotHash: "hash-abc", serverConfirmedAt: "x" });
      },
    });
    await runSyncPass("user-1", "claim-1", engine.deps);
    assert.equal(engine.rows.get("sub-1")?.errorKind, "retryable");

    failFinalize = false;
    await runSyncPass("user-1", "claim-1", engine.deps);
    assert.equal(engine.rows.get("sub-1")?.syncState, "server-confirmed");
    assert.equal(finalizeCalls(engine.requests), 2);
  });

  it("a 403 stays authorization-blocked (distinct from failure) and remains claimable for a re-check", async () => {
    const engine = fakeEngine({ respond: () => jsonResponse(403, { error: "Not assigned to this project." }) });
    await runSyncPass("user-1", "claim-1", engine.deps);
    const row = engine.rows.get("sub-1")!;
    assert.equal(row.syncState, "authorization-blocked");
    assert.equal(isOutboxRowClaimable(row.syncState, row.errorKind), true);
  });

  it("never claims one user's work while a different user's session is signed in", async () => {
    const engine = fakeEngine({ sessions: [{ accessToken: "token-2", userId: "user-2" }] });
    await runSyncPass("user-1", "claim-1", engine.deps);
    assert.equal(engine.rows.get("sub-1")?.syncState, "pending");
    assert.equal(engine.requests.length, 0);
  });

  it("if the signed-in user changes mid-sync, the entry is never finalized under the new user's credentials", async () => {
    const engine = fakeEngine({
      sessions: [
        { accessToken: "token-1", userId: "user-1" }, // pass-level check
        { accessToken: "token-1", userId: "user-1" }, // before photo upload
        { accessToken: "token-2", userId: "user-2" }, // before finalize
      ],
    });
    await runSyncPass("user-1", "claim-1", engine.deps);
    assert.equal(finalizeCalls(engine.requests), 0);
    assert.equal(engine.rows.get("sub-1")?.syncState, "authorization-blocked", "stays claimable for when user-1 signs back in");
  });
});

describe("createSingleFlightSyncRunner — H: overlapping triggers never produce overlapping passes", () => {
  function controllablePass() {
    const state = { active: 0, maxActive: 0 };
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const runPass = async (userId: string) => {
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      started.push(userId);
      await new Promise<void>((resolve) => releases.push(resolve));
      state.active -= 1;
    };
    const releaseNext = async () => {
      while (!releases.length) await new Promise((r) => setTimeout(r, 0));
      releases.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { runPass, started, releaseNext, state };
  }

  it("a burst of triggers (resume, reconnect, submit, Retry) during a pass runs exactly one follow-up pass, never two at once", async () => {
    const pass = controllablePass();
    const request = createSingleFlightSyncRunner(pass.runPass);

    const first = request("user-1");
    const burst = [request("user-1"), request("user-1"), request("user-1")];
    assert.equal(pass.started.length, 1);

    await pass.releaseNext(); // first pass ends -> exactly one follow-up starts
    assert.equal(pass.started.length, 2);
    await pass.releaseNext();
    await Promise.all([first, ...burst]);

    assert.equal(pass.state.maxActive, 1);
    assert.equal(pass.started.length, 2);
  });

  it("every caller's promise settles only after the follow-up pass it asked for has run", async () => {
    const pass = controllablePass();
    const request = createSingleFlightSyncRunner(pass.runPass);
    void request("user-1");
    let lateSettled = false;
    const late = request("user-1").then(() => {
      lateSettled = true;
    });
    await pass.releaseNext();
    assert.equal(lateSettled, false, "must not settle before the follow-up pass ran");
    await pass.releaseNext();
    await late;
    assert.equal(lateSettled, true);
  });

  it("with no trigger during a pass, nothing runs again (no polling)", async () => {
    const pass = controllablePass();
    const request = createSingleFlightSyncRunner(pass.runPass);
    const run = request("user-1");
    await pass.releaseNext();
    await run;
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(pass.started.length, 1);
  });

  it("a follow-up requested for a different signed-in user runs for that user", async () => {
    const pass = controllablePass();
    const request = createSingleFlightSyncRunner(pass.runPass);
    const run = request("user-1");
    void request("user-2");
    await pass.releaseNext();
    await pass.releaseNext();
    await run;
    assert.deepEqual(pass.started, ["user-1", "user-2"]);
  });

  it("a failing pass neither wedges the runner nor escapes to the caller", async () => {
    let calls = 0;
    const request = createSingleFlightSyncRunner(async () => {
      calls += 1;
      throw new Error("boom");
    });
    await request("user-1");
    await request("user-1");
    assert.equal(calls, 2);
  });
});
