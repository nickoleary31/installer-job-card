import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLAXTAIR_AHD_PRODUCT_DEFINITION, buildInstalledProductSystem } from "../product-devices/index.ts";
import { findMatchingOtherDraft, removeDraft, upsertDraft } from "./blaxtair-draft-store.ts";
import { createEmptyJobCard, type BlaxtairJobCardPhoto } from "./blaxtair-job-card.ts";

describe("upsertDraft / removeDraft", () => {
  it("adds a new draft and updates an existing one by id", () => {
    const a = createEmptyJobCard("a");
    let drafts = upsertDraft([], a);
    assert.equal(drafts.length, 1);

    const aUpdated = { ...a, technicianNotes: "updated" };
    drafts = upsertDraft(drafts, aUpdated);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.technicianNotes, "updated");
  });

  it("removes a draft by id", () => {
    const a = createEmptyJobCard("a");
    const b = createEmptyJobCard("b");
    const drafts = removeDraft([a, b], "a");
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.id, "b");
  });
});

describe("findMatchingOtherDraft", () => {
  it("finds a photo fingerprint match in a different draft", () => {
    const other = createEmptyJobCard("other");
    other.photos = [
      {
        id: "p1",
        category: "vehicle_overview",
        label: "Vehicle overview",
        description: "",
        localPreview: "",
        contentFingerprint: "fp-shared",
        uploadedAt: "2026-08-01T00:00:00.000Z",
      } satisfies BlaxtairJobCardPhoto,
    ];
    const found = findMatchingOtherDraft([other], { excludeId: "current", fingerprint: "fp-shared" });
    assert.equal(found?.id, "other");
  });

  it("does not match the draft's own id", () => {
    const current = createEmptyJobCard("current");
    current.photos = [
      {
        id: "p1",
        category: "vehicle_overview",
        label: "Vehicle overview",
        description: "",
        localPreview: "",
        contentFingerprint: "fp-shared",
        uploadedAt: "2026-08-01T00:00:00.000Z",
      } satisfies BlaxtairJobCardPhoto,
    ];
    const found = findMatchingOtherDraft([current], { excludeId: "current", fingerprint: "fp-shared" });
    assert.equal(found, null);
  });

  it("finds a device key match (part number + serial number) in a different draft", () => {
    const other = createEmptyJobCard("other");
    other.equipment = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
    });
    const found = findMatchingOtherDraft([other], {
      excludeId: "current",
      partNumber: "210-110-001",
      serialNumber: "26062215",
    });
    assert.equal(found?.id, "other");
  });

  it("does not match a different device type sharing a serial", () => {
    const other = createEmptyJobCard("other");
    other.equipment = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "999-999-999", serialNumber: "26062215" },
    });
    const found = findMatchingOtherDraft([other], {
      excludeId: "current",
      partNumber: "210-110-001",
      serialNumber: "26062215",
    });
    assert.equal(found, null);
  });

  it("returns null when there is nothing to check", () => {
    const other = createEmptyJobCard("other");
    const found = findMatchingOtherDraft([other], { excludeId: "current" });
    assert.equal(found, null);
  });
});
