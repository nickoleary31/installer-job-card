import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UploadedPhotoMetadata } from "../lib/job-card-submission.ts";
import {
  applyMergedPhotoUploadsToPayload,
  dedupePhotoUploadsByStoragePath,
  extractPhotoUploadsFromPayload,
  mergeDurablePhotoUploads,
  verifyMergedStoragePathsPresent,
} from "../lib/draft-photo-persistence.ts";

function ref(path: string, field = "vehicleFront"): UploadedPhotoMetadata {
  return {
    fieldName: field,
    group: "vehicle",
    label: field,
    filename: path.split("/").pop() || "x.jpg",
    storagePath: path,
    publicUrl: `https://example.test/${path}`,
    uploadedAt: "2026-07-11T00:00:00.000Z",
  };
}

describe("dedupePhotoUploadsByStoragePath", () => {
  it("dedupes by exact storagePath", () => {
    const a = ref("sid/vehicle/vehicleFront/a.jpg");
    const b = { ...a, filename: "other.jpg" };
    const out = dedupePhotoUploadsByStoragePath([a, b, ref("sid/vehicle/vehicleSide/b.jpg", "vehicleSide")]);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.filename, "a.jpg");
  });

  it("drops entries without storagePath", () => {
    const bad = { ...ref("x"), storagePath: "" };
    assert.equal(dedupePhotoUploadsByStoragePath([bad]).length, 0);
  });
});

describe("extractPhotoUploadsFromPayload", () => {
  it("reads top-level and nested photoSummary uploads", () => {
    const a = ref("s/vehicle/vehicleFront/1.jpg");
    const b = ref("s/vehicle/vehicleSide/2.jpg", "vehicleSide");
    const out = extractPhotoUploadsFromPayload({
      photoUploads: [a],
      photoSummary: { photoUploads: [a, b] },
    });
    assert.equal(out.length, 2);
  });

  it("supports legacy drafts with no photoUploads", () => {
    assert.deepEqual(extractPhotoUploadsFromPayload({ coreJob: {} }), []);
    assert.deepEqual(extractPhotoUploadsFromPayload(null), []);
  });
});

describe("mergeDurablePhotoUploads", () => {
  it("1. merges multiple photos from memory when cloud empty", () => {
    const memory = [ref("s/v/f/1.jpg"), ref("s/v/s/2.jpg", "vehicleSide")];
    const r = mergeDurablePhotoUploads({ cloudUploads: [], memoryUploads: memory });
    assert.equal(r.mergedRefCount, 2);
    assert.equal(r.thinPayloadProtected, false);
  });

  it("2. resume+save without new photos keeps cloud refs", () => {
    const cloud = [ref("s/v/f/1.jpg"), ref("s/v/s/2.jpg", "vehicleSide")];
    const r = mergeDurablePhotoUploads({ cloudUploads: cloud, memoryUploads: cloud });
    assert.equal(r.mergedRefCount, 2);
  });

  it("3. second-device: cloud refs + empty memory preserves cloud", () => {
    const cloud = [ref("s/v/f/1.jpg"), ref("s/linxup/linxup_at_finalInstall/3.jpg", "linxup_at_finalInstall")];
    const r = mergeDurablePhotoUploads({ cloudUploads: cloud, memoryUploads: [] });
    assert.equal(r.mergedRefCount, 2);
    assert.equal(r.thinPayloadProtected, true);
  });

  it("4. existing cloud + empty in-memory array", () => {
    const cloud = [ref("a"), ref("b", "vehicleSide"), ref("c", "vehicleRear")];
    const r = mergeDurablePhotoUploads({ cloudUploads: cloud, memoryUploads: [] });
    assert.equal(r.mergedRefCount, 3);
    assert.equal(r.thinPayloadProtected, true);
  });

  it("5. existing cloud + partial in-memory array", () => {
    const cloud = [ref("a"), ref("b", "vehicleSide"), ref("c", "vehicleRear")];
    const memory = [ref("a")];
    const r = mergeDurablePhotoUploads({ cloudUploads: cloud, memoryUploads: memory });
    assert.equal(r.mergedRefCount, 3);
    assert.equal(r.thinPayloadProtected, true);
  });

  it("6. existing cloud + one new photo", () => {
    const cloud = [ref("a"), ref("b", "vehicleSide")];
    const newly = [ref("c", "vehicleRear")];
    const r = mergeDurablePhotoUploads({ cloudUploads: cloud, memoryUploads: cloud, newlyUploaded: newly });
    assert.equal(r.mergedRefCount, 3);
  });

  it("7. failed upload excluded when not in newlyUploaded/memory", () => {
    const cloud = [ref("ok1"), ref("ok2", "vehicleSide")];
    const memory = [ref("ok1"), ref("ok2", "vehicleSide")];
    const r = mergeDurablePhotoUploads({ cloudUploads: cloud, memoryUploads: memory, newlyUploaded: [] });
    assert.equal(r.mergedRefCount, 2);
  });

  it("8. sequential drafts use independent cloud arrays", () => {
    const draftA = mergeDurablePhotoUploads({
      cloudUploads: [ref("draftA/1")],
      memoryUploads: [ref("draftA/1")],
    });
    const draftB = mergeDurablePhotoUploads({
      cloudUploads: [],
      memoryUploads: [ref("draftB/1"), ref("draftB/2", "vehicleSide")],
    });
    assert.equal(draftA.mergedRefCount, 1);
    assert.equal(draftB.mergedRefCount, 2);
  });

  it("9. switching LinxUp products keeps distinct field refs", () => {
    const cloud = [
      ref("s/vehicle/vehicleFront/1.jpg"),
      ref("s/linxup/linxup_vt_vehicleTrackerTag/2.jpg", "linxup_vt_vehicleTrackerTag"),
    ];
    const memory = [
      ...cloud,
      ref("s/linxup/linxup_lc_linxCamTag/3.jpg", "linxup_lc_linxCamTag"),
    ];
    const r = mergeDurablePhotoUploads({ cloudUploads: cloud, memoryUploads: memory });
    assert.equal(r.mergedRefCount, 3);
  });

  it("10. vehicle + LinxUp device photos", () => {
    const memory = [
      ref("s/vehicle/vehicleFront/1.jpg"),
      ref("s/vehicle/vehicleSide/2.jpg", "vehicleSide"),
      ref("s/linxup/linxup_at_powerConnection/3.jpg", "linxup_at_powerConnection"),
      ref("s/linxup/linxup_at_finalInstall/4.jpg", "linxup_at_finalInstall"),
    ];
    const r = mergeDurablePhotoUploads({ cloudUploads: [], memoryUploads: memory });
    assert.equal(r.mergedRefCount, 4);
  });

  it("11/12. autosave-style memory after manual save still merges with cloud", () => {
    const cloud = [ref("a"), ref("b", "vehicleSide")];
    // autosave reload might only have subset momentarily
    const r = mergeDurablePhotoUploads({ cloudUploads: cloud, memoryUploads: [ref("a")] });
    assert.equal(r.mergedRefCount, 2);
    assert.equal(r.thinPayloadProtected, true);
  });

  it("13. verification catches missing paths after write", () => {
    const expected = ["a", "b", "c"];
    const saved = { photoUploads: [ref("a"), ref("b", "vehicleSide")] };
    const v = verifyMergedStoragePathsPresent(saved, expected);
    assert.equal(v.ok, false);
    assert.deepEqual(v.missing, ["c"]);
  });

  it("14. explicit removal is represented by omitting path from both sides", () => {
    const cloudAfterExplicitDelete = [ref("keep")];
    const memoryAfterExplicitDelete = [ref("keep")];
    const r = mergeDurablePhotoUploads({
      cloudUploads: cloudAfterExplicitDelete,
      memoryUploads: memoryAfterExplicitDelete,
    });
    assert.equal(r.mergedRefCount, 1);
    assert.equal(r.thinPayloadProtected, false);
  });

  it("15. legacy draft with no photoUploads", () => {
    const cloud = extractPhotoUploadsFromPayload({ coreJob: { customer: "X" } });
    const r = mergeDurablePhotoUploads({ cloudUploads: cloud, memoryUploads: [ref("new")] });
    assert.equal(r.mergedRefCount, 1);
    assert.equal(r.thinPayloadProtected, false);
  });
});

describe("applyMergedPhotoUploadsToPayload", () => {
  it("preserves unrelated payload fields", () => {
    const payload = {
      coreJob: { customer: "Low Country" },
      formId: "linxup_asset_tracker",
      photoUploads: [] as UploadedPhotoMetadata[],
      photoSummary: { vac4PhotoCounts: { vacMounting: 0 } },
    };
    const merged = [ref("s/v/f/1.jpg")];
    const next = applyMergedPhotoUploadsToPayload(payload, merged);
    assert.equal(next.coreJob.customer, "Low Country");
    assert.equal(next.formId, "linxup_asset_tracker");
    assert.equal(next.photoUploads.length, 1);
    assert.equal((next.photoSummary as unknown as { photoUploads: UploadedPhotoMetadata[] }).photoUploads.length, 1);
    assert.equal((next.photoSummary as unknown as { vac4PhotoCounts: { vacMounting: number } }).vac4PhotoCounts.vacMounting, 0);
  });
});
