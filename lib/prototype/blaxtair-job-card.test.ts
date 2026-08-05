import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLAXTAIR_AHD_PRODUCT_DEFINITION, buildInstalledProductSystem } from "../product-devices/index.ts";
import {
  collectJobCardDeviceKeys,
  collectJobCardPhotoFingerprints,
  computeJobCardValidation,
  computeJobCardWarnings,
  createEmptyJobCard,
  findDuplicateFingerprintInJobCard,
  type BlaxtairJobCardPhoto,
} from "./blaxtair-job-card.ts";

function galleryPhoto(partial: Partial<BlaxtairJobCardPhoto> & Pick<BlaxtairJobCardPhoto, "id" | "contentFingerprint">): BlaxtairJobCardPhoto {
  return {
    category: "vehicle_overview",
    label: "Vehicle overview",
    description: "",
    localPreview: "",
    uploadedAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

describe("createEmptyJobCard", () => {
  it("starts as a draft on the job_site stage with empty sections", () => {
    const card = createEmptyJobCard("card-1", "2026-08-01T00:00:00.000Z");
    assert.equal(card.status, "draft");
    assert.equal(card.currentStage, "job_site");
    assert.equal(card.equipment, null);
    assert.deepEqual(card.photos, []);
    assert.equal(card.revision.revisionNumber, 1);
    assert.equal(card.revision.originalSubmissionId, null);
  });
});

describe("collectJobCardPhotoFingerprints / findDuplicateFingerprintInJobCard", () => {
  it("collects fingerprints from both the general gallery and equipment label photos", () => {
    const card = createEmptyJobCard("card-1");
    card.photos = [galleryPhoto({ id: "p1", contentFingerprint: "fp-gallery" })];
    card.equipment = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      labelPhoto: { fieldName: "label", contentFingerprint: "fp-label" },
    });

    const all = collectJobCardPhotoFingerprints(card);
    assert.deepEqual(
      all.map((f) => f.fingerprint).sort(),
      ["fp-gallery", "fp-label"],
    );
  });

  it("flags a gallery photo reused as an equipment label photo (cross-category)", () => {
    const card = createEmptyJobCard("card-1");
    card.equipment = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      labelPhoto: { fieldName: "label", contentFingerprint: "fp-shared" },
    });
    const dup = findDuplicateFingerprintInJobCard(card, "new-photo-id", "fp-shared");
    assert.ok(dup);
  });

  it("does not flag a component against itself when editing its own photo", () => {
    const card = createEmptyJobCard("card-1");
    card.equipment = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      labelPhoto: { fieldName: "label", contentFingerprint: "fp-shared" },
    });
    const componentId = card.equipment.components[0]!.id;
    const dup = findDuplicateFingerprintInJobCard(card, componentId, "fp-shared");
    assert.equal(dup, null);
  });

  it("ignores an empty fingerprint", () => {
    const card = createEmptyJobCard("card-1");
    const dup = findDuplicateFingerprintInJobCard(card, "x", "");
    assert.equal(dup, null);
  });
});

describe("collectJobCardDeviceKeys", () => {
  it("only includes components with a non-empty serial", () => {
    const card = createEmptyJobCard("card-1");
    card.equipment = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
    });
    const keys = collectJobCardDeviceKeys(card);
    assert.equal(keys.length, 1);
    assert.equal(keys[0]?.serialNumber, "26062215");
  });

  it("returns an empty list when there is no equipment yet", () => {
    const card = createEmptyJobCard("card-1");
    assert.deepEqual(collectJobCardDeviceKeys(card), []);
  });
});

describe("computeJobCardWarnings", () => {
  it("warns about missing job/site info, vehicle identifier, equipment, and every required photo on a blank card", () => {
    const card = createEmptyJobCard("card-1");
    const warnings = computeJobCardWarnings(card);
    assert.ok(warnings.some((w) => w.includes("Company")));
    assert.ok(warnings.some((w) => w.includes("Customer")));
    assert.ok(warnings.some((w) => w.includes("Technician")));
    assert.ok(warnings.some((w) => w.includes("VIN")));
    assert.ok(warnings.some((w) => w.includes("No equipment")));
    assert.ok(warnings.some((w) => w.includes("Missing photo: Vehicle")));
  });

  it("does not warn about a connection's photo when that connection is marked not applicable", () => {
    const card = createEmptyJobCard("card-1");
    card.installation.ignition.applicable = false;
    const warnings = computeJobCardWarnings(card);
    assert.ok(!warnings.some((w) => w.includes("Ignition connection")));
  });

  it("stops warning once required fields and photos are filled in", () => {
    const card = createEmptyJobCard("card-1");
    card.jobSite.company = "Acme";
    card.jobSite.customer = "Riverbend";
    card.jobSite.technician = "Tech A";
    card.vehicle.vin = "1FT-DEMO";
    card.equipment = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      technicianConfirmed: true,
    });
    const warnings = computeJobCardWarnings(card);
    assert.ok(!warnings.some((w) => w.includes("Company")));
    assert.ok(!warnings.some((w) => w.includes("Customer")));
    assert.ok(!warnings.some((w) => w.includes("Technician is not set")));
    assert.ok(!warnings.some((w) => w.includes("Neither a VIN")));
    assert.ok(!warnings.some((w) => w.includes("No equipment")));
    assert.ok(!warnings.some((w) => w.includes("not yet confirmed")));
  });
});

describe("computeJobCardValidation", () => {
  it("flags an applicable connection with no point/description as required, not optional", () => {
    const card = createEmptyJobCard("card-1");
    const { required, optional } = computeJobCardValidation(card);
    assert.ok(required.some((i) => i.message.includes("Power connection") && i.stage === "connections"));
    assert.ok(required.some((i) => i.message.includes("Ground connection") && i.stage === "connections"));
    assert.ok(required.some((i) => i.message.includes("Ignition connection") && i.stage === "connections"));
    assert.ok(!optional.some((i) => i.message.includes("Power connection")));
  });

  it("does not require a connection's point/description when marked not applicable", () => {
    const card = createEmptyJobCard("card-1");
    card.installation.ignition.applicable = false;
    const { required } = computeJobCardValidation(card);
    assert.ok(!required.some((i) => i.message.includes("Ignition connection")));
  });

  it("stops requiring a connection once both point and description are filled in", () => {
    const card = createEmptyJobCard("card-1");
    card.installation.power.point = "Fuse box";
    card.installation.power.description = "Tapped accessory circuit";
    const { required } = computeJobCardValidation(card);
    // "Missing photo: Power connection." also matches a naive "Power connection" substring check —
    // the point/description requirement carries the more specific "point/description" wording.
    assert.ok(!required.some((i) => i.message.includes("Power connection point/description")));
  });

  it("requires a device/monitor mounting location", () => {
    const card = createEmptyJobCard("card-1");
    const { required } = computeJobCardValidation(card);
    assert.ok(required.some((i) => i.message.includes("mounting location") && i.stage === "connections"));
    card.installation.deviceMountingLocation = "Dash, driver side";
    const after = computeJobCardValidation(card);
    assert.ok(!after.required.some((i) => i.message.includes("mounting location")));
  });

  it("treats empty technician notes and the equipment-label photo as optional, never required", () => {
    const card = createEmptyJobCard("card-1");
    const { required, optional } = computeJobCardValidation(card);
    assert.ok(optional.some((i) => i.message.includes("Technician notes") && i.stage === "notes"));
    assert.ok(optional.some((i) => i.message.includes("equipment label")));
    assert.ok(!required.some((i) => i.message.includes("Technician notes")));
  });

  it("every required issue carries the stage a technician should jump back to", () => {
    const card = createEmptyJobCard("card-1");
    const { required } = computeJobCardValidation(card);
    assert.ok(required.length > 0);
    for (const issue of required) {
      assert.ok(
        ["job_site", "vehicle", "equipment", "connections", "photos", "notes"].includes(issue.stage),
        `unexpected stage: ${issue.stage}`,
      );
    }
  });
});
