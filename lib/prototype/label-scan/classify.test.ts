/**
 * Classifier unit tests using OCR snippets representative of the three sample labels.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDeviceLabel } from "./classify.ts";

describe("classifyDeviceLabel", () => {
  it("scores OBD Activation as Vehicle Tracker (high)", () => {
    const result = classifyDeviceLabel({
      ocrText: `OBD Activation Code
G6R-81Q
S/N: 88X160090306
IMEI: 868892080208581`,
      barcodePayloads: [],
    });
    assert.equal(result.top?.profile.formId, "linxup_vehicle_tracker");
    assert.equal(result.band, "high");
    assert.equal(result.canPreselect, true);
    assert.ok((result.top?.confidence || 0) >= 72);
  });

  it("scores Activation Code without OBD as Asset Tracker (high)", () => {
    const result = classifyDeviceLabel({
      ocrText: `Activation Code:
EE1-RVY
S/N: 68W661200312
IMEI: 868892081011521`,
      barcodePayloads: [],
    });
    assert.equal(result.top?.profile.formId, "linxup_asset_tracker");
    assert.equal(result.band, "high");
    assert.ok(result.top!.score > result.ranked[1]!.score);
  });

  it("scores MAC + Serial Num as LinxCam", () => {
    const result = classifyDeviceLabel({
      ocrText: `LinxCam
MAC Address
0018F5A950E0
SERIAL NUM
00D2083B69
Made in Vietnam`,
      barcodePayloads: ["0018F5A950E0"],
    });
    assert.equal(result.top?.profile.formId, "linxup_linxcam");
    assert.ok(result.band === "high" || result.band === "medium");
    assert.ok(result.ranked[0]!.score > result.ranked[1]!.score);
  });

  it("does not high-band LinxCam from a random MAC-shaped token alone", () => {
    const result = classifyDeviceLabel({
      ocrText: "blur noise 0018F5A950E0 more noise",
      barcodePayloads: [],
    });
    if (result.top?.profile.formId === "linxup_linxcam") {
      assert.notEqual(result.band, "high");
      assert.ok((result.top?.confidence || 0) < 72);
    }
  });

  it("keeps Vehicle Tracker as family only (no OBD/JBUS in classifier)", () => {
    const result = classifyDeviceLabel({
      ocrText: `OBD Activation Code
G6R-81Q
S/N: 88X160090306
IMEI: 868892080208581`,
      barcodePayloads: [],
    });
    assert.equal(result.top?.profile.formId, "linxup_vehicle_tracker");
    assert.equal(result.top?.profile.deviceFamily, "linxup_vehicle_tracker");
  });

  it("does not silently preselect when evidence is weak", () => {
    const result = classifyDeviceLabel({
      ocrText: "blurry noise xyz 123",
      barcodePayloads: [],
    });
    assert.equal(result.band, "low");
    assert.equal(result.requireManualChoice, true);
    assert.equal(result.canPreselect, false);
  });
});
