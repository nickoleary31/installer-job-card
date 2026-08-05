/**
 * Blaxtair AHD camera OCR profile — classifier + extraction unit tests.
 * Uses the approved synthetic ground-truth sample (blaxtair-fixture.ts).
 *
 * Note: PPD (Product Files JSON config) has no device-label OCR profile in this module,
 * so "unrelated labels" below are exercised against AT3 / Vehicle Tracker / LinxCam —
 * the label-scan families that do exist.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLAXTAIR_AHD_CAMERA_KNOWN_PART_NUMBER,
  BLAXTAIR_AHD_CAMERA_LABEL_PROFILE,
  inferTruncatedBlaxtairPartNumber,
  validateBlaxtairIpv4,
  validateBlaxtairPartNumber,
  validateBlaxtairSerial,
} from "./blaxtair-profile.ts";
import { BLAXTAIR_CAMERA_GROUND_TRUTH } from "./blaxtair-fixture.ts";
import { classifyDeviceLabel } from "./classify.ts";
import { extractFromBarcodeAndOcr } from "./extract.ts";
import { listPrototypeProfiles } from "./profile.ts";

const ALL_PROFILES = [...listPrototypeProfiles(), BLAXTAIR_AHD_CAMERA_LABEL_PROFILE];

describe("Blaxtair AHD camera classification", () => {
  it("classifies the approved sample as Blaxtair AHD Camera (high confidence)", () => {
    const result = classifyDeviceLabel({
      ocrText: BLAXTAIR_CAMERA_GROUND_TRUTH.ocrText,
      barcodePayloads: BLAXTAIR_CAMERA_GROUND_TRUTH.barcodePayloads,
      profiles: ALL_PROFILES,
    });
    assert.equal(result.top?.profile.formId, "blaxtair_ahd_camera");
    assert.equal(result.band, "high");
    assert.equal(result.canPreselect, true);
  });

  it("extracts exact part number 210-110-001", () => {
    const result = extractFromBarcodeAndOcr({
      profile: BLAXTAIR_AHD_CAMERA_LABEL_PROFILE,
      barcodePayloads: [],
      ocrText: BLAXTAIR_CAMERA_GROUND_TRUTH.ocrText,
      ocrConfidence: 85,
    });
    const partNumber = result.candidates.find((c) => c.key === "partNumber");
    assert.equal(partNumber?.value, "210-110-001");
    assert.equal(partNumber?.validationOk, true);
  });

  it("extracts exact serial number 26062215", () => {
    const result = extractFromBarcodeAndOcr({
      profile: BLAXTAIR_AHD_CAMERA_LABEL_PROFILE,
      barcodePayloads: [],
      ocrText: BLAXTAIR_CAMERA_GROUND_TRUTH.ocrText,
      ocrConfidence: 85,
    });
    const serial = result.candidates.find((c) => c.key === "serial");
    assert.equal(serial?.value, "26062215");
    assert.equal(serial?.validationOk, true);
  });

  it("extracts and validates IPv4 192.168.89.250", () => {
    const result = extractFromBarcodeAndOcr({
      profile: BLAXTAIR_AHD_CAMERA_LABEL_PROFILE,
      barcodePayloads: [],
      ocrText: BLAXTAIR_CAMERA_GROUND_TRUTH.ocrText,
      ocrConfidence: 85,
    });
    const ip = result.candidates.find((c) => c.key === "ipAddress");
    assert.equal(ip?.value, "192.168.89.250");
    assert.equal(ip?.validationOk, true);
  });

  it("rejects malformed IPv4 values", () => {
    assert.equal(validateBlaxtairIpv4("192.168.1").ok, false);
    assert.equal(validateBlaxtairIpv4("999.168.1.1").ok, false);
    assert.equal(validateBlaxtairIpv4("192.168.089.250").ok, false);
    assert.equal(validateBlaxtairIpv4("192.168.89.250").ok, true);
  });

  it("rejects part numbers not matching NNN-NNN-NNN", () => {
    assert.equal(validateBlaxtairPartNumber("210-110-001").ok, true);
    assert.equal(validateBlaxtairPartNumber("210110001").ok, false);
    assert.equal(validateBlaxtairPartNumber("AB-110-001").ok, false);
  });

  it("does not silently correct the serial — validates shape only", () => {
    assert.equal(validateBlaxtairSerial("26062215").ok, true);
    assert.equal(validateBlaxtairSerial("490154203237518").ok, false); // 15-digit, IMEI-shaped
    assert.equal(validateBlaxtairSerial("abc123").ok, false);
  });

  it("does not infer identifiers the label does not contain", () => {
    const result = extractFromBarcodeAndOcr({
      profile: BLAXTAIR_AHD_CAMERA_LABEL_PROFILE,
      barcodePayloads: [],
      ocrText: "AHD Camera\nP/N: 210-110-001",
      ocrConfidence: 85,
    });
    assert.equal(result.candidates.find((c) => c.key === "serial"), undefined);
    assert.equal(result.candidates.find((c) => c.key === "ipAddress"), undefined);
  });

  it("prefers a valid short numeric serial over a longer invalid alias-adjacent fragment", () => {
    // Regression: a real-photo OCR pass produced a clean "26062215" line plus a garbled
    // "Serial Number: l 192.168.89.250" region-crop fragment (wrong field bled into the
    // region hint). The long invalid fragment must never outscore the valid short serial.
    const result = extractFromBarcodeAndOcr({
      profile: BLAXTAIR_AHD_CAMERA_LABEL_PROFILE,
      barcodePayloads: [],
      ocrText: [
        "AHD Camera",
        "210-110-00",
        "26062215",
        "192.168.8925",
        "Serial Number: l 192.168.89.250",
      ].join("\n"),
      ocrConfidence: 30,
    });
    const serial = result.candidates.find((c) => c.key === "serial");
    assert.equal(serial?.value, "26062215");
    assert.equal(serial?.validationOk, true);
  });

  it("AT3 label does not classify as Blaxtair", () => {
    const result = classifyDeviceLabel({
      ocrText: `Activation Code:\nEE1-RVY\nS/N: 68W661200312\nIMEI: 868892081011521`,
      barcodePayloads: [],
      profiles: ALL_PROFILES,
    });
    assert.notEqual(result.top?.profile.formId, "blaxtair_ahd_camera");
  });

  it("Vehicle Tracker label does not classify as Blaxtair", () => {
    const result = classifyDeviceLabel({
      ocrText: `OBD Activation Code\nG6R-81Q\nS/N: 88X160090306\nIMEI: 868892080208581`,
      barcodePayloads: [],
      profiles: ALL_PROFILES,
    });
    assert.notEqual(result.top?.profile.formId, "blaxtair_ahd_camera");
  });

  it("LinxCam label does not classify as Blaxtair", () => {
    const result = classifyDeviceLabel({
      ocrText: `LinxCam\nMAC Address\n0018F5A950E0\nSERIAL NUM\n00D2083B69\nMade in Vietnam`,
      barcodePayloads: ["0018F5A950E0"],
      profiles: ALL_PROFILES,
    });
    assert.notEqual(result.top?.profile.formId, "blaxtair_ahd_camera");
  });

  it("Blaxtair sample does not classify as a LinxUp family", () => {
    const result = classifyDeviceLabel({
      ocrText: BLAXTAIR_CAMERA_GROUND_TRUTH.ocrText,
      barcodePayloads: [],
      profiles: ALL_PROFILES,
    });
    assert.equal(result.top?.profile.formId, "blaxtair_ahd_camera");
  });

  it("low-confidence blurry text requires manual choice, never silently selects", () => {
    const result = classifyDeviceLabel({
      ocrText: "blurry noise 12 34",
      barcodePayloads: [],
      profiles: ALL_PROFILES,
    });
    assert.equal(result.band, "low");
    assert.equal(result.requireManualChoice, true);
    assert.equal(result.canPreselect, false);
  });

  it("a lone IP-shaped token without AHD keyword or other structure stays out of high band", () => {
    const result = classifyDeviceLabel({
      ocrText: "random noise 192.168.89.250 more noise",
      barcodePayloads: [],
      profiles: ALL_PROFILES,
    });
    if (result.top?.profile.formId === "blaxtair_ahd_camera") {
      assert.notEqual(result.band, "high");
    }
  });
});

describe("inferTruncatedBlaxtairPartNumber", () => {
  it("proposes the known part number when the print is truncated to 2 digits", () => {
    assert.equal(
      inferTruncatedBlaxtairPartNumber("AHD Camera\n210-110-00\n26062215"),
      BLAXTAIR_AHD_CAMERA_KNOWN_PART_NUMBER,
    );
  });

  it("proposes the known part number when the print is truncated to 1 digit", () => {
    assert.equal(inferTruncatedBlaxtairPartNumber("210-110-0"), BLAXTAIR_AHD_CAMERA_KNOWN_PART_NUMBER);
  });

  it("does not propose anything when there is no truncation pattern at all", () => {
    assert.equal(inferTruncatedBlaxtairPartNumber("AHD Camera\n26062215\n192.168.89.250"), null);
  });

  it("does not override a different, fully-read part number (future model safety)", () => {
    // A complete 3-digit read never matches the truncation pattern, so a genuinely
    // different future-model part number is never overwritten by this assumption.
    assert.equal(inferTruncatedBlaxtairPartNumber("210-110-002"), null);
  });
});
