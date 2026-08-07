import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findPhotoReuse,
  upsertPhotoUseRecords,
  type PhotoUseRecord,
} from "./photo-dedup-registry.ts";

function record(partial: Partial<PhotoUseRecord> & Pick<PhotoUseRecord, "jobCardId" | "fingerprint">): PhotoUseRecord {
  return {
    category: "device_label",
    fieldLabel: "Camera 1 label",
    usedAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

describe("Photo dedup registry", () => {
  it("finds the same fingerprint used on a different job card", () => {
    const records = [record({ jobCardId: "job-A", fingerprint: "abc123" })];
    const found = findPhotoReuse(records, "abc123", "job-B");
    assert.equal(found?.jobCardId, "job-A");
  });

  it("does not flag the same job card's own photo", () => {
    const records = [record({ jobCardId: "job-A", fingerprint: "abc123" })];
    const found = findPhotoReuse(records, "abc123", "job-A");
    assert.equal(found, null);
  });

  it("matches regardless of category or field — reuse under a different category still flags", () => {
    const records = [
      record({ jobCardId: "job-A", fingerprint: "abc123", category: "vin", fieldLabel: "VIN photo" }),
    ];
    const found = findPhotoReuse(records, "abc123", "job-B");
    assert.equal(found?.category, "vin");
  });

  it("ignores an empty fingerprint", () => {
    const records = [record({ jobCardId: "job-A", fingerprint: "" })];
    const found = findPhotoReuse(records, "", "job-B");
    assert.equal(found, null);
  });

  it("upsertPhotoUseRecords adds new records and de-duplicates identical (jobCard, fingerprint, field) entries", () => {
    const existing = [record({ jobCardId: "job-A", fingerprint: "abc123" })];
    const merged = upsertPhotoUseRecords(existing, [
      record({ jobCardId: "job-A", fingerprint: "abc123" }),
      record({ jobCardId: "job-B", fingerprint: "def456" }),
    ]);
    assert.equal(merged.length, 2);
  });
});
