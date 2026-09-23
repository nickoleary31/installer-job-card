import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleFinalizeRequest,
  isNonEmptyString,
  payloadHasUnresolvedLocalPhotos,
  type CanonicalSubmissionRow,
  type FinalizeAccess,
  type FinalizeAutoPublishTrigger,
  type FinalizeRequestInput,
  type JobCardSubmissionsRepo,
  type JobCardSubmissionsRepoWriteInput,
} from "./finalize.ts";
import type { JobCardSubmissionPayload } from "../job-card-submission.ts";
import { LOCAL_PHOTO_URI_SCHEME } from "../local-photo.ts";

function payload(overrides: Partial<JobCardSubmissionPayload> = {}): JobCardSubmissionPayload {
  return {
    submissionId: "sub-1",
    submissionTimestamp: "2026-01-01T00:00:00.000Z",
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
    technicianSubmittedAt: "2026-01-01T00:00:00.000Z",
    submissionSnapshotHash: "hash-abc",
    payload: payload(),
    ...overrides,
  };
}

/** In-memory fake standing in for the real Supabase-backed repo — models real ON CONFLICT DO NOTHING semantics (an existing row is never overwritten). */
function fakeRepo(seed?: CanonicalSubmissionRow & { payload?: JobCardSubmissionPayload }): JobCardSubmissionsRepo & { writes: JobCardSubmissionsRepoWriteInput[] } {
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

function okAccess(repo: JobCardSubmissionsRepo): FinalizeAccess {
  return { authorize: async () => ({ ok: true, repo }) };
}

function deniedAccess(status: number, error: string): FinalizeAccess {
  return { authorize: async () => ({ ok: false, status, error }) };
}

describe("payloadHasUnresolvedLocalPhotos / isNonEmptyString (pure)", () => {
  it("flags a photoUploads entry still carrying a local-photo:// sentinel", () => {
    const p = payload({
      photoUploads: [
        { fieldName: "f", group: "vehicle", label: "L", filename: "a.jpg", storagePath: `${LOCAL_PHOTO_URI_SCHEME}photo-1`, publicUrl: `${LOCAL_PHOTO_URI_SCHEME}photo-1`, uploadedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    assert.equal(payloadHasUnresolvedLocalPhotos(p), true);
  });

  it("passes when every photoUploads entry already has a real remote reference", () => {
    const p = payload({
      photoUploads: [
        { fieldName: "f", group: "vehicle", label: "L", filename: "a.jpg", storagePath: "sub-1/vehicle/f/photo-1.jpg", publicUrl: "https://x.supabase.co/storage/v1/object/public/job-card-photos/sub-1/vehicle/f/photo-1.jpg", uploadedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    assert.equal(payloadHasUnresolvedLocalPhotos(p), false);
  });

  it("isNonEmptyString rejects blank/whitespace-only/non-string values", () => {
    assert.equal(isNonEmptyString("sub-1"), true);
    assert.equal(isNonEmptyString(""), false);
    assert.equal(isNonEmptyString("   "), false);
    assert.equal(isNonEmptyString(undefined), false);
    assert.equal(isNonEmptyString(123), false);
  });
});

describe("handleFinalizeRequest — validation", () => {
  it("rejects a missing payload/submissionId before ever calling authorize", async () => {
    let authorizeCalled = false;
    const access: FinalizeAccess = { authorize: async () => { authorizeCalled = true; return { ok: true, repo: fakeRepo() }; } };
    const result = await handleFinalizeRequest(requestInput({ payload: null }), access, null);
    assert.equal(result.status, 400);
    assert.equal(authorizeCalled, false, "must validate before touching auth/DB");
  });

  it("rejects a missing technicianSubmittedAt/submissionSnapshotHash", async () => {
    const result = await handleFinalizeRequest(requestInput({ submissionSnapshotHash: "" }), okAccess(fakeRepo()), null);
    assert.equal(result.status, 400);
  });

  it("rejects a payload with unresolved local-photo:// photos before ever writing", async () => {
    const repo = fakeRepo();
    const p = payload({
      photoUploads: [{ fieldName: "f", group: "vehicle", label: "L", filename: "a.jpg", storagePath: `${LOCAL_PHOTO_URI_SCHEME}photo-1`, publicUrl: `${LOCAL_PHOTO_URI_SCHEME}photo-1`, uploadedAt: "2026-01-01T00:00:00.000Z" }],
    });
    const result = await handleFinalizeRequest(requestInput({ payload: p }), okAccess(repo), null);
    assert.equal(result.status, 400);
    assert.equal(repo.writes.length, 0);
  });
});

describe("handleFinalizeRequest — authorization", () => {
  it("propagates a 401 from a missing/invalid access token", async () => {
    const result = await handleFinalizeRequest(requestInput(), deniedAccess(401, "Unauthorized requester."), null);
    assert.equal(result.status, 401);
    assert.equal(result.body.error, "Unauthorized requester.");
  });

  it("propagates a 403 for a requester with no project access", async () => {
    const result = await handleFinalizeRequest(requestInput(), deniedAccess(403, "Only global admins..."), null);
    assert.equal(result.status, 403);
  });

  it("Phase 2H security reconciliation — propagates a 409 when the project does not belong to the specified company (deniedAccess's {ok:false} result structurally carries no repo at all, so no write is even reachable)", async () => {
    const result = await handleFinalizeRequest(
      requestInput(),
      deniedAccess(409, "Project does not belong to the specified company."),
      null,
    );
    assert.equal(result.status, 409);
  });

  it("Phase 2H security reconciliation — propagates a 500 when no privileged server key is configured", async () => {
    const result = await handleFinalizeRequest(
      requestInput(),
      deniedAccess(500, "This operation is unavailable because SUPABASE_SECRET_KEY is not configured on the server."),
      null,
    );
    assert.equal(result.status, 500);
  });
});

describe("handleFinalizeRequest — first insert", () => {
  it("a genuinely new submission is written and echoed back", async () => {
    const repo = fakeRepo();
    const result = await handleFinalizeRequest(requestInput(), okAccess(repo), null);
    assert.equal(result.status, 200);
    assert.equal(repo.writes.length, 1);
    assert.deepEqual(result.body, {
      submissionId: "sub-1",
      technicianSubmittedAt: "2026-01-01T00:00:00.000Z",
      submissionSnapshotHash: "hash-abc",
      serverConfirmedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("handleFinalizeRequest — concurrent/identical retry convergence", () => {
  it("a retry with the SAME hash against an already-canonical row converges: 200, same confirmation, no overwrite attempted to matter", async () => {
    const repo = fakeRepo({ submissionId: "sub-1", technicianSubmittedAt: "2026-01-01T00:00:00.000Z", submissionSnapshotHash: "hash-abc", createdAt: "2026-01-01T00:00:00.000Z" });
    const result = await handleFinalizeRequest(requestInput(), okAccess(repo), null);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      submissionId: "sub-1",
      technicianSubmittedAt: "2026-01-01T00:00:00.000Z",
      submissionSnapshotHash: "hash-abc",
      serverConfirmedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("simultaneous identical retries (two calls against a repo that starts empty) both converge on the same canonical row", async () => {
    const repo = fakeRepo();
    const first = await handleFinalizeRequest(requestInput(), okAccess(repo), null);
    const second = await handleFinalizeRequest(requestInput(), okAccess(repo), null);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(first.body, second.body);
    assert.equal(repo.writes.length, 2, "both attempts call upsertIgnoringDuplicates — real ON CONFLICT DO NOTHING makes the second a no-op");
  });
});

describe("handleFinalizeRequest — hash mismatch is a real conflict, never a silent overwrite", () => {
  it("a stored row with a DIFFERENT hash under the same submissionId returns 409, and the repo's write is never allowed to change it", async () => {
    const repo = fakeRepo({ submissionId: "sub-1", technicianSubmittedAt: "2026-01-01T00:00:00.000Z", submissionSnapshotHash: "different-hash", createdAt: "2026-01-01T00:00:00.000Z" });
    const result = await handleFinalizeRequest(requestInput({ submissionSnapshotHash: "hash-abc" }), okAccess(repo), null);
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /snapshot hash mismatch/i);
  });

  it("a legacy row with a NULL stored hash (e.g. from the web submit path) is treated as a conservative conflict, never a false match", async () => {
    const repo = fakeRepo({ submissionId: "sub-1", technicianSubmittedAt: null, submissionSnapshotHash: null, createdAt: "2026-01-01T00:00:00.000Z" });
    const result = await handleFinalizeRequest(requestInput({ submissionSnapshotHash: "hash-abc" }), okAccess(repo), null);
    assert.equal(result.status, 409);
  });
});

describe("handleFinalizeRequest — auto-publish is best-effort and never affects the response", () => {
  it("a throwing auto-publish trigger is swallowed — the finalize response still reports success", async () => {
    const repo = fakeRepo();
    const trigger: FinalizeAutoPublishTrigger = { trigger: async () => { throw new Error("orchestrator unreachable"); } };
    const result = await handleFinalizeRequest(requestInput(), okAccess(repo), trigger);
    assert.equal(result.status, 200);
  });

  it("auto-publish fires once per successful/converged call, including on a retry", async () => {
    const repo = fakeRepo();
    const calls: string[] = [];
    const trigger: FinalizeAutoPublishTrigger = { trigger: async (args) => { calls.push(args.companyId); } };
    await handleFinalizeRequest(requestInput(), okAccess(repo), trigger);
    await handleFinalizeRequest(requestInput(), okAccess(repo), trigger);
    assert.equal(calls.length, 2, "duplicate notifications across retries are expected and safe — see handleAutoPublishRequest's own doc");
  });

  it("auto-publish never fires when the request never reaches a converged success (e.g. a 409 conflict)", async () => {
    const repo = fakeRepo({ submissionId: "sub-1", technicianSubmittedAt: "2026-01-01T00:00:00.000Z", submissionSnapshotHash: "different-hash", createdAt: "2026-01-01T00:00:00.000Z" });
    const calls: string[] = [];
    const trigger: FinalizeAutoPublishTrigger = { trigger: async (args) => { calls.push(args.companyId); } };
    const result = await handleFinalizeRequest(requestInput({ submissionSnapshotHash: "hash-abc" }), okAccess(repo), trigger);
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
    const result = await handleFinalizeRequest(requestInput(), okAccess(repo), null);
    assert.equal(result.status, 500);
  });

  it("a write that succeeds but cannot be read back is reported as a 500, never a false success", async () => {
    const repo: JobCardSubmissionsRepo = {
      async upsertIgnoringDuplicates() { return { error: null }; },
      async getBySubmissionId() { return { row: null, error: null }; },
    };
    const result = await handleFinalizeRequest(requestInput(), okAccess(repo), null);
    assert.equal(result.status, 500);
  });
});
