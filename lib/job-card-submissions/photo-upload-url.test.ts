import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handlePhotoUploadUrlRequest,
  isSafePathSegment,
  type PhotoStorageRepo,
  type PhotoUploadAccess,
  type PhotoUploadRequestInput,
} from "./photo-upload-url.ts";
import { buildRemotePhotoStoragePath } from "../local-photo.ts";

function requestInput(overrides: Partial<PhotoUploadRequestInput> = {}): PhotoUploadRequestInput {
  return {
    accessToken: "token-abc",
    companyId: "company-1",
    projectId: "project-1",
    localSubmissionId: "sub-1",
    localPhotoId: "photo-1",
    fieldName: "vehicleFrontPhoto",
    group: "vehicle",
    mimeType: "image/jpeg",
    ...overrides,
  };
}

function fakeStorage(): PhotoStorageRepo & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async createSignedUploadUrl(path: string) {
      calls.push(path);
      return { path, token: `token-for-${path}` };
    },
  };
}

function okAccess(storage: PhotoStorageRepo): PhotoUploadAccess {
  return { authorize: async () => ({ ok: true, storage }) };
}

function deniedAccess(status: number, error: string): PhotoUploadAccess {
  return { authorize: async () => ({ ok: false, status, error }) };
}

describe("isSafePathSegment (pure)", () => {
  it("accepts simple alphanumeric/dash/underscore identifiers", () => {
    assert.equal(isSafePathSegment("sub-1"), true);
    assert.equal(isSafePathSegment("photo_1"), true);
    assert.equal(isSafePathSegment("VehicleFrontPhoto123"), true);
  });

  it("rejects path traversal and path-separator attempts", () => {
    assert.equal(isSafePathSegment("../../etc/passwd"), false);
    assert.equal(isSafePathSegment("a/b"), false);
    assert.equal(isSafePathSegment(".."), false);
    assert.equal(isSafePathSegment(""), false);
    assert.equal(isSafePathSegment("a b"), false);
  });
});

describe("handlePhotoUploadUrlRequest — authentication/authorization", () => {
  it("propagates a 401 from a missing/invalid access token, before ever touching storage", async () => {
    const storage = fakeStorage();
    const access: PhotoUploadAccess = { authorize: async () => ({ ok: false, status: 401, error: "Unauthorized requester." }) };
    void storage;
    const result = await handlePhotoUploadUrlRequest(requestInput(), access);
    assert.equal(result.status, 401);
  });

  it("propagates a 403 for a requester with no project access", async () => {
    const result = await handlePhotoUploadUrlRequest(requestInput(), deniedAccess(403, "no access"));
    assert.equal(result.status, 403);
  });
});

describe("handlePhotoUploadUrlRequest — server-derived deterministic path", () => {
  it("the path handed to storage matches buildRemotePhotoStoragePath's own formula, never a client-supplied path (no such field even exists on the input type)", async () => {
    const storage = fakeStorage();
    const input = requestInput();
    await handlePhotoUploadUrlRequest(input, okAccess(storage));
    const expected = buildRemotePhotoStoragePath(
      input.companyId,
      input.projectId,
      input.localSubmissionId,
      input.group,
      input.fieldName,
      input.localPhotoId,
      input.mimeType,
    );
    assert.deepEqual(storage.calls, [expected]);
  });

  it("is deterministic: the SAME identity inputs produce the SAME path on a retry — required for retry-safe signed-upload overwrite", async () => {
    const storage = fakeStorage();
    const input = requestInput();
    await handlePhotoUploadUrlRequest(input, okAccess(storage));
    await handlePhotoUploadUrlRequest(input, okAccess(storage));
    assert.equal(storage.calls[0], storage.calls[1]);
  });

  it("different localPhotoId values produce different paths — no accidental collision across photos", async () => {
    const storage = fakeStorage();
    await handlePhotoUploadUrlRequest(requestInput({ localPhotoId: "photo-1" }), okAccess(storage));
    await handlePhotoUploadUrlRequest(requestInput({ localPhotoId: "photo-2" }), okAccess(storage));
    assert.notEqual(storage.calls[0], storage.calls[1]);
  });

  it("Phase 2H security reconciliation — the path is tenant-bound: it begins with companyId/projectId, not just localSubmissionId", async () => {
    const storage = fakeStorage();
    const input = requestInput({ companyId: "company-9", projectId: "project-42" });
    await handlePhotoUploadUrlRequest(input, okAccess(storage));
    assert.match(storage.calls[0], /^company-9\/project-42\//);
  });

  it("different company/project pairs produce different Storage namespaces even for the SAME localSubmissionId/localPhotoId — no cross-tenant collision", async () => {
    const storage = fakeStorage();
    await handlePhotoUploadUrlRequest(requestInput({ companyId: "company-A", projectId: "project-1" }), okAccess(storage));
    await handlePhotoUploadUrlRequest(requestInput({ companyId: "company-B", projectId: "project-1" }), okAccess(storage));
    assert.notEqual(storage.calls[0], storage.calls[1]);
    assert.match(storage.calls[0], /^company-A\//);
    assert.match(storage.calls[1], /^company-B\//);
  });

  it("uses the SAME company/project pair a retry would reuse (matching input) — a signed-upload retry for the same logical photo overwrites in place", async () => {
    const storage = fakeStorage();
    const input = requestInput({ companyId: "company-A", projectId: "project-1", localPhotoId: "photo-1" });
    await handlePhotoUploadUrlRequest(input, okAccess(storage));
    await handlePhotoUploadUrlRequest(input, okAccess(storage));
    assert.equal(storage.calls[0], storage.calls[1]);
  });
});

describe("handlePhotoUploadUrlRequest — wrong-tenant denial (project/company mismatch)", () => {
  it("a 409 from access.authorize (project belongs to a different company) is propagated, and no signed URL is ever issued", async () => {
    const storage = fakeStorage();
    const result = await handlePhotoUploadUrlRequest(requestInput(), deniedAccess(409, "Project does not belong to the specified company."));
    assert.equal(result.status, 409);
    assert.deepEqual(storage.calls, [], "createSignedUploadUrl must never be called when authorization denies the request");
  });
});

describe("handlePhotoUploadUrlRequest — companyId/projectId are validated like every other identity segment", () => {
  it("rejects a path-traversal companyId, before ever calling authorize", async () => {
    let authorizeCalled = false;
    const access: PhotoUploadAccess = { authorize: async () => { authorizeCalled = true; return { ok: true, storage: fakeStorage() }; } };
    const result = await handlePhotoUploadUrlRequest(requestInput({ companyId: "../../etc/passwd" }), access);
    assert.equal(result.status, 400);
    assert.equal(authorizeCalled, false);
  });

  it("rejects a path-separator in projectId", async () => {
    const result = await handlePhotoUploadUrlRequest(requestInput({ projectId: "a/b" }), okAccess(fakeStorage()));
    assert.equal(result.status, 400);
  });

  it("rejects an empty companyId or projectId", async () => {
    const result1 = await handlePhotoUploadUrlRequest(requestInput({ companyId: "" }), okAccess(fakeStorage()));
    assert.equal(result1.status, 400);
    const result2 = await handlePhotoUploadUrlRequest(requestInput({ projectId: "" }), okAccess(fakeStorage()));
    assert.equal(result2.status, 400);
  });
});

describe("handlePhotoUploadUrlRequest — input validation, checked before authorization", () => {
  it("rejects a mimeType outside the allowlist, before ever calling authorize", async () => {
    let authorizeCalled = false;
    const access: PhotoUploadAccess = { authorize: async () => { authorizeCalled = true; return { ok: true, storage: fakeStorage() }; } };
    const result = await handlePhotoUploadUrlRequest(requestInput({ mimeType: "application/pdf" }), access);
    assert.equal(result.status, 400);
    assert.equal(authorizeCalled, false);
  });

  it("rejects a path-traversal localPhotoId, before ever calling authorize — an arbitrary client storage path is structurally impossible", async () => {
    let authorizeCalled = false;
    const access: PhotoUploadAccess = { authorize: async () => { authorizeCalled = true; return { ok: true, storage: fakeStorage() }; } };
    const result = await handlePhotoUploadUrlRequest(requestInput({ localPhotoId: "../../etc/passwd" }), access);
    assert.equal(result.status, 400);
    assert.equal(authorizeCalled, false);
  });

  it("rejects a path-separator in fieldName/group", async () => {
    const result1 = await handlePhotoUploadUrlRequest(requestInput({ fieldName: "a/b" }), okAccess(fakeStorage()));
    assert.equal(result1.status, 400);
    const result2 = await handlePhotoUploadUrlRequest(requestInput({ group: "a/../b" }), okAccess(fakeStorage()));
    assert.equal(result2.status, 400);
  });

  it("rejects an empty localSubmissionId", async () => {
    const result = await handlePhotoUploadUrlRequest(requestInput({ localSubmissionId: "" }), okAccess(fakeStorage()));
    assert.equal(result.status, 400);
  });
});

describe("handlePhotoUploadUrlRequest — storage failure surfaces honestly", () => {
  it("a storage error is reported as a 500, not a false success", async () => {
    const storage: PhotoStorageRepo = { async createSignedUploadUrl() { return { error: "bucket unreachable" }; } };
    const result = await handlePhotoUploadUrlRequest(requestInput(), okAccess(storage));
    assert.equal(result.status, 500);
  });
});

describe("handlePhotoUploadUrlRequest — success response shape", () => {
  it("returns exactly { path, token } — never a raw signedUrl or the storage bucket's internal shape", async () => {
    const storage = fakeStorage();
    const result = await handlePhotoUploadUrlRequest(requestInput(), okAccess(storage));
    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body).sort(), ["path", "token"]);
  });
});
