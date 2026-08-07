import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLAXTAIR_AHD_PRODUCT_DEFINITION, buildInstalledProductSystem } from "../product-devices/index.ts";
import { createEmptyJobCard, type BlaxtairJobCardPhoto } from "./blaxtair-job-card.ts";
import {
  createCorrectedRevision,
  findCrossSubmissionDeviceReuse,
  findCrossSubmissionPhotoReuse,
  getCurrentRevision,
  getRevisionChain,
  getRevisionChainIds,
  isSuperseded,
} from "./blaxtair-submission-store.ts";

function completed(id: string, overrides: Partial<ReturnType<typeof createEmptyJobCard>> = {}) {
  const card = createEmptyJobCard(id, "2026-08-01T00:00:00.000Z");
  return { ...card, status: "completed" as const, completedAt: "2026-08-01T00:00:00.000Z", ...overrides };
}

describe("Revision chain", () => {
  it("a single original submission is its own chain and its own current revision", () => {
    const original = completed("orig");
    const chain = getRevisionChain([original], original);
    assert.equal(chain.length, 1);
    assert.equal(getCurrentRevision([original], original)?.id, "orig");
    assert.equal(isSuperseded([original], original), false);
  });

  it("createCorrectedRevision links to the original and increments the revision number", () => {
    const original = completed("orig");
    const revision = createCorrectedRevision(original, {
      newId: "rev-2",
      reason: "Wrong power connection description",
      revisedBy: "Tech A",
      nowIso: "2026-08-02T00:00:00.000Z",
    });
    assert.equal(revision.status, "draft");
    assert.equal(revision.revision.originalSubmissionId, "orig");
    assert.equal(revision.revision.revisionNumber, 2);
    assert.equal(revision.revision.supersedes, "orig");
    assert.equal(revision.revision.reason, "Wrong power connection description");
  });

  it("a completed chain reports the highest revision number as current, and the original as superseded", () => {
    const original = completed("orig");
    const revisedDraft = createCorrectedRevision(original, {
      newId: "rev-2",
      reason: "correction",
      revisedBy: "Tech A",
    });
    const revisionCompleted = { ...revisedDraft, status: "completed" as const, completedAt: "2026-08-03T00:00:00.000Z" };
    const submissions = [original, revisionCompleted];

    assert.equal(getCurrentRevision(submissions, original)?.id, "rev-2");
    assert.equal(isSuperseded(submissions, original), true);
    assert.equal(isSuperseded(submissions, revisionCompleted), false);
    assert.deepEqual(getRevisionChainIds(submissions, "orig").sort(), ["orig", "rev-2"]);
  });

  it("supports a chain of more than two revisions, ordered by revision number", () => {
    const original = completed("orig");
    const rev2 = { ...createCorrectedRevision(original, { newId: "rev-2", reason: "a", revisedBy: "T" }), status: "completed" as const, completedAt: "x" };
    const rev3 = { ...createCorrectedRevision(rev2, { newId: "rev-3", reason: "b", revisedBy: "T" }), status: "completed" as const, completedAt: "y" };
    const submissions = [original, rev2, rev3];

    const chain = getRevisionChain(submissions, "orig");
    assert.deepEqual(chain.map((c) => c.id), ["orig", "rev-2", "rev-3"]);
    assert.equal(getCurrentRevision(submissions, "orig")?.id, "rev-3");
    assert.equal(rev3.revision.originalSubmissionId, "orig");
  });
});

describe("Cross-submission reuse (excluding same chain)", () => {
  it("blocks a photo fingerprint reused on an unrelated completed submission", () => {
    const photo: BlaxtairJobCardPhoto = {
      id: "p1",
      category: "vehicle_overview",
      label: "Vehicle overview",
      description: "",
      localPreview: "",
      contentFingerprint: "fp-1",
      uploadedAt: "2026-08-01T00:00:00.000Z",
    };
    const unrelated = completed("job-A", { photos: [photo] });
    const found = findCrossSubmissionPhotoReuse([unrelated], "fp-1", ["job-B"]);
    assert.equal(found?.id, "job-A");
  });

  it("allows a photo fingerprint that belongs to the current job's own revision chain", () => {
    const photo: BlaxtairJobCardPhoto = {
      id: "p1",
      category: "vehicle_overview",
      label: "Vehicle overview",
      description: "",
      localPreview: "",
      contentFingerprint: "fp-1",
      uploadedAt: "2026-08-01T00:00:00.000Z",
    };
    const original = completed("orig", { photos: [photo] });
    const found = findCrossSubmissionPhotoReuse([original], "fp-1", ["orig", "rev-2"]);
    assert.equal(found, null);
  });

  it("blocks a device (part+serial) reused on an unrelated completed submission", () => {
    const withDevice = completed("job-A", {
      equipment: buildInstalledProductSystem({
        definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
        identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      }),
    });
    const found = findCrossSubmissionDeviceReuse([withDevice], "210-110-001", "26062215", ["job-B"]);
    assert.equal(found?.id, "job-A");
  });

  it("allows a device inherited from the current job's own revision chain", () => {
    const withDevice = completed("orig", {
      equipment: buildInstalledProductSystem({
        definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
        identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      }),
    });
    const found = findCrossSubmissionDeviceReuse([withDevice], "210-110-001", "26062215", ["orig", "rev-2"]);
    assert.equal(found, null);
  });
});
