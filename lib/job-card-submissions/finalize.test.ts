import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TECHNICIAN_SUBMITTED_AT_MAX_FUTURE_MS,
  TECHNICIAN_SUBMITTED_AT_MAX_PAST_MS,
  handleFinalizeRequest,
  isNonEmptyString,
  isValidSnapshotHash,
  payloadHasUnresolvedLocalPhotos,
  validateTechnicianSubmittedAt,
  type CanonicalSubmissionRow,
  type FinalizeAccess,
  type FinalizeAutoPublishTrigger,
  type FinalizeRequestInput,
  type JobCardSubmissionsRepo,
  type JobCardSubmissionsRepoWriteInput,
} from "./finalize.ts";
import type { JobCardSubmissionPayload } from "../job-card-submission.ts";
import { LOCAL_PHOTO_URI_SCHEME } from "../local-photo.ts";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const SUBMITTED_AT = "2026-06-01T10:00:00.000Z";
/** Pinned clock: one day after SUBMITTED_AT, so the timestamp window never drifts with real time. */
const NOW_MS = Date.parse("2026-06-02T10:00:00.000Z");
const SUPABASE_URL = "https://example.supabase.co";
const REQUESTER = "user-tech-1";

function photoPath(overrides: { companyId?: string; projectId?: string; uploader?: string; submissionId?: string; ext?: string } = {}) {
  const { companyId = "company-1", projectId = "project-1", uploader = REQUESTER, submissionId = "sub-1", ext = "jpg" } = overrides;
  return `${companyId}/${projectId}/${uploader}/${submissionId}/vehicle/vehicleFrontPhoto/photo-1.${ext}`;
}

function photoUpload(storagePath: string, publicUrl = `https://evil.example/${storagePath}`): JobCardSubmissionPayload["photoUploads"][number] {
  return { fieldName: "vehicleFrontPhoto", group: "vehicle", label: "Front", filename: "a.jpg", storagePath, publicUrl, uploadedAt: SUBMITTED_AT };
}

function payload(overrides: Partial<JobCardSubmissionPayload> = {}): JobCardSubmissionPayload {
  return {
    submissionId: "sub-1",
    submissionTimestamp: SUBMITTED_AT,
    status: "Submitted",
    coreJobInfo: { customer: "Jane Doe", unitNumber: "UNIT-1" } as JobCardSubmissionPayload["coreJobInfo"],
    hardwareSelection: { primary: "VAC4", hasAdditional: "no", additional: [] },
    selectedSections: ["VAC4"],
    photoUploads: [],
    vac4: {
      vehicleType: "",
      otherVehicleType: "",
      driveType: "",
      vehicleVoltage: "",
      vehicleVoltageOther: "",
      clientApproval: "",
      hourMeter: "",
      sensorHubInstalled: "",
      liftSenseInstalled: "",
      speedSenseInstalled: "",
      loadSenseInstalled: "",
      gpsInstalled: "",
      externalIndicatorInstalled: "",
      speedSenseDescription: "",
      speedSensePulseCount: "",
      loadSenseThresholds: "",
      redWireDescription: "",
      blackWireDescription: "",
      blueWireDescription: "",
      brownWireDescription: "",
      photoCounts: {},
      photoFileNames: {},
      photoUrls: {},
    },
    ...overrides,
  } as JobCardSubmissionPayload;
}

function requestInput(overrides: Partial<FinalizeRequestInput> = {}): FinalizeRequestInput {
  return {
    accessToken: "token-abc",
    companyId: "company-1",
    projectId: "project-1",
    technicianSubmittedAt: SUBMITTED_AT,
    submissionSnapshotHash: HASH,
    payload: payload(),
    ...overrides,
  };
}

/** In-memory fake standing in for the real Supabase-backed repo — models real ON CONFLICT DO NOTHING semantics (an existing row is never overwritten). */
function fakeRepo(seed?: CanonicalSubmissionRow): JobCardSubmissionsRepo & { writes: JobCardSubmissionsRepoWriteInput[] } {
  let stored: CanonicalSubmissionRow | null = seed ?? null;
  const writes: JobCardSubmissionsRepoWriteInput[] = [];
  return {
    writes,
    async upsertIgnoringDuplicates(row) {
      writes.push(row);
      if (!stored) {
        stored = {
          submissionId: row.submissionId,
          technicianSubmittedAt: row.technicianSubmittedAt,
          submissionSnapshotHash: row.submissionSnapshotHash,
          createdAt: row.technicianSubmittedAt,
        };
      }
      // ON CONFLICT DO NOTHING — an existing row is never touched.
      return { error: null };
    },
    async getBySubmissionId(submissionId) {
      if (!stored || stored.submissionId !== submissionId) return { row: null, error: null };
      return { row: stored, error: null };
    },
  };
}

function okAccess(repo: JobCardSubmissionsRepo, requesterUserId = REQUESTER): FinalizeAccess {
  return { authorize: async () => ({ ok: true, repo, requesterUserId, supabaseUrl: SUPABASE_URL }) };
}

function deniedAccess(status: number, error: string): FinalizeAccess {
  return { authorize: async () => ({ ok: false, status, error }) };
}

function finalize(input: FinalizeRequestInput, access: FinalizeAccess, autoPublish: FinalizeAutoPublishTrigger | null = null) {
  return handleFinalizeRequest(input, access, autoPublish, { now: () => NOW_MS });
}

const canonicalRow = (submissionSnapshotHash: string | null = HASH): CanonicalSubmissionRow => ({
  submissionId: "sub-1",
  technicianSubmittedAt: SUBMITTED_AT,
  submissionSnapshotHash,
  createdAt: SUBMITTED_AT,
});

describe("payloadHasUnresolvedLocalPhotos / isNonEmptyString / isValidSnapshotHash (pure)", () => {
  it("flags a photoUploads entry still carrying a local-photo:// sentinel", () => {
    const p = payload({ photoUploads: [photoUpload(`${LOCAL_PHOTO_URI_SCHEME}photo-1`, `${LOCAL_PHOTO_URI_SCHEME}photo-1`)] });
    assert.equal(payloadHasUnresolvedLocalPhotos(p), true);
  });

  it("passes when every photoUploads entry already has a real remote reference", () => {
    const p = payload({ photoUploads: [photoUpload(photoPath())] });
    assert.equal(payloadHasUnresolvedLocalPhotos(p), false);
  });

  it("isNonEmptyString rejects blank/whitespace-only/non-string values", () => {
    assert.equal(isNonEmptyString("sub-1"), true);
    assert.equal(isNonEmptyString(""), false);
    assert.equal(isNonEmptyString("   "), false);
    assert.equal(isNonEmptyString(undefined), false);
    assert.equal(isNonEmptyString(123), false);
  });

  it("isValidSnapshotHash accepts only a lowercase 64-hex sha256 digest", () => {
    assert.equal(isValidSnapshotHash(HASH), true);
    assert.equal(isValidSnapshotHash("hash-abc"), false);
    assert.equal(isValidSnapshotHash("A".repeat(64)), false);
    assert.equal(isValidSnapshotHash("a".repeat(63)), false);
  });
});

describe("validateTechnicianSubmittedAt (pure) — Checkpoint 2 timestamp sanity", () => {
  it("accepts a plausible recent ISO timestamp", () => {
    assert.deepEqual(validateTechnicianSubmittedAt(SUBMITTED_AT, NOW_MS), { ok: true });
  });

  it("accepts a submission held on a device for weeks before syncing", () => {
    const threeWeeksAgo = new Date(NOW_MS - 21 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(validateTechnicianSubmittedAt(threeWeeksAgo, NOW_MS).ok, true);
  });

  it("rejects unparseable, non-ISO, far-past and future values", () => {
    assert.equal(validateTechnicianSubmittedAt("not a date", NOW_MS).ok, false);
    assert.equal(validateTechnicianSubmittedAt("1718000000000", NOW_MS).ok, false);
    assert.equal(validateTechnicianSubmittedAt("1970-01-01T00:00:00.000Z", NOW_MS).ok, false);
    assert.equal(validateTechnicianSubmittedAt("2099-01-01T00:00:00.000Z", NOW_MS).ok, false);
    assert.equal(validateTechnicianSubmittedAt(new Date(NOW_MS - TECHNICIAN_SUBMITTED_AT_MAX_PAST_MS - 1000).toISOString(), NOW_MS).ok, false);
    assert.equal(validateTechnicianSubmittedAt(new Date(NOW_MS + TECHNICIAN_SUBMITTED_AT_MAX_FUTURE_MS + 1000).toISOString(), NOW_MS).ok, false);
  });

  it("tolerates a few minutes of clock skew into the future", () => {
    assert.equal(validateTechnicianSubmittedAt(new Date(NOW_MS + 5 * 60 * 1000).toISOString(), NOW_MS).ok, true);
  });
});

describe("handleFinalizeRequest — validation", () => {
  it("rejects a missing payload/submissionId before ever calling authorize", async () => {
    let authorizeCalled = false;
    const access: FinalizeAccess = {
      authorize: async () => {
        authorizeCalled = true;
        return { ok: true, repo: fakeRepo(), requesterUserId: REQUESTER, supabaseUrl: SUPABASE_URL };
      },
    };
    const result = await finalize(requestInput({ payload: null }), access);
    assert.equal(result.status, 400);
    assert.equal(authorizeCalled, false, "must validate before touching auth/DB");
  });

  it("rejects a missing technicianSubmittedAt/submissionSnapshotHash", async () => {
    const result = await finalize(requestInput({ submissionSnapshotHash: "" }), okAccess(fakeRepo()));
    assert.equal(result.status, 400);
  });

  it("rejects a payload with unresolved local-photo:// photos before ever writing", async () => {
    const repo = fakeRepo();
    const p = payload({ photoUploads: [photoUpload(`${LOCAL_PHOTO_URI_SCHEME}photo-1`, `${LOCAL_PHOTO_URI_SCHEME}photo-1`)] });
    const result = await finalize(requestInput({ payload: p }), okAccess(repo));
    assert.equal(result.status, 400);
    assert.equal(repo.writes.length, 0);
  });

  it("Checkpoint 2 — rejects a submissionId that is not a simple identifier (it becomes a storage path segment and a row key)", async () => {
    const repo = fakeRepo();
    const result = await finalize(requestInput({ payload: payload({ submissionId: "../other" }) }), okAccess(repo));
    assert.equal(result.status, 400);
    assert.equal(repo.writes.length, 0);
  });

  it("Checkpoint 2 — rejects a malformed snapshot hash before authorization", async () => {
    let authorizeCalled = false;
    const access: FinalizeAccess = {
      authorize: async () => {
        authorizeCalled = true;
        return { ok: true, repo: fakeRepo(), requesterUserId: REQUESTER, supabaseUrl: SUPABASE_URL };
      },
    };
    const result = await finalize(requestInput({ submissionSnapshotHash: "hash-abc" }), access);
    assert.equal(result.status, 400);
    assert.equal(authorizeCalled, false);
  });

  it("Checkpoint 2 — an abusive technicianSubmittedAt (year 2099, or year 1970) is rejected and never written", async () => {
    const repo = fakeRepo();
    assert.equal((await finalize(requestInput({ technicianSubmittedAt: "2099-01-01T00:00:00.000Z" }), okAccess(repo))).status, 400);
    assert.equal((await finalize(requestInput({ technicianSubmittedAt: "1970-01-01T00:00:00.000Z" }), okAccess(repo))).status, 400);
    assert.equal(repo.writes.length, 0);
  });
});

describe("handleFinalizeRequest — authorization (identity only ever comes from access.authorize, never the body)", () => {
  it("A: an unauthenticated request is rejected with 401 and nothing is written", async () => {
    const repo = fakeRepo();
    const access: FinalizeAccess = { authorize: async ({ accessToken }) => (accessToken ? { ok: true, repo, requesterUserId: REQUESTER, supabaseUrl: SUPABASE_URL } : { ok: false, status: 401, error: "Missing authorization token." }) };
    const result = await finalize(requestInput({ accessToken: "" }), access);
    assert.equal(result.status, 401);
    assert.equal(repo.writes.length, 0);
  });

  it("propagates a 401 from an invalid access token", async () => {
    const result = await finalize(requestInput(), deniedAccess(401, "Unauthorized requester."));
    assert.equal(result.status, 401);
    assert.equal(result.body.error, "Unauthorized requester.");
  });

  it("C: propagates a 403 for a technician with no active assignment on this project — nothing is written", async () => {
    const repo = fakeRepo();
    const result = await finalize(requestInput(), deniedAccess(403, "Only global admins..."));
    assert.equal(result.status, 403);
    assert.equal(repo.writes.length, 0);
  });

  it("B: propagates a 409 when the project does not belong to the specified company (deniedAccess's {ok:false} result structurally carries no repo at all, so no write is even reachable)", async () => {
    const result = await finalize(requestInput(), deniedAccess(409, "Project does not belong to the specified company."));
    assert.equal(result.status, 409);
  });

  it("D/E: an inactive user profile or inactive project is a 403 from the shared access check — see lib/project-access.test.ts for the decision itself", async () => {
    assert.equal((await finalize(requestInput(), deniedAccess(403, "This user account is not active."))).status, 403);
    assert.equal((await finalize(requestInput(), deniedAccess(403, "This project is not active."))).status, 403);
  });

  it("propagates a 500 when no privileged server key is configured", async () => {
    const result = await finalize(
      requestInput(),
      deniedAccess(500, "This operation is unavailable because SUPABASE_SECRET_KEY is not configured on the server."),
    );
    assert.equal(result.status, 500);
  });

  it("the body carries no user identity at all — the stored write's scope is the authorized company/project, whatever the body claims elsewhere", async () => {
    const repo = fakeRepo();
    const result = await finalize(requestInput({ payload: payload({ coreJobInfo: { customer: "X", installerName: "Someone Else" } as JobCardSubmissionPayload["coreJobInfo"] }) }), okAccess(repo));
    assert.equal(result.status, 200);
    assert.equal(repo.writes[0].companyId, "company-1");
    assert.equal(repo.writes[0].projectId, "project-1");
  });
});

describe("handleFinalizeRequest — F: payload scope must match the authorized scope", () => {
  it("a payload naming a different company than the one authorized is a 409 and never written", async () => {
    const repo = fakeRepo();
    const result = await finalize(requestInput({ payload: payload({ companyId: "company-B", projectId: "project-1" }) }), okAccess(repo));
    assert.equal(result.status, 409);
    assert.equal(repo.writes.length, 0);
  });

  it("a payload naming a different project than the one authorized is a 409 and never written", async () => {
    const repo = fakeRepo();
    const result = await finalize(requestInput({ payload: payload({ companyId: "company-1", projectId: "project-other" }) }), okAccess(repo));
    assert.equal(result.status, 409);
    assert.equal(repo.writes.length, 0);
  });

  it("a payload with matching ids, or with no ids at all, is accepted", async () => {
    assert.equal((await finalize(requestInput({ payload: payload({ companyId: "company-1", projectId: "project-1" }) }), okAccess(fakeRepo()))).status, 200);
    assert.equal((await finalize(requestInput(), okAccess(fakeRepo()))).status, 200);
  });
});

describe("handleFinalizeRequest — K: storage references must lie inside the authorized scope", () => {
  it("a photo under another company's path is rejected (400) and never written", async () => {
    const repo = fakeRepo();
    const result = await finalize(requestInput({ payload: payload({ photoUploads: [photoUpload(photoPath({ companyId: "company-B" }))] }) }), okAccess(repo));
    assert.equal(result.status, 400);
    assert.equal(repo.writes.length, 0);
  });

  it("a photo under another project of the same company is rejected", async () => {
    const result = await finalize(requestInput({ payload: payload({ photoUploads: [photoUpload(photoPath({ projectId: "project-2" }))] }) }), okAccess(fakeRepo()));
    assert.equal(result.status, 400);
  });

  it("a photo under another submission's path is rejected", async () => {
    const result = await finalize(requestInput({ payload: payload({ photoUploads: [photoUpload(photoPath({ submissionId: "sub-2" }))] }) }), okAccess(fakeRepo()));
    assert.equal(result.status, 400);
  });

  it("a photo uploaded under a DIFFERENT technician's namespace in the same project is rejected", async () => {
    const result = await finalize(requestInput({ payload: payload({ photoUploads: [photoUpload(photoPath({ uploader: "user-tech-2" }))] }) }), okAccess(fakeRepo()));
    assert.equal(result.status, 400);
  });

  it("the legacy web photo family (submission/group/field/file) is not accepted by finalize — only the native sync engine calls it", async () => {
    const result = await finalize(requestInput({ payload: payload({ photoUploads: [photoUpload("sub-1/vehicle/vehicleFrontPhoto/123-a.jpg")] }) }), okAccess(fakeRepo()));
    assert.equal(result.status, 400);
  });

  it("an arbitrary storage path or traversal is rejected", async () => {
    for (const bad of ["../../secrets/keys.json", "company-1/project-1/user-tech-1/sub-1/../../x.jpg", "company-1/project-1/user-tech-1/sub-1/vehicle/f/p.html"]) {
      const result = await finalize(requestInput({ payload: payload({ photoUploads: [photoUpload(bad)] }) }), okAccess(fakeRepo()));
      assert.equal(result.status, 400, bad);
    }
  });

  it("a product file in any bucket other than customer-site-files, or outside this project's path, is rejected", async () => {
    const base = { fileKey: "ssc_config", productKey: "SSC", originalFileName: "c.json", mimeType: "application/json", sizeBytes: 1, uploadedAt: SUBMITTED_AT, displayLabel: "Config" };
    const wrongBucket = payload({ productFiles: [{ ...base, storageBucket: "job-card-photos", storagePath: "customer-sites/c1/product-files/ssc/ssc_config/project-1/u-1-c.json" }] });
    const wrongProject = payload({ productFiles: [{ ...base, storageBucket: "customer-site-files", storagePath: "customer-sites/c1/product-files/ssc/ssc_config/project-9/u-1-c.json" }] });
    const arbitrary = payload({ productFiles: [{ ...base, storageBucket: "customer-site-files", storagePath: "customer-sites/c1/site-docs/wifi-passwords.pdf" }] });
    for (const p of [wrongBucket, wrongProject, arbitrary]) {
      assert.equal((await finalize(requestInput({ payload: p }), okAccess(fakeRepo()))).status, 400);
    }
  });

  it("a valid native photo and a valid product file are accepted, and the stored photo publicUrl is re-derived from the path — never the client's", async () => {
    const repo = fakeRepo();
    const base = { fileKey: "ssc_config", productKey: "SSC", originalFileName: "c.json", mimeType: "application/json", sizeBytes: 1, uploadedAt: SUBMITTED_AT, displayLabel: "Config" };
    const p = payload({
      photoUploads: [photoUpload(photoPath(), "https://phish.example/not-the-photo.jpg")],
      productFiles: [{ ...base, storageBucket: "customer-site-files", storagePath: "customer-sites/c1/product-files/ssc/ssc_config/project-1/u-1-c.json", downloadUrl: "https://phish.example/x" }],
    });
    const result = await finalize(requestInput({ payload: p }), okAccess(repo));
    assert.equal(result.status, 200);
    const stored = repo.writes[0].payload;
    assert.equal(stored.photoUploads[0].publicUrl, `${SUPABASE_URL}/storage/v1/object/public/job-card-photos/${photoPath()}`);
    assert.equal(stored.productFiles?.[0].downloadUrl, undefined, "a downloadUrl that is not a signed URL for this path is dropped");
  });
});

describe("handleFinalizeRequest — G/H: legitimate access still finalizes", () => {
  it("G: an assigned technician's genuinely new submission is written and echoed back", async () => {
    const repo = fakeRepo();
    const result = await finalize(requestInput(), okAccess(repo, "user-tech-1"));
    assert.equal(result.status, 200);
    assert.equal(repo.writes.length, 1);
    assert.deepEqual(result.body, {
      submissionId: "sub-1",
      technicianSubmittedAt: SUBMITTED_AT,
      submissionSnapshotHash: HASH,
      serverConfirmedAt: SUBMITTED_AT,
    });
  });

  it("H: a company admin finalizing their own native submission (photos under their own namespace) succeeds", async () => {
    const repo = fakeRepo();
    const result = await finalize(
      requestInput({ payload: payload({ photoUploads: [photoUpload(photoPath({ uploader: "user-admin-1" }))] }) }),
      okAccess(repo, "user-admin-1"),
    );
    assert.equal(result.status, 200);
  });
});

describe("handleFinalizeRequest — I: concurrent/identical retry convergence", () => {
  it("a retry with the SAME hash against an already-canonical row converges: 200, same confirmation, no overwrite attempted to matter", async () => {
    const repo = fakeRepo(canonicalRow());
    const result = await finalize(requestInput(), okAccess(repo));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      submissionId: "sub-1",
      technicianSubmittedAt: SUBMITTED_AT,
      submissionSnapshotHash: HASH,
      serverConfirmedAt: SUBMITTED_AT,
    });
  });

  it("simultaneous identical retries (two calls against a repo that starts empty) both converge on the same canonical row", async () => {
    const repo = fakeRepo();
    const first = await finalize(requestInput(), okAccess(repo));
    const second = await finalize(requestInput(), okAccess(repo));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(first.body, second.body);
    assert.equal(repo.writes.length, 2, "both attempts call upsertIgnoringDuplicates — real ON CONFLICT DO NOTHING makes the second a no-op");
  });

  it("a crafted retry (same id and hash, but references now outside scope) is rejected before the write and cannot disturb the canonical row", async () => {
    const repo = fakeRepo(canonicalRow());
    const result = await finalize(requestInput({ payload: payload({ photoUploads: [photoUpload(photoPath({ companyId: "company-B" }))] }) }), okAccess(repo));
    assert.equal(result.status, 400);
    assert.equal(repo.writes.length, 0);
  });
});

describe("handleFinalizeRequest — J: hash mismatch is a real conflict, never a silent overwrite", () => {
  it("a stored row with a DIFFERENT hash under the same submissionId returns 409, and the repo's write is never allowed to change it", async () => {
    const repo = fakeRepo(canonicalRow(OTHER_HASH));
    const result = await finalize(requestInput({ submissionSnapshotHash: HASH }), okAccess(repo));
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /snapshot hash mismatch/i);
  });

  it("a legacy row with a NULL stored hash (e.g. from the web submit path) is treated as a conservative conflict, never a false match", async () => {
    const repo = fakeRepo({ ...canonicalRow(null), technicianSubmittedAt: null });
    const result = await finalize(requestInput({ submissionSnapshotHash: HASH }), okAccess(repo));
    assert.equal(result.status, 409);
  });
});

describe("handleFinalizeRequest — auto-publish is best-effort and never affects the response", () => {
  it("a throwing auto-publish trigger is swallowed — the finalize response still reports success", async () => {
    const trigger: FinalizeAutoPublishTrigger = { trigger: async () => { throw new Error("orchestrator unreachable"); } };
    const result = await finalize(requestInput(), okAccess(fakeRepo()), trigger);
    assert.equal(result.status, 200);
  });

  it("auto-publish fires once per successful/converged call, including on a retry", async () => {
    const repo = fakeRepo();
    const calls: string[] = [];
    const trigger: FinalizeAutoPublishTrigger = { trigger: async (args) => { calls.push(args.companyId); } };
    await finalize(requestInput(), okAccess(repo), trigger);
    await finalize(requestInput(), okAccess(repo), trigger);
    assert.equal(calls.length, 2, "duplicate notifications across retries are expected and safe — see handleAutoPublishRequest's own doc");
  });

  it("auto-publish never fires when the request never reaches a converged success (e.g. a 409 conflict)", async () => {
    const repo = fakeRepo(canonicalRow(OTHER_HASH));
    const calls: string[] = [];
    const trigger: FinalizeAutoPublishTrigger = { trigger: async (args) => { calls.push(args.companyId); } };
    const result = await finalize(requestInput({ submissionSnapshotHash: HASH }), okAccess(repo), trigger);
    assert.equal(result.status, 409);
    assert.deepEqual(calls, []);
  });
});

describe("handleFinalizeRequest — repo failures surface honestly", () => {
  it("an upsert error is reported as a 500, not silently swallowed", async () => {
    const repo: JobCardSubmissionsRepo = {
      async upsertIgnoringDuplicates() { return { error: "connection reset" }; },
      async getBySubmissionId() { return { row: null, error: null }; },
    };
    const result = await finalize(requestInput(), okAccess(repo));
    assert.equal(result.status, 500);
  });

  it("a write that succeeds but cannot be read back is reported as a 500, never a false success", async () => {
    const repo: JobCardSubmissionsRepo = {
      async upsertIgnoringDuplicates() { return { error: null }; },
      async getBySubmissionId() { return { row: null, error: null }; },
    };
    const result = await finalize(requestInput(), okAccess(repo));
    assert.equal(result.status, 500);
  });
});
