import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deleteLocalSubmissionDurably,
  resolveLocalSubmissionResumeOutcome,
  type DeleteLocalSubmissionDurablyDeps,
  type LocalSubmission,
} from "./local-submission.ts";
import type { LocalPhoto } from "./local-photo.ts";

type SamplePayload = { coreJob: { customer: string } };

function submission(overrides: Partial<LocalSubmission<SamplePayload>> = {}): LocalSubmission<SamplePayload> {
  return {
    localSubmissionId: "local-sub-1",
    userId: "user-1",
    projectId: "project-1",
    companyId: "company-1",
    status: "working",
    formId: "vac4",
    submissionType: "VAC4",
    definitionSchemaVersion: 2,
    selectedSections: ["VAC4"],
    payload: { coreJob: { customer: "Jane Doe" } },
    serverSubmissionId: null,
    technicianSubmittedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveLocalSubmissionResumeOutcome (pure)", () => {
  it("returns 'none' for a legitimately empty working set — Start New Submission should create one", () => {
    assert.deepEqual(resolveLocalSubmissionResumeOutcome([]), { kind: "none" });
  });

  it("returns 'single' with the one working submission when exactly one exists", () => {
    const sub = submission();
    const outcome = resolveLocalSubmissionResumeOutcome([sub]);
    assert.equal(outcome.kind, "single");
    if (outcome.kind === "single") assert.equal(outcome.submission.localSubmissionId, "local-sub-1");
  });

  it("returns 'multiple' with every working submission when more than one exists, preserving repository order", () => {
    const first = submission({ localSubmissionId: "local-sub-1", updatedAt: "2026-01-02T00:00:00.000Z" });
    const second = submission({ localSubmissionId: "local-sub-2", updatedAt: "2026-01-01T00:00:00.000Z" });
    const outcome = resolveLocalSubmissionResumeOutcome([first, second]);
    assert.equal(outcome.kind, "multiple");
    if (outcome.kind === "multiple") {
      assert.deepEqual(
        outcome.submissions.map((s) => s.localSubmissionId),
        ["local-sub-1", "local-sub-2"],
      );
    }
  });
});

function photo(overrides: Partial<LocalPhoto> = {}): LocalPhoto {
  return {
    localPhotoId: "photo-1",
    userId: "user-1",
    projectId: "project-1",
    localSubmissionId: "local-sub-1",
    fieldName: "vehicleFront",
    group: "vehicle",
    originalFilename: "front.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    filesystemPath: "submissions/local-sub-1/photos/photo-1.jpg",
    remoteStoragePath: null,
    remoteUploadedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Fakes standing in for the submission repo, photo metadata repo, and the durable photo deleter — no device/SQLite required. */
function fakeDeleteDeps(photosBySubmission: Record<string, LocalPhoto[]> = {}) {
  const deletedSubmissionIds: string[] = [];
  const deletedPhotoIds: string[] = [];
  const callOrder: string[] = [];
  const deps: DeleteLocalSubmissionDurablyDeps = {
    submissionRepo: {
      async deleteLocalSubmission(localSubmissionId: string) {
        deletedSubmissionIds.push(localSubmissionId);
        callOrder.push(`submission:${localSubmissionId}`);
      },
    },
    photoMetadataRepo: {
      async listLocalPhotosForSubmission(localSubmissionId: string) {
        return photosBySubmission[localSubmissionId] ?? [];
      },
    },
    async deletePhotoDurably(localPhotoId: string) {
      deletedPhotoIds.push(localPhotoId);
      callOrder.push(`photo:${localPhotoId}`);
    },
  };
  return { deps, deletedSubmissionIds, deletedPhotoIds, callOrder };
}

describe("deleteLocalSubmissionDurably (injected deps)", () => {
  it("removes a brand-new, photo-less LocalSubmission entirely", async () => {
    const { deps, deletedSubmissionIds, deletedPhotoIds } = fakeDeleteDeps({});
    await deleteLocalSubmissionDurably("local-sub-1", deps);
    assert.deepEqual(deletedSubmissionIds, ["local-sub-1"]);
    assert.deepEqual(deletedPhotoIds, []);
  });

  it("removes every LocalPhoto (metadata + durable bytes) associated with the submission", async () => {
    const photos = [photo({ localPhotoId: "photo-front" }), photo({ localPhotoId: "photo-side", fieldName: "vehicleSide" }), photo({ localPhotoId: "photo-rear", fieldName: "vehicleRear" })];
    const { deps, deletedSubmissionIds, deletedPhotoIds } = fakeDeleteDeps({ "local-sub-1": photos });
    await deleteLocalSubmissionDurably("local-sub-1", deps);
    assert.deepEqual(deletedPhotoIds.sort(), ["photo-front", "photo-rear", "photo-side"]);
    assert.deepEqual(deletedSubmissionIds, ["local-sub-1"]);
  });

  it("deletes every associated photo BEFORE the submission row, so a mid-failure never orphans a photo pointing at a vanished submission", async () => {
    const photos = [photo({ localPhotoId: "photo-front" }), photo({ localPhotoId: "photo-side" })];
    const { deps, callOrder } = fakeDeleteDeps({ "local-sub-1": photos });
    await deleteLocalSubmissionDurably("local-sub-1", deps);
    const submissionIndex = callOrder.indexOf("submission:local-sub-1");
    const photoIndexes = callOrder.filter((c) => c.startsWith("photo:")).map((c) => callOrder.indexOf(c));
    assert.ok(photoIndexes.every((i) => i < submissionIndex), `expected all photo deletes before the submission delete, got order: ${callOrder.join(", ")}`);
  });

  it("only touches photos belonging to the targeted submission, never a different one", async () => {
    const targetPhotos = [photo({ localPhotoId: "photo-target" })];
    const otherPhotos = [photo({ localPhotoId: "photo-other", localSubmissionId: "local-sub-2" })];
    const { deps, deletedPhotoIds, deletedSubmissionIds } = fakeDeleteDeps({
      "local-sub-1": targetPhotos,
      "local-sub-2": otherPhotos,
    });
    await deleteLocalSubmissionDurably("local-sub-1", deps);
    assert.deepEqual(deletedPhotoIds, ["photo-target"]);
    assert.deepEqual(deletedSubmissionIds, ["local-sub-1"]);
  });
});
