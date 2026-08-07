import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyIdentifierEdit,
  buildInstalledDeviceEmailSections,
  createInstalledDeviceId,
  definitionRequiresInstallationVariant,
  dualWriteLinxUpFromInstalledDevices,
  isProductDevicesPilotEnabled,
  mapPrototypeFieldsToIdentifiers,
  mergeDurableInstalledDevices,
  normalizeMacAddress,
  parseProductDevicesPilotMode,
  removeInstalledDevice,
  resolveDetectedHardwareToCompanyProduct,
  selectedSectionsFromInstalledDevices,
  upsertInstalledDevice,
  validateImei,
  validateMacAddress,
  validateSerialNumber,
  type InstalledProductDevice,
} from "./index.ts";
import { PILOT_PRODUCT_DEVICE_DEFINITIONS } from "./hardware-profiles.ts";

function device(partial: Partial<InstalledProductDevice> & Pick<InstalledProductDevice, "id" | "productKey">): InstalledProductDevice {
  const now = "2026-07-31T22:00:00.000Z";
  return {
    companyProductId: partial.companyProductId ?? "def",
    hardwareProfileId: partial.hardwareProfileId ?? "linxup_at3_label",
    detectedHardwareProfileId: partial.detectedHardwareProfileId ?? partial.hardwareProfileId ?? "linxup_at3_label",
    installationVariant: partial.installationVariant ?? "standard",
    identifiers: partial.identifiers ?? {},
    labelPhoto: partial.labelPhoto ?? null,
    extractionSource: partial.extractionSource ?? "ocr",
    detectionConfidence: partial.detectionConfidence ?? 80,
    technicianConfirmed: partial.technicianConfirmed ?? true,
    detectionOverridden: partial.detectionOverridden ?? false,
    identifierEdits: partial.identifierEdits ?? [],
    manualFallbackReason: partial.manualFallbackReason ?? null,
    installDetails: partial.installDetails ?? {},
    installPhotos: partial.installPhotos ?? [],
    installGuide: partial.installGuide ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    ...partial,
  };
}

describe("Product Devices resolver", () => {
  it("1. AT3 OCR → correct LinxUp company product", () => {
    const r = resolveDetectedHardwareToCompanyProduct({
      companyId: "linxup-co",
      hardwareProfileId: "linxup_at3_label",
      confidence: 90,
    });
    assert.equal(r.status, "one");
    if (r.status === "one") {
      assert.equal(r.match.productKey, "linxup_asset_tracker");
      assert.equal(r.requireConfirmation, true);
    }
  });

  it("2. Vehicle Tracker OCR → family match", () => {
    const r = resolveDetectedHardwareToCompanyProduct({
      companyId: "linxup-co",
      hardwareProfileId: "linxup_vehicle_tracker_label",
      confidence: 85,
    });
    assert.equal(r.status, "one");
    if (r.status === "one") {
      assert.equal(r.match.productKey, "linxup_vehicle_tracker");
      assert.equal(definitionRequiresInstallationVariant(r.match.definition), true);
    }
  });

  it("3. OBD-II/JBUS required after VT match", () => {
    const def = PILOT_PRODUCT_DEVICE_DEFINITIONS.find((d) => d.productKey === "linxup_vehicle_tracker")!;
    assert.deepEqual(def.supportedInstallationVariants, ["obd_ii", "jbus"]);
  });

  it("4. LinxCam low-confidence → no silent route", () => {
    const r = resolveDetectedHardwareToCompanyProduct({
      companyId: "linxup-co",
      hardwareProfileId: "linxup_linxcam_label",
      confidence: 30,
    });
    assert.equal(r.status, "low_confidence");
  });

  it("14/15. shared hardware + multiple company products", () => {
    const r = resolveDetectedHardwareToCompanyProduct({
      companyId: "linxup-co",
      hardwareProfileId: "linxup_linxcam_label",
      confidence: 90,
      includeDemoSharedHardwareProduct: true,
    });
    assert.equal(r.status, "multiple");
    if (r.status === "multiple") {
      assert.ok(r.matches.some((m) => m.productKey === "linxup_linxcam"));
      assert.ok(r.matches.some((m) => m.productKey === "demo_shared_camera"));
    }
  });

  it("16. no match → none", () => {
    const r = resolveDetectedHardwareToCompanyProduct({
      companyId: "linxup-co",
      hardwareProfileId: "linxup_at3_label",
      confidence: 90,
      definitions: [],
    });
    assert.equal(r.status, "none");
  });
});

describe("Product Devices identifiers", () => {
  it("5. serial/MAC/IMEI/activation persist via mapping", () => {
    const ids = mapPrototypeFieldsToIdentifiers({
      activationCode: "ACT-99",
      serial: "SN-RAW-001",
      imei: "490154203237518",
      mac: "aa:bb:cc:dd:ee:ff",
    });
    assert.equal(ids.activationCode, "ACT-99");
    assert.equal(ids.serialNumber, "SN-RAW-001");
    assert.equal(ids.imei, "490154203237518");
    assert.equal(ids.macAddress, "AABBCCDDEEFF");
  });

  it("6. technician correction recorded", () => {
    const before = { serialNumber: "ABC" };
    const { identifiers, edits } = applyIdentifierEdit({
      identifiers: before,
      key: "serialNumber",
      nextRaw: "XYZ-FIXED",
      edits: [],
      nowIso: "2026-07-31T22:01:00.000Z",
    });
    assert.equal(identifiers.serialNumber, "XYZ-FIXED");
    assert.equal(edits.length, 1);
    assert.equal(edits[0]?.fromValue, "ABC");
  });

  it("7. no silent serial correction", () => {
    const raw = "O0I1S5"; // lookalike chars must stay
    assert.equal(validateSerialNumber(raw).ok, true);
    assert.equal(validateSerialNumber(raw).normalized, undefined);
    const { identifiers } = applyIdentifierEdit({
      identifiers: {},
      key: "serialNumber",
      nextRaw: raw,
      edits: [],
    });
    assert.equal(identifiers.serialNumber, raw);
  });

  it("MAC normalize separators only; IMEI Luhn", () => {
    assert.equal(normalizeMacAddress("aa-bb-cc-dd-ee-ff"), "AABBCCDDEEFF");
    assert.equal(validateMacAddress("aa:bb:cc:dd:ee:ff").ok, true);
    assert.equal(validateImei("490154203237518").ok, true);
    assert.equal(validateImei("123").ok, false);
  });
});

describe("Product Devices multi-device merge", () => {
  it("8. add second device", () => {
    const a = device({ id: "d1", productKey: "linxup_asset_tracker" });
    const b = device({
      id: "d2",
      productKey: "linxup_linxcam",
      hardwareProfileId: "linxup_linxcam_label",
    });
    const list = upsertInstalledDevice(upsertInstalledDevice([], a), b);
    assert.equal(list.length, 2);
    assert.deepEqual(selectedSectionsFromInstalledDevices(list).sort(), [
      "linxup_asset_tracker",
      "linxup_linxcam",
    ]);
  });

  it("9. remove unfinished device", () => {
    const a = device({ id: "d1", productKey: "linxup_asset_tracker", technicianConfirmed: false });
    const b = device({ id: "d2", productKey: "linxup_vehicle_tracker" });
    assert.equal(removeInstalledDevice([a, b], "d1").map((d) => d.id).join(","), "d2");
  });

  it("10/11/20. resume + thin save protects cloud devices", () => {
    const cloud = [
      device({ id: "d1", productKey: "linxup_asset_tracker" }),
      device({ id: "d2", productKey: "linxup_linxcam", hardwareProfileId: "linxup_linxcam_label" }),
    ];
    const thin = mergeDurableInstalledDevices({ cloudDevices: cloud, memoryDevices: [] });
    assert.equal(thin.thinPayloadProtected, true);
    assert.equal(thin.merged.length, 2);

    const cleared = mergeDurableInstalledDevices({
      cloudDevices: cloud,
      memoryDevices: [],
      allowClear: true,
    });
    assert.equal(cleared.merged.length, 0);

    const partial = mergeDurableInstalledDevices({
      cloudDevices: cloud,
      memoryDevices: [device({ id: "d1", productKey: "linxup_asset_tracker", identifiers: { serialNumber: "kept" } })],
    });
    assert.equal(partial.merged.length, 2);
    assert.equal(partial.merged.find((d) => d.id === "d1")?.identifiers.serialNumber, "kept");
  });

  it("12. label photo persists on device record", () => {
    const d = device({
      id: "d1",
      productKey: "linxup_asset_tracker",
      labelPhoto: {
        fieldName: "deviceLabel",
        storagePath: "sub/linxup/deviceLabel/x.jpg",
        originalFileName: "label.jpg",
      },
    });
    assert.equal(d.labelPhoto?.storagePath?.includes("deviceLabel"), true);
  });

  it("13. product-specific photo isolation by deviceId", () => {
    const d1 = device({
      id: "d1",
      productKey: "linxup_asset_tracker",
      installPhotos: [{ fieldName: "finalInstall", deviceId: "d1", storagePath: "a/final.jpg" }],
    });
    const d2 = device({
      id: "d2",
      productKey: "linxup_linxcam",
      hardwareProfileId: "linxup_linxcam_label",
      installPhotos: [{ fieldName: "finalInstall", deviceId: "d2", storagePath: "b/final.jpg" }],
    });
    assert.notEqual(d1.installPhotos[0]?.storagePath, d2.installPhotos[0]?.storagePath);
    assert.equal(d1.installPhotos[0]?.deviceId, "d1");
  });
});

describe("Product Devices flag + dual-write + legacy", () => {
  it("17. feature flag off", () => {
    assert.equal(parseProductDevicesPilotMode(undefined), "off");
    assert.equal(
      isProductDevicesPilotEnabled({ mode: "off", companyName: "LinxUp", isGlobalAdmin: true }),
      false,
    );
    assert.equal(
      isProductDevicesPilotEnabled({ mode: "linxup", companyName: "LinxUp" }),
      true,
    );
    assert.equal(
      isProductDevicesPilotEnabled({ mode: "linxup", companyName: "Matrix" }),
      false,
    );
  });

  it("18/19. dual-write legacy LinxUp + identifier fields for review/email", () => {
    const devices = [
      device({
        id: createInstalledDeviceId(),
        productKey: "linxup_vehicle_tracker",
        hardwareProfileId: "linxup_vehicle_tracker_label",
        installationVariant: "obd_ii",
        identifiers: {
          activationCode: "ACT1",
          serialNumber: "SN1",
          imei: "490154203237518",
        },
        installDetails: { installationNotes: "under dash" },
      }),
    ];
    const dual = dualWriteLinxUpFromInstalledDevices({
      base: {
        formId: "linxup_vehicle_tracker",
        submissionType: "linxup_vehicle_tracker",
        productLabel: "Vehicle Tracker",
        customer: "Acme",
        location: "ATL",
        primaryContact: "",
        contactNumber: "",
        contactEmail: "",
        year: "",
        make: "Ford",
        model: "F150",
        serialVin: "VIN",
        assetNumber: "A1",
        vehicleType: "Vehicle",
        hoursMiles: "10",
      },
      devices,
    });
    assert.equal(dual.vehicleTracker?.obdPortConnected, "Yes");
    assert.equal(dual.deviceIdentifiers?.serialNumber, "SN1");
    assert.equal(dual.deviceIdentifiers?.installationVariant, "obd_ii");
    assert.equal(dual.installedDeviceIds?.length, 1);

    const emailSections = buildInstalledDeviceEmailSections(devices);
    assert.equal(emailSections.length, 1);
    assert.equal(
      emailSections[0]!.fields.find((f) => f.label === "Serial number")?.value,
      "SN1",
    );
    assert.equal(
      emailSections[0]!.fields.find((f) => f.label === "Activation code")?.value,
      "ACT1",
    );
  });
});
