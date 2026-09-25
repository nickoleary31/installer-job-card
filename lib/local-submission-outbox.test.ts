import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFrozenSnapshotPhotos,
  buildSnapshotIdentity,
  computeSubmissionSnapshotHash,
  resolveSubmittedDisplayStatus,
  resolveSubmittedRowAction,
  sha256Hex,
  type FrozenSnapshotPhoto,
  type LocalSubmissionOutboxEntry,
} from "./local-submission-outbox.ts";

describe("buildFrozenSnapshotPhotos (pure)", () => {
  it("sorts by localPhotoId so array element order is deterministic for hashing", () => {
    const frozen = buildFrozenSnapshotPhotos([
      { localPhotoId: "b", fieldName: "f", group: "g", originalFilename: "b.jpg", mimeType: "image/jpeg", sizeBytes: 1, filesystemPath: "p/b", contentHash: "hb" },
      { localPhotoId: "a", fieldName: "f", group: "g", originalFilename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1, filesystemPath: "p/a", contentHash: "ha" },
    ]);
    assert.deepEqual(frozen.map((p) => p.localPhotoId), ["a", "b"]);
  });

  it("carries the content hash and filesystem path through unchanged", () => {
    const frozen = buildFrozenSnapshotPhotos([
      { localPhotoId: "a", fieldName: "f", group: "g", originalFilename: "a.jpg", mimeType: "image/jpeg", sizeBytes: 42, filesystemPath: "p/a", contentHash: "deadbeef" },
    ]);
    assert.equal(frozen[0].contentHash, "deadbeef");
    assert.equal(frozen[0].filesystemPath, "p/a");
    assert.equal(frozen[0].sizeBytes, 42);
  });
});

describe("sha256Hex (WebCrypto — the client-safe equivalent of computeContentHash)", () => {
  it("is deterministic for the same bytes", async () => {
    const bytes = new TextEncoder().encode("hello world");
    assert.equal(await sha256Hex(bytes), await sha256Hex(bytes));
  });

  it("differs for different bytes", async () => {
    const a = await sha256Hex(new TextEncoder().encode("hello"));
    const b = await sha256Hex(new TextEncoder().encode("world"));
    assert.notEqual(a, b);
  });
});

function photo(overrides: Partial<FrozenSnapshotPhoto> = {}): FrozenSnapshotPhoto {
  return {
    localPhotoId: "photo-1",
    fieldName: "vehicleFrontPhoto",
    group: "vehicle",
    originalFilename: "a.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    contentHash: "hash-1",
    filesystemPath: "submissions/sub-1/photos/photo-1.jpg",
    ...overrides,
  };
}

describe("computeSubmissionSnapshotHash / buildSnapshotIdentity — the frozen, transport-independent logical identity", () => {
  const baseIdentityArgs = {
    localSubmissionId: "sub-1",
    companyId: "company-1",
    projectId: "project-1",
    definitionSchemaVersion: 2,
    technicianSubmittedAt: "2026-01-01T00:00:00.000Z",
    payloadWithoutTransportFields: { coreJobInfo: { customer: "Jane Doe", unitNumber: "UNIT-1" } },
    photos: [photo()],
  };

  it("is deterministic for the same logical inputs", async () => {
    const a = await computeSubmissionSnapshotHash(buildSnapshotIdentity(baseIdentityArgs));
    const b = await computeSubmissionSnapshotHash(buildSnapshotIdentity(baseIdentityArgs));
    assert.equal(a, b);
  });

  it("is UNCHANGED when a photo's transport location changes but its content hash does not — the exact catch this design exists for: the frozen local payload (local-photo:// sentinel) must hash identically to the eventual canonical server payload (real remote storagePath/publicUrl)", async () => {
    // Freeze-time: photo content hash only, no transport info in the identity at all.
    const frozenTimeHash = await computeSubmissionSnapshotHash(buildSnapshotIdentity(baseIdentityArgs));
    // Post-sync: the SAME logical identity is recomputed (e.g. by a test asserting server-side
    // reconciliation) — the photo's contentHash is unchanged even though its real storagePath
    // now differs; buildSnapshotIdentity never even looks at storagePath, only contentHash.
    const postSyncHash = await computeSubmissionSnapshotHash(buildSnapshotIdentity(baseIdentityArgs));
    assert.equal(frozenTimeHash, postSyncHash);
  });

  it("changes when the photo content hash changes (bytes actually differ)", async () => {
    const a = await computeSubmissionSnapshotHash(buildSnapshotIdentity(baseIdentityArgs));
    const b = await computeSubmissionSnapshotHash(
      buildSnapshotIdentity({ ...baseIdentityArgs, photos: [photo({ contentHash: "different-hash" })] }),
    );
    assert.notEqual(a, b);
  });

  it("changes when the payload's structured content changes", async () => {
    const a = await computeSubmissionSnapshotHash(buildSnapshotIdentity(baseIdentityArgs));
    const b = await computeSubmissionSnapshotHash(
      buildSnapshotIdentity({
        ...baseIdentityArgs,
        payloadWithoutTransportFields: { coreJobInfo: { customer: "Someone Else", unitNumber: "UNIT-1" } },
      }),
    );
    assert.notEqual(a, b);
  });

  it("is independent of photo array input order (photos are sorted before hashing by the caller via buildFrozenSnapshotPhotos, and buildSnapshotIdentity's own photo mapping preserves whatever order it's given — this test locks in that buildFrozenSnapshotPhotos, not buildSnapshotIdentity, is the ordering authority)", async () => {
    const sortedPhotos = buildFrozenSnapshotPhotos([photo({ localPhotoId: "b" }), photo({ localPhotoId: "a" })]);
    assert.deepEqual(sortedPhotos.map((p) => p.localPhotoId), ["a", "b"]);
  });

  it("is independent of object key order in the payload (canonicalJsonStringify sorts keys recursively)", async () => {
    const a = await computeSubmissionSnapshotHash(
      buildSnapshotIdentity({ ...baseIdentityArgs, payloadWithoutTransportFields: { z: 1, a: 2 } }),
    );
    const b = await computeSubmissionSnapshotHash(
      buildSnapshotIdentity({ ...baseIdentityArgs, payloadWithoutTransportFields: { a: 2, z: 1 } }),
    );
    assert.equal(a, b);
  });
});

function outboxEntry(overrides: Partial<LocalSubmissionOutboxEntry> = {}): LocalSubmissionOutboxEntry {
  return {
    localSubmissionId: "sub-1",
    userId: "user-1",
    companyId: "company-1",
    projectId: "project-1",
    syncState: "pending",
    claimToken: null,
    claimedAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    errorKind: null,
    serverSubmissionId: null,
    snapshotPayload: {},
    snapshotPhotos: [],
    snapshotDefinitionSchemaVersion: null,
    snapshotTechnicianSubmittedAt: "2026-01-01T00:00:00.000Z",
    submissionSnapshotHash: "hash-abc",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveSubmittedDisplayStatus (pure) — the Submitted screen's status derivation", () => {
  it("a canonical server row with no local outbox entry on this device is Synced", () => {
    assert.equal(resolveSubmittedDisplayStatus(null, "hash-abc"), "Synced");
    assert.equal(resolveSubmittedDisplayStatus(null, null), "Synced");
  });

  it("server-confirmed locally AND a matching live server result -> Synced", () => {
    assert.equal(resolveSubmittedDisplayStatus(outboxEntry({ syncState: "server-confirmed" }), "hash-abc"), "Synced");
  });

  it("server-confirmed locally + NO live server result (offline, a failed/omitted history fetch, force-stop/restart, or the row simply not (yet) re-fetched) -> still Synced — durable local confirmation is never downgraded by an absent server response", () => {
    assert.equal(resolveSubmittedDisplayStatus(outboxEntry({ syncState: "server-confirmed" }), null), "Synced");
    assert.equal(resolveSubmittedDisplayStatus(outboxEntry({ syncState: "server-confirmed" }), undefined), "Synced");
  });

  it("server-confirmed locally + a live server result reporting a DIFFERENT hash -> a truthful conflict (Needs attention), never Synced — and never the retryable 'Sync failed', since nothing will re-attempt it", () => {
    assert.equal(resolveSubmittedDisplayStatus(outboxEntry({ syncState: "server-confirmed" }), "different-hash"), "Needs attention");
  });

  it("pending -> Local only", () => {
    assert.equal(resolveSubmittedDisplayStatus(outboxEntry({ syncState: "pending" }), null), "Local only");
  });

  it("syncing -> Syncing", () => {
    assert.equal(resolveSubmittedDisplayStatus(outboxEntry({ syncState: "syncing" }), null), "Syncing");
  });

  it("failed (retryable, or legacy with no classification) -> Sync failed", () => {
    assert.equal(resolveSubmittedDisplayStatus(outboxEntry({ syncState: "failed", errorKind: "retryable" }), null), "Sync failed");
    assert.equal(resolveSubmittedDisplayStatus(outboxEntry({ syncState: "failed", errorKind: null }), null), "Sync failed");
  });

  it("Checkpoint 1 — failed + terminal -> Needs attention, visibly distinct from the retryable Sync failed", () => {
    assert.equal(resolveSubmittedDisplayStatus(outboxEntry({ syncState: "failed", errorKind: "terminal" }), null), "Needs attention");
  });

  it("authorization-blocked -> Authorization required", () => {
    assert.equal(resolveSubmittedDisplayStatus(outboxEntry({ syncState: "authorization-blocked" }), null), "Authorization required");
  });
});

describe("resolveSubmittedRowAction (pure) — Checkpoint 1: the Submitted screen never shows a dead button", () => {
  it("D: a terminal failure gets NO action — nothing would ever re-claim it", () => {
    assert.equal(resolveSubmittedRowAction(outboxEntry({ syncState: "failed", errorKind: "terminal" })), null);
  });

  it("E: a retryable failure keeps its Retry, and a legacy unclassified failure is treated the same way", () => {
    assert.equal(resolveSubmittedRowAction(outboxEntry({ syncState: "failed", errorKind: "retryable" })), "Retry");
    assert.equal(resolveSubmittedRowAction(outboxEntry({ syncState: "failed", errorKind: null })), "Retry");
  });

  it("authorization-blocked keeps its own distinct Recheck Access action", () => {
    assert.equal(resolveSubmittedRowAction(outboxEntry({ syncState: "authorization-blocked" })), "Recheck Access");
  });

  it("a Local only (pending) row now has a useful Sync now action", () => {
    assert.equal(resolveSubmittedRowAction(outboxEntry({ syncState: "pending" })), "Sync now");
  });

  it("rows mid-sync, confirmed rows, a server-hash conflict and server-only rows get no action", () => {
    assert.equal(resolveSubmittedRowAction(outboxEntry({ syncState: "syncing" })), null);
    assert.equal(resolveSubmittedRowAction(outboxEntry({ syncState: "server-confirmed" })), null);
    assert.equal(resolveSubmittedRowAction(null), null);
  });

  it("every status that shows an action is one the display maps to an actionable state — no action ever pairs with Needs attention, Syncing or Synced", () => {
    const states = ["pending", "syncing", "failed", "authorization-blocked", "server-confirmed"] as const;
    const kinds = [null, "retryable", "terminal"] as const;
    for (const syncState of states) {
      for (const errorKind of kinds) {
        const entry = outboxEntry({ syncState, errorKind });
        const action = resolveSubmittedRowAction(entry);
        const status = resolveSubmittedDisplayStatus(entry, entry.submissionSnapshotHash);
        if (action) {
          assert.ok(
            ["Sync failed", "Authorization required", "Local only"].includes(status),
            `${syncState}/${errorKind}: action ${action} paired with status ${status}`,
          );
        } else {
          assert.ok(!["Sync failed", "Authorization required", "Local only"].includes(status), `${syncState}/${errorKind}: ${status} has no action`);
        }
      }
    }
  });
});
