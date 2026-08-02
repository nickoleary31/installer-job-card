import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractFromBarcodeAndOcr } from "./extract.ts";
import { suggestCorrections } from "./corrections.ts";
import {
  LINXUP_ASSET_TRACKER_LABEL_PROFILE,
  LINXUP_LINXCAM_LABEL_PROFILE,
  LINXUP_VEHICLE_TRACKER_LABEL_PROFILE,
  normalizeMacRaw,
} from "./profile.ts";

describe("prototype label profiles", () => {
  it("AT3/OBD extract activation + serial + IMEI", () => {
    const text = `
ACTIVATION CODE: AT3X7M2P
SERIAL NUMBER: LXAT-7K92MQ14
IMEI: 490154203237518
`;
    for (const profile of [LINXUP_ASSET_TRACKER_LABEL_PROFILE, LINXUP_VEHICLE_TRACKER_LABEL_PROFILE]) {
      const result = extractFromBarcodeAndOcr({
        profile,
        barcodePayloads: [],
        ocrText: text,
        ocrConfidence: 88,
      });
      const byKey = Object.fromEntries(result.candidates.map((c) => [c.key, c]));
      assert.equal(byKey.activationCode?.value, "AT3X7M2P");
      assert.equal(byKey.serial?.validationOk, true);
      assert.equal(byKey.imei?.value, "490154203237518");
      assert.equal(byKey.imei?.validationOk, true);
    }
  });

  it("recovers activation on next line after noisy OBD label OCR", () => {
    const result = extractFromBarcodeAndOcr({
      profile: LINXUP_VEHICLE_TRACKER_LABEL_PROFILE,
      barcodePayloads: [],
      ocrText: `1HHNXU 28
OBD Activation Code - i
G6R-81Q —
SIN: 88X160090306 SAAR
IMEI: 868892080208581 N`,
      ocrConfidence: 51,
    });
    const byKey = Object.fromEntries(result.candidates.map((c) => [c.key, c]));
    assert.equal(byKey.activationCode?.value, "G6R-81Q");
    assert.equal(byKey.serial?.value, "88X160090306");
    assert.equal(byKey.imei?.value, "868892080208581");
  });

  it("LinxCam extracts MAC + serial and normalizes MAC display", () => {
    const result = extractFromBarcodeAndOcr({
      profile: LINXUP_LINXCAM_LABEL_PROFILE,
      barcodePayloads: [],
      ocrText: "MAC ADDRESS: aabbcc112233\nSERIAL NUMBER: LC-9F2A18C4",
      ocrConfidence: 80,
    });
    const mac = result.candidates.find((c) => c.key === "mac");
    assert.ok(mac);
    assert.equal(normalizeMacRaw(mac.rawValue), "AABBCC112233");
    assert.equal(mac.value, "AA:BB:CC:11:22:33");
    assert.equal(mac.validationOk, true);
  });

  it("LinxCam prefers barcode MAC/serial mapping", () => {
    const result = extractFromBarcodeAndOcr({
      profile: LINXUP_LINXCAM_LABEL_PROFILE,
      barcodePayloads: ["0018F5A950E0", "00D2083B69"],
      ocrText: "noise only",
      ocrConfidence: 40,
    });
    const mac = result.candidates.find((c) => c.key === "mac");
    const serial = result.candidates.find((c) => c.key === "serial");
    assert.equal(mac?.source, "barcode");
    assert.equal(normalizeMacRaw(mac!.value), "0018F5A950E0");
    assert.equal(serial?.value, "00D2083B69");
  });

  it("LinxCam ignores OCR MAC without keyword proximity", () => {
    const result = extractFromBarcodeAndOcr({
      profile: LINXUP_LINXCAM_LABEL_PROFILE,
      barcodePayloads: [],
      ocrText: "random 0018F5A950E0 blob",
      ocrConfidence: 40,
    });
    assert.equal(result.candidates.find((c) => c.key === "mac"), undefined);
  });

  it("rejects invalid IMEI and suggests corrections without auto-apply", () => {
    const suggestions = suggestCorrections({
      fieldKey: "imei",
      value: "4901542032375I8",
      validationOk: false,
    });
    assert.ok(suggestions.every((s) => s.autoApply === false));
  });
});
