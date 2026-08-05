/**
 * Blaxtair AHD camera label — non-production OCR profile.
 * Ground truth: one approved sample label (see blaxtair-fixture.ts).
 * Extend this profile rather than inventing a second pipeline (see docs/OCR_Strategy.md).
 *
 * Not included in `PROTOTYPE_LABEL_PROFILES` / `listPrototypeProfiles()` by default —
 * callers that want Blaxtair in the classifier candidate set must pass it explicitly via
 * `classifyDeviceLabel({ profiles: [...] })`. This keeps the existing LinxUp-only
 * `/prototype/label-scan` page's behavior unchanged.
 */

import type { LabelExtractionProfile, LabelFieldRule } from "./profile.ts";

/** AHD Camera keyword — the label does not print the "Blaxtair" brand name itself. */
export const BLAXTAIR_AHD_KEYWORD_RE = /\bAHD\s*CAMERA\b/;
export const BLAXTAIR_AHD_TOKEN_RE = /\bAHD\b/;
export const BLAXTAIR_PART_NUMBER_RE = /\b(\d{3}-\d{3}-\d{3})\b/;
export const BLAXTAIR_IPV4_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;

/**
 * The current AHD Camera model's part number, confirmed against a real label 2026-08-02.
 * The physical sticker print is off-center and consistently clips the final digit, so OCR
 * reads "210-110-0" / "210-110-00" instead of "210-110-001". This is a deliberate, narrow,
 * temporary assumption — remove or update it if a new camera model with a different part
 * number enters service. Never silently applied: see inferTruncatedBlaxtairPartNumber, which
 * only ever produces a suggestion the technician must still confirm.
 */
export const BLAXTAIR_AHD_CAMERA_KNOWN_PART_NUMBER = "210-110-001";

const TRUNCATED_PART_NUMBER_RE = /\b210-110-0{1,2}\b/;

/**
 * Propose the known part number when OCR/barcode text shows the truncated print pattern.
 * Returns null when the text doesn't contain that specific truncation (including when a
 * complete, different part number was already read — that's never overridden).
 */
export function inferTruncatedBlaxtairPartNumber(rawText: string): string | null {
  return TRUNCATED_PART_NUMBER_RE.test(rawText) ? BLAXTAIR_AHD_CAMERA_KNOWN_PART_NUMBER : null;
}

function isValidIpv4(value: string): boolean {
  const parts = value.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    // Reject leading-zero multi-digit octets (e.g. "089") — ambiguous OCR, not a real octet.
    if (p.length > 1 && p.startsWith("0")) return false;
    return n >= 0 && n <= 255;
  });
}

export function validateBlaxtairIpv4(raw: string): { ok: boolean; reason?: string; normalized?: string } {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "IP address is required" };
  if (!isValidIpv4(value)) return { ok: false, reason: "Not a valid IPv4 address" };
  return { ok: true };
}

export function validateBlaxtairPartNumber(raw: string): { ok: boolean; reason?: string } {
  const value = raw.trim();
  if (!BLAXTAIR_PART_NUMBER_RE.test(value) || !new RegExp(`^${BLAXTAIR_PART_NUMBER_RE.source}$`).test(value)) {
    return { ok: false, reason: "Expected NNN-NNN-NNN part-number format" };
  }
  return { ok: true };
}

/** Blaxtair serials observed so far are numeric. Never rewrite the digits — validate shape only. */
export function validateBlaxtairSerial(raw: string): { ok: boolean; reason?: string } {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return { ok: false, reason: "Expected a numeric serial" };
  if (value.length < 5 || value.length > 12) return { ok: false, reason: "Serial length out of range" };
  if (value.length === 15) return { ok: false, reason: "Looks like IMEI, not a Blaxtair serial" };
  return { ok: true };
}

const partNumberRule: LabelFieldRule = {
  key: "partNumber",
  label: "Part Number",
  aliases: ["P/N", "PN:", "PN", "PART NUMBER", "PART NO", "PART#", "PART NO."],
  pattern: BLAXTAIR_PART_NUMBER_RE,
  minLength: 11,
  maxLength: 11,
  charset: /^\d{3}-\d{3}-\d{3}$/,
  regionHint: { x: 0.05, y: 0.35, w: 0.9, h: 0.2 },
  validate: validateBlaxtairPartNumber,
};

const serialRule: LabelFieldRule = {
  key: "serial",
  label: "Serial Number",
  aliases: ["S/N", "SN:", "SN", "SERIAL", "SERIAL NUMBER", "SERIAL NO", "SERIAL#"],
  pattern: /\b(\d{5,12})\b/,
  minLength: 5,
  maxLength: 12,
  charset: /^\d+$/,
  regionHint: { x: 0.05, y: 0.5, w: 0.9, h: 0.2 },
  ambiguousChars: ["O", "0", "I", "1", "B", "8", "S", "5"],
  validate: validateBlaxtairSerial,
};

const ipAddressRule: LabelFieldRule = {
  key: "ipAddress",
  label: "IP Address",
  aliases: ["IP ADDRESS", "IP ADDR", "IP:", "IP", "IPV4"],
  pattern: BLAXTAIR_IPV4_RE,
  minLength: 7,
  maxLength: 15,
  charset: /^[\d.]+$/,
  regionHint: { x: 0.05, y: 0.65, w: 0.9, h: 0.2 },
  validate: validateBlaxtairIpv4,
};

/** blaxtair_ahd_camera_label_v1 — matches HARDWARE_PROFILES.blaxtair_ahd_camera_label in lib/product-devices. */
export const BLAXTAIR_AHD_CAMERA_LABEL_PROFILE: LabelExtractionProfile = {
  id: "blaxtair_ahd_camera_label_v1",
  formId: "blaxtair_ahd_camera",
  deviceFamily: "blaxtair_ahd_camera",
  productLabel: "Blaxtair AHD Camera",
  uiSelectLabel: "Blaxtair AHD Camera",
  expectedBarcodeFormats: ["QR_CODE", "DATA_MATRIX", "CODE_128"],
  barcodeRegionHint: { x: 0.55, y: 0.1, w: 0.4, h: 0.55 },
  layoutNotes: [
    "Label prints 'AHD Camera', part number (NNN-NNN-NNN), serial number (numeric), IP address, and a 2D code.",
    "Label does not print the word 'Blaxtair' itself — classify on 'AHD Camera' wording plus part/IP structure.",
    "Only one approved ground-truth sample exists — extend this profile rather than inventing a second pipeline as more samples arrive.",
  ],
  fields: [partNumberRule, serialRule, ipAddressRule],
};
