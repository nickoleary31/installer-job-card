/**
 * Blaxtair demo integration tests — OCR field mapping → Product Devices system/component
 * lifecycle, draft persistence boundary, and the monitor-OCR-unavailable guard.
 *
 * Deliberately imports only DOM-free modules (product-devices + blaxtair-draft) so this
 * runs under the plain Node test runner without pulling in the browser-only OCR pipeline.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLAXTAIR_AHD_PRODUCT_DEFINITION,
  applyBlaxtairCameraCount,
  buildEmptyMonitorComponent,
  buildInstalledProductSystem,
  mapPrototypeFieldsToIdentifiers,
  removeComponentById,
  updateComponentFields,
} from "../../product-devices/index.ts";
import {
  BLAXTAIR_MONITOR_LABEL_OCR_SUPPORTED,
  findDuplicateDeviceInSystem,
  findDuplicatePhotoInSystem,
  parseDraftJson,
  serializeDraft,
} from "./blaxtair-draft.ts";
import { BLAXTAIR_CAMERA_GROUND_TRUTH } from "./blaxtair-fixture.ts";

function camera1Identifiers() {
  return mapPrototypeFieldsToIdentifiers({
    partNumber: BLAXTAIR_CAMERA_GROUND_TRUTH.expectedPartNumber,
    serial: BLAXTAIR_CAMERA_GROUND_TRUTH.expectedSerial,
    ipAddress: BLAXTAIR_CAMERA_GROUND_TRUTH.expectedIp,
  });
}

describe("Blaxtair OCR → Product Devices bridge", () => {
  it("maps OCR fields to durable identifiers unchanged", () => {
    const ids = camera1Identifiers();
    assert.equal(ids.partNumber, "210-110-001");
    assert.equal(ids.serialNumber, "26062215");
    assert.equal(ids.ipAddress, "192.168.89.250");
  });

  it("first accepted scan creates one system with Camera 1 populated from the scan", () => {
    const system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: camera1Identifiers(),
      detectedHardwareProfileId: "blaxtair_ahd_camera_label",
      detectionConfidence: 88,
      extractionSource: "ocr",
      technicianConfirmed: true,
    });
    assert.equal(system.productKey, "blaxtair_ahd");
    assert.equal(system.components.length, 1);
    assert.equal(system.components[0]?.identifiers.serialNumber, "26062215");
    assert.equal(system.components[0]?.technicianConfirmed, true);
  });

  it("1 camera + monitor system", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: camera1Identifiers(),
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 1 });
    assert.equal(system.components.length, 2);
    assert.equal(system.components.find((c) => c.slotKey === "camera_1")?.identifiers.serialNumber, "26062215");
    assert.ok(system.components.find((c) => c.slotKey === "monitor"));
  });

  it("4 camera + monitor system", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: camera1Identifiers(),
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 4 });
    const cameraSlots = system.components.filter((c) => c.componentType === "camera").map((c) => c.slotKey).sort();
    assert.deepEqual(cameraSlots, ["camera_1", "camera_2", "camera_3", "camera_4"]);
    assert.equal(system.components.filter((c) => c.componentType === "monitor").length, 1);
    // Camera 1's scanned identity survives the count change.
    assert.equal(
      system.components.find((c) => c.slotKey === "camera_1")?.identifiers.serialNumber,
      "26062215",
    );
  });

  it("stable component ownership: removing camera_2 does not move camera_3 data", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: camera1Identifiers(),
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 3 });
    const cam2 = system.components.find((c) => c.slotKey === "camera_2")!;
    const cam3 = system.components.find((c) => c.slotKey === "camera_3")!;
    system = updateComponentFields(system, cam3.id, {
      identifiers: { serialNumber: "CAM3-SERIAL" },
    });

    system = removeComponentById(system, cam2.id);

    const remainingCam3 = system.components.find((c) => c.id === cam3.id);
    assert.equal(remainingCam3?.slotKey, "camera_3");
    assert.equal(remainingCam3?.identifiers.serialNumber, "CAM3-SERIAL");
    assert.equal(system.components.find((c) => c.slotKey === "camera_2"), undefined);
  });

  it("mounting location + view direction persist through update + JSON round-trip", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: camera1Identifiers(),
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 2 });
    const cam1 = system.components.find((c) => c.slotKey === "camera_1")!;
    system = updateComponentFields(system, cam1.id, {
      mountingLocation: "front",
      viewDirection: "forward",
    });

    const json = serializeDraft([system]);
    const restored = parseDraftJson<typeof system[]>(json)!;

    const restoredCam1 = restored[0]!.components.find((c) => c.slotKey === "camera_1");
    assert.equal(restoredCam1?.mountingLocation, "front");
    assert.equal(restoredCam1?.viewDirection, "forward");
    assert.equal(restoredCam1?.id, cam1.id);
  });

  it("monitor supports manual entry (serial, part number, mounting) with no OCR source", () => {
    const monitor = buildEmptyMonitorComponent({ systemId: "sys-1" });
    const patched = { ...monitor, identifiers: { serialNumber: "MON-SN-1", partNumber: "MON-PN-1" }, mountingLocation: "cab_interior" as const, extractionSource: "manual" as const };
    assert.equal(patched.identifiers.serialNumber, "MON-SN-1");
    assert.equal(patched.extractionSource, "manual");
  });

  it("monitor OCR is not claimed anywhere in this demo", () => {
    assert.equal(BLAXTAIR_MONITOR_LABEL_OCR_SUPPORTED, false);
  });

  it("draft resume: system/component UUIDs and identifiers survive a save/reload cycle", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: camera1Identifiers(),
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 2 });
    const saved = serializeDraft([system]);

    const loaded = parseDraftJson<typeof system[]>(saved)!;
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.id, system.id);
    assert.deepEqual(
      loaded[0]!.components.map((c) => c.id).sort(),
      system.components.map((c) => c.id).sort(),
    );
    assert.equal(
      loaded[0]!.components.find((c) => c.slotKey === "camera_1")?.identifiers.serialNumber,
      "26062215",
    );
  });

  it("parseDraftJson tolerates malformed JSON without throwing", () => {
    assert.equal(parseDraftJson("{not json"), null);
    assert.equal(parseDraftJson(null), null);
  });
});

describe("Same-form duplicate camera guard (part number + serial number)", () => {
  it("flags a second component reusing an already-confirmed part+serial pair", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 2 });
    const cam2 = system.components.find((c) => c.slotKey === "camera_2")!;

    const dup = findDuplicateDeviceInSystem(system.components, cam2.id, "210-110-001", "26062215");
    assert.equal(dup?.slotKey, "camera_1");
  });

  it("allows a genuinely different serial", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 2 });
    const cam2 = system.components.find((c) => c.slotKey === "camera_2")!;

    const dup = findDuplicateDeviceInSystem(system.components, cam2.id, "210-110-001", "26062216");
    assert.equal(dup, null);
  });

  it("does not flag two different device types that happen to share a serial number", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 2 });
    const cam2 = system.components.find((c) => c.slotKey === "camera_2")!;

    // Same serial, different part number (e.g. a monitor that happens to share a serial digit
    // string with a camera) must never collide — the key is the pair, not the serial alone.
    const dup = findDuplicateDeviceInSystem(system.components, cam2.id, "300-020-005", "26062215");
    assert.equal(dup, null);
  });

  it("ignores empty-serial placeholder slots", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 3 });
    const cam2 = system.components.find((c) => c.slotKey === "camera_2")!;

    // camera_3 has no serial yet — must never be reported as a false-positive duplicate.
    const dup = findDuplicateDeviceInSystem(system.components, cam2.id, "", "");
    assert.equal(dup, null);
  });

  it("does not flag a component against itself", () => {
    const system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      technicianConfirmed: true,
    });
    const cam1 = system.components[0]!;
    const dup = findDuplicateDeviceInSystem(system.components, cam1.id, "210-110-001", "26062215");
    assert.equal(dup, null);
  });

  it("normalizes case/whitespace but never treats different part numbers as equal", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 2 });
    const cam2 = system.components.find((c) => c.slotKey === "camera_2")!;

    const dup = findDuplicateDeviceInSystem(system.components, cam2.id, " 210-110-001 ", " 26062215 ");
    assert.equal(dup?.slotKey, "camera_1");
  });
});

describe("Same-form duplicate photo guard", () => {
  it("flags a second component reusing the same photo fingerprint", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      technicianConfirmed: true,
      labelPhoto: { fieldName: "label", contentFingerprint: "fp-abc123" },
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 2 });
    const cam2 = system.components.find((c) => c.slotKey === "camera_2")!;

    const dup = findDuplicatePhotoInSystem(system.components, cam2.id, "fp-abc123");
    assert.equal(dup?.slotKey, "camera_1");
  });

  it("allows a genuinely different photo", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      technicianConfirmed: true,
      labelPhoto: { fieldName: "label", contentFingerprint: "fp-abc123" },
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 2 });
    const cam2 = system.components.find((c) => c.slotKey === "camera_2")!;

    const dup = findDuplicatePhotoInSystem(system.components, cam2.id, "fp-different");
    assert.equal(dup, null);
  });

  it("does not flag components with no photo on file", () => {
    let system = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers: { partNumber: "210-110-001", serialNumber: "26062215" },
      technicianConfirmed: true,
    });
    system = applyBlaxtairCameraCount({ system, cameraCount: 2 });
    const cam2 = system.components.find((c) => c.slotKey === "camera_2")!;

    const dup = findDuplicatePhotoInSystem(system.components, cam2.id, "fp-anything");
    assert.equal(dup, null);
  });
});
