import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLocalPhotoFilesystemPath,
  buildLocalPhotoUri,
  deleteLocalPhotoDurably,
  loadLocalPhotoBlob,
  parseLocalPhotoUri,
  savePhotoDurably,
  verifyDurablePhotoReferences,
  type LocalPhoto,
  type LocalPhotoMetadataInput,
  type LoadLocalPhotoBlobDeps,
  type SavePhotoDurablyDeps,
  type DeleteLocalPhotoDurablyDeps,
} from "./local-photo.ts";

describe("buildLocalPhotoFilesystemPath (pure)", () => {
  it("is deterministic, opaque, and independent of the original filename", () => {
    const path = buildLocalPhotoFilesystemPath("sub-1", "photo-1", "image/jpeg");
    assert.equal(path, "submissions/sub-1/photos/photo-1.jpg");
    assert.ok(!path.includes("original"), "must never embed the original filename");
  });

  it("maps known mime types to their extension and falls back to jpg for anything else", () => {
    assert.match(buildLocalPhotoFilesystemPath("s", "p", "image/png"), /\.png$/);
    assert.match(buildLocalPhotoFilesystemPath("s", "p", "image/webp"), /\.webp$/);
    assert.match(buildLocalPhotoFilesystemPath("s", "p", "image/heic"), /\.jpg$/);
  });
});

describe("local-photo:// sentinel URI (pure)", () => {
  it("round-trips a localPhotoId through build/parse", () => {
    const uri = buildLocalPhotoUri("abc-123");
    assert.equal(uri, "local-photo://abc-123");
    assert.equal(parseLocalPhotoUri(uri), "abc-123");
  });

  it("returns null for a real remote URL", () => {
    assert.equal(parseLocalPhotoUri("https://example.supabase.co/storage/v1/object/public/x.jpg"), null);
  });
});

/** Fakes standing in for getAppFilesystem()/getLocalPhotoMetadataRepository() — no device/SQLite required. */
function fakeDeps(overrides: Partial<{ writeFails: boolean; metadataFails: boolean }> = {}) {
  const files = new Map<string, Blob>();
  const metadata = new Map<string, LocalPhoto>();
  const writeCalls: string[] = [];
  const deleteCalls: string[] = [];
  const fs = {
    async writeFile(key: string, data: Blob) {
      writeCalls.push(key);
      if (overrides.writeFails) throw new Error("simulated filesystem write failure");
      files.set(key, data);
    },
    async deleteFile(key: string) {
      deleteCalls.push(key);
      files.delete(key);
    },
    async readFile(key: string): Promise<Blob | null> {
      return files.get(key) ?? null;
    },
  };
  const metadataRepo = {
    async saveLocalPhotoMetadata(input: LocalPhotoMetadataInput): Promise<LocalPhoto> {
      if (overrides.metadataFails) throw new Error("simulated metadata write failure");
      const now = new Date().toISOString();
      const record: LocalPhoto = { ...input, createdAt: now, updatedAt: now };
      metadata.set(input.localPhotoId, record);
      return record;
    },
    async loadLocalPhotoMetadata(id: string): Promise<LocalPhoto | null> {
      return metadata.get(id) ?? null;
    },
    async deleteLocalPhotoMetadata(id: string): Promise<void> {
      metadata.delete(id);
    },
  };
  return { fs, metadataRepo, files, metadataMap: metadata, writeCalls, deleteCalls };
}

const SAMPLE_BYTES = new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" });

describe("savePhotoDurably (pure ordering, injected deps)", () => {
  it("writes the file BEFORE the metadata row, in that order", async () => {
    const { fs, metadataRepo } = fakeDeps();
    const calls: string[] = [];
    const wrappedFs = {
      ...fs,
      writeFile: async (k: string, d: Blob) => {
        calls.push("write");
        return fs.writeFile(k, d);
      },
    };
    const wrappedRepo = {
      ...metadataRepo,
      saveLocalPhotoMetadata: async (i: LocalPhotoMetadataInput) => {
        calls.push("metadata");
        return metadataRepo.saveLocalPhotoMetadata(i);
      },
    };
    const deps: SavePhotoDurablyDeps = { fs: wrappedFs, metadataRepo: wrappedRepo, generateId: () => "photo-1" };
    await savePhotoDurably(
      { userId: "user-1", projectId: "project-1", localSubmissionId: "sub-1", fieldName: "vehicleFront", group: "vehicle", bytes: SAMPLE_BYTES, originalFilename: "IMG_1.jpg", mimeType: "image/jpeg" },
      deps,
    );
    assert.deepEqual(calls, ["write", "metadata"]);
  });

  it("on success, returns a LocalPhoto whose filesystemPath actually has bytes written under it", async () => {
    const { fs, metadataRepo, files } = fakeDeps();
    const deps: SavePhotoDurablyDeps = { fs, metadataRepo, generateId: () => "photo-1" };
    const result = await savePhotoDurably(
      { userId: "user-1", projectId: "project-1", localSubmissionId: "sub-1", fieldName: "vehicleFront", group: "vehicle", bytes: SAMPLE_BYTES, originalFilename: "IMG_1.jpg", mimeType: "image/jpeg" },
      deps,
    );
    assert.equal(result.localPhotoId, "photo-1");
    assert.equal(result.filesystemPath, "submissions/sub-1/photos/photo-1.jpg");
    assert.ok(files.has(result.filesystemPath));
    assert.equal(result.sizeBytes, SAMPLE_BYTES.size);
  });

  it("if the filesystem write fails, no metadata row is ever attempted (structurally impossible dangling row)", async () => {
    const { fs, metadataRepo, metadataMap } = fakeDeps({ writeFails: true });
    const deps: SavePhotoDurablyDeps = { fs, metadataRepo, generateId: () => "photo-1" };
    await assert.rejects(
      () =>
        savePhotoDurably(
          { userId: "user-1", projectId: "project-1", localSubmissionId: "sub-1", fieldName: "vehicleFront", group: "vehicle", bytes: SAMPLE_BYTES, originalFilename: "IMG_1.jpg", mimeType: "image/jpeg" },
          deps,
        ),
      /simulated filesystem write failure/,
    );
    assert.equal(metadataMap.size, 0, "no metadata row must exist when the file was never written");
  });

  it("if the metadata write fails after a successful filesystem write, the orphan file is cleaned up", async () => {
    const { fs, metadataRepo, files, deleteCalls } = fakeDeps({ metadataFails: true });
    const deps: SavePhotoDurablyDeps = { fs, metadataRepo, generateId: () => "photo-1" };
    await assert.rejects(
      () =>
        savePhotoDurably(
          { userId: "user-1", projectId: "project-1", localSubmissionId: "sub-1", fieldName: "vehicleFront", group: "vehicle", bytes: SAMPLE_BYTES, originalFilename: "IMG_1.jpg", mimeType: "image/jpeg" },
          deps,
        ),
      /simulated metadata write failure/,
    );
    assert.equal(files.size, 0, "the orphaned file must be cleaned up");
    assert.deepEqual(deleteCalls, ["submissions/sub-1/photos/photo-1.jpg"]);
  });

  it("orphan-cleanup failure never masks the original metadata error", async () => {
    const { metadataRepo } = fakeDeps({ metadataFails: true });
    const fsThatFailsToDelete = {
      async writeFile() {},
      async deleteFile() {
        throw new Error("simulated cleanup failure — must be swallowed");
      },
    };
    const deps: SavePhotoDurablyDeps = { fs: fsThatFailsToDelete, metadataRepo, generateId: () => "photo-1" };
    await assert.rejects(
      () =>
        savePhotoDurably(
          { userId: "user-1", projectId: "project-1", localSubmissionId: "sub-1", fieldName: "vehicleFront", group: "vehicle", bytes: SAMPLE_BYTES, originalFilename: "IMG_1.jpg", mimeType: "image/jpeg" },
          deps,
        ),
      /simulated metadata write failure/,
    );
  });
});

describe("deleteLocalPhotoDurably (pure ordering, injected deps)", () => {
  it("deletes metadata BEFORE the filesystem file, in that order", async () => {
    const { fs, metadataRepo } = fakeDeps();
    const saveDeps: SavePhotoDurablyDeps = { fs, metadataRepo, generateId: () => "photo-1" };
    await savePhotoDurably(
      { userId: "user-1", projectId: "project-1", localSubmissionId: "sub-1", fieldName: "vehicleFront", group: "vehicle", bytes: SAMPLE_BYTES, originalFilename: "IMG_1.jpg", mimeType: "image/jpeg" },
      saveDeps,
    );
    const calls: string[] = [];
    const wrappedRepo = {
      ...metadataRepo,
      deleteLocalPhotoMetadata: async (id: string) => {
        calls.push("metadata");
        return metadataRepo.deleteLocalPhotoMetadata(id);
      },
    };
    const wrappedFs = {
      ...fs,
      deleteFile: async (k: string) => {
        calls.push("file");
        return fs.deleteFile(k);
      },
    };
    const deleteDeps: DeleteLocalPhotoDurablyDeps = { fs: wrappedFs, metadataRepo: wrappedRepo };
    await deleteLocalPhotoDurably("photo-1", deleteDeps);
    assert.deepEqual(calls, ["metadata", "file"]);
  });

  it("a failed filesystem delete still leaves the metadata row gone (orphan file is the safe failure mode, never a dangling row)", async () => {
    const { fs, metadataRepo, files, metadataMap } = fakeDeps();
    const saveDeps: SavePhotoDurablyDeps = { fs, metadataRepo, generateId: () => "photo-1" };
    await savePhotoDurably(
      { userId: "user-1", projectId: "project-1", localSubmissionId: "sub-1", fieldName: "vehicleFront", group: "vehicle", bytes: SAMPLE_BYTES, originalFilename: "IMG_1.jpg", mimeType: "image/jpeg" },
      saveDeps,
    );
    const fsThatFailsToDelete = { ...fs, deleteFile: async () => { throw new Error("simulated delete failure"); } };
    const deleteDeps: DeleteLocalPhotoDurablyDeps = { fs: fsThatFailsToDelete, metadataRepo };
    await deleteLocalPhotoDurably("photo-1", deleteDeps);
    assert.equal(metadataMap.has("photo-1"), false, "metadata must be gone even though the file delete failed");
    assert.ok(files.has("submissions/sub-1/photos/photo-1.jpg"), "the orphaned file is the expected safe residue");
  });

  it("deleting an id with no metadata row is a safe no-op", async () => {
    const { fs, metadataRepo } = fakeDeps();
    const deleteDeps: DeleteLocalPhotoDurablyDeps = { fs, metadataRepo };
    await assert.doesNotReject(() => deleteLocalPhotoDurably("does-not-exist", deleteDeps));
  });
});

describe("loadLocalPhotoBlob (MIME-type re-stamping, injected deps)", () => {
  it("re-stamps an untyped Blob (the real native filesystem's base64 round-trip never sets one) with the metadata's recorded mimeType", async () => {
    const { fs, metadataRepo } = fakeDeps();
    const saveDeps: SavePhotoDurablyDeps = { fs, metadataRepo, generateId: () => "photo-1" };
    await savePhotoDurably(
      { userId: "user-1", projectId: "project-1", localSubmissionId: "sub-1", fieldName: "vehicleFront", group: "vehicle", bytes: SAMPLE_BYTES, originalFilename: "IMG_1.jpg", mimeType: "image/jpeg" },
      saveDeps,
    );
    const untypedFs = {
      readFile: async (key: string) => {
        const blob = await fs.readFile(key);
        return blob ? new Blob([blob]) : null; // simulates base64ToBlob's real, untyped return
      },
    };
    const loadDeps: LoadLocalPhotoBlobDeps = { fs: untypedFs, metadataRepo };
    const result = await loadLocalPhotoBlob("photo-1", loadDeps);
    assert.equal(result?.type, "image/jpeg");
    assert.equal(result?.size, SAMPLE_BYTES.size);
  });

  it("leaves an already-typed Blob (e.g. the web OPFS path) alone rather than re-wrapping it", async () => {
    const { fs, metadataRepo } = fakeDeps();
    const saveDeps: SavePhotoDurablyDeps = { fs, metadataRepo, generateId: () => "photo-1" };
    await savePhotoDurably(
      { userId: "user-1", projectId: "project-1", localSubmissionId: "sub-1", fieldName: "vehicleFront", group: "vehicle", bytes: SAMPLE_BYTES, originalFilename: "IMG_1.jpg", mimeType: "image/jpeg" },
      saveDeps,
    );
    const typedFs = {
      readFile: async (key: string) => {
        const blob = await fs.readFile(key);
        return blob ? new Blob([blob], { type: "image/webp" }) : null; // already typed — must not be overridden
      },
    };
    const loadDeps: LoadLocalPhotoBlobDeps = { fs: typedFs, metadataRepo };
    const result = await loadLocalPhotoBlob("photo-1", loadDeps);
    assert.equal(result?.type, "image/webp");
  });

  it("returns null when the metadata row is missing (never fabricates a blob)", async () => {
    const { fs, metadataRepo } = fakeDeps();
    const loadDeps: LoadLocalPhotoBlobDeps = { fs, metadataRepo };
    assert.equal(await loadLocalPhotoBlob("does-not-exist", loadDeps), null);
  });

  it("returns null when the file is missing even though metadata exists (fails safely, never throws)", async () => {
    const { fs, metadataRepo } = fakeDeps();
    const saveDeps: SavePhotoDurablyDeps = { fs, metadataRepo, generateId: () => "photo-1" };
    await savePhotoDurably(
      { userId: "user-1", projectId: "project-1", localSubmissionId: "sub-1", fieldName: "vehicleFront", group: "vehicle", bytes: SAMPLE_BYTES, originalFilename: "IMG_1.jpg", mimeType: "image/jpeg" },
      saveDeps,
    );
    const missingFileFs = { readFile: async () => null };
    const loadDeps: LoadLocalPhotoBlobDeps = { fs: missingFileFs, metadataRepo };
    assert.equal(await loadLocalPhotoBlob("photo-1", loadDeps), null);
  });
});

describe("verifyDurablePhotoReferences (missing-file truthfulness, injected loadBlob)", () => {
  it("keeps a reference whose durable photo genuinely loads", async () => {
    const references = [{ publicUrl: buildLocalPhotoUri("photo-1"), filename: "a.jpg" }];
    const result = await verifyDurablePhotoReferences(references, {
      loadBlob: async (id) => (id === "photo-1" ? new Blob(["bytes"]) : null),
    });
    assert.deepEqual(result.verified, references);
    assert.deepEqual(result.droppedLocalPhotoIds, []);
  });

  it("drops a reference whose metadata row exists but the file is missing/unreadable (loadBlob resolves null)", async () => {
    const references = [{ publicUrl: buildLocalPhotoUri("photo-missing"), filename: "a.jpg" }];
    const result = await verifyDurablePhotoReferences(references, { loadBlob: async () => null });
    assert.deepEqual(result.verified, []);
    assert.deepEqual(result.droppedLocalPhotoIds, ["photo-missing"]);
  });

  it("drops a reference when the load path throws rather than crashing the caller", async () => {
    const references = [{ publicUrl: buildLocalPhotoUri("photo-throws"), filename: "a.jpg" }];
    const result = await verifyDurablePhotoReferences(references, {
      loadBlob: async () => {
        throw new Error("simulated native read failure");
      },
    });
    assert.deepEqual(result.verified, []);
    assert.deepEqual(result.droppedLocalPhotoIds, ["photo-throws"]);
  });

  it("passes a real (non-sentinel) remote publicUrl through unverified, never calling loadBlob for it", async () => {
    let loadBlobCalls = 0;
    const references = [{ publicUrl: "https://example.supabase.co/storage/v1/object/public/x.jpg", filename: "a.jpg" }];
    const result = await verifyDurablePhotoReferences(references, {
      loadBlob: async () => {
        loadBlobCalls += 1;
        return null;
      },
    });
    assert.deepEqual(result.verified, references);
    assert.equal(loadBlobCalls, 0, "a real remote URL must never be routed through the local durability check");
  });

  it("handles a mixed batch, verifying/dropping each reference independently", async () => {
    const references = [
      { publicUrl: buildLocalPhotoUri("photo-ok"), filename: "ok.jpg" },
      { publicUrl: buildLocalPhotoUri("photo-gone"), filename: "gone.jpg" },
      { publicUrl: "https://example.supabase.co/x.jpg", filename: "remote.jpg" },
    ];
    const result = await verifyDurablePhotoReferences(references, {
      loadBlob: async (id) => (id === "photo-ok" ? new Blob(["bytes"]) : null),
    });
    assert.deepEqual(result.verified, [references[0], references[2]]);
    assert.deepEqual(result.droppedLocalPhotoIds, ["photo-gone"]);
  });

  it("defaults to the real loadLocalPhotoBlob when no deps are injected (still returns null safely for a missing id, no device required)", async () => {
    // No native runtime here, so getLocalPhotoMetadataRepository() resolves to the
    // web stub — loadLocalPhotoBlob's own loadLocalPhotoMetadata call throws, which
    // verifyDurablePhotoReferences must swallow as a drop, not propagate.
    const references = [{ publicUrl: buildLocalPhotoUri("photo-1"), filename: "a.jpg" }];
    const result = await verifyDurablePhotoReferences(references);
    assert.deepEqual(result.verified, []);
    assert.deepEqual(result.droppedLocalPhotoIds, ["photo-1"]);
  });
});
