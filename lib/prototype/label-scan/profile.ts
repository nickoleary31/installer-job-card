/**
 * Non-production LinxUp device-label extraction profiles.
 * Future: point FormDefinition.labelExtractionProfileId at these.
 */

export type LabelFieldKey = "activationCode" | "serial" | "imei" | "iccid" | "mac" | "deviceId";

export type LabelFieldRegion = {
  /** Relative crop band inside the label guide (0–1). */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LabelFieldRule = {
  key: LabelFieldKey;
  label: string;
  aliases: string[];
  pattern: RegExp;
  minLength?: number;
  maxLength?: number;
  charset?: RegExp;
  regionHint?: LabelFieldRegion;
  validate: (value: string) => { ok: boolean; reason?: string; normalized?: string };
  ambiguousChars?: string[];
  /** How to present in UI (raw kept separately). */
  displayNormalize?: (value: string) => string;
};

export type LabelExtractionProfile = {
  id: string;
  formId: string;
  /** Classifier / family id (same as formId for v1 families). */
  deviceFamily: "linxup_asset_tracker" | "linxup_vehicle_tracker" | "linxup_linxcam";
  productLabel: string;
  uiSelectLabel: string;
  expectedBarcodeFormats: Array<"QR_CODE" | "CODE_128" | "CODE_39" | "DATA_MATRIX" | "EAN_13">;
  /** Approximate barcode band on the physical label (relative to full frame). */
  barcodeRegionHint?: LabelFieldRegion;
  layoutNotes: string[];
  fields: LabelFieldRule[];
};

export function luhnOk(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Normalize MAC to 12 uppercase hex chars (no separators). */
export function normalizeMacRaw(value: string): string {
  return value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
}

export function formatMacColon(raw12: string): string {
  const r = normalizeMacRaw(raw12);
  if (r.length !== 12) return raw12;
  return r.match(/.{2}/g)!.join(":");
}

const AMBIG_DIGIT = ["O", "0", "I", "1", "B", "8", "S", "5", "G", "6"];

function validateImei(value: string) {
  const d = onlyDigits(value);
  if (d.length !== 15) return { ok: false, reason: "IMEI must be exactly 15 digits" };
  if (!luhnOk(d)) return { ok: false, reason: "IMEI failed Luhn check — do not auto-accept" };
  return { ok: true, normalized: d };
}

function validateSerial(value: string) {
  const v = value.trim().toUpperCase();
  if (v.length < 4 || v.length > 32) return { ok: false, reason: "Serial length out of range" };
  if (!/^[A-Z0-9][A-Z0-9\-]*$/.test(v)) return { ok: false, reason: "Unexpected serial characters" };
  if (/^\d{15}$/.test(v)) return { ok: false, reason: "Looks like IMEI, not serial" };
  if (/^89\d{17,18}$/.test(v)) return { ok: false, reason: "Looks like ICCID, not serial" };
  return { ok: true, normalized: v };
}

function validateActivation(value: string) {
  const v = value.trim().toUpperCase().replace(/\s+/g, "");
  if (v.length < 4 || v.length > 24) return { ok: false, reason: "Activation code length out of range" };
  if (!/^[A-Z0-9\-]+$/.test(v)) return { ok: false, reason: "Unexpected activation code characters" };
  if (/^\d{15}$/.test(v)) return { ok: false, reason: "Looks like IMEI, not activation code" };
  return { ok: true, normalized: v };
}

function validateMac(value: string) {
  const raw = normalizeMacRaw(value);
  if (raw.length !== 12) return { ok: false, reason: "MAC must normalize to 12 hex characters" };
  if (!/^[0-9A-F]{12}$/.test(raw)) return { ok: false, reason: "MAC contains non-hex characters" };
  return { ok: true, normalized: raw };
}

const sharedImeiRule = (): LabelFieldRule => ({
  key: "imei",
  label: "IMEI",
  aliases: ["IMEI", "IMEI1", "IMEI 1", "IMEI:"],
  pattern: /\b(\d{15})\b/,
  minLength: 15,
  maxLength: 15,
  charset: /^\d{15}$/,
  regionHint: { x: 0.05, y: 0.55, w: 0.9, h: 0.2 },
  ambiguousChars: AMBIG_DIGIT,
  validate: validateImei,
});

const sharedSerialRule = (region?: LabelFieldRegion, aliases?: string[]): LabelFieldRule => ({
  key: "serial",
  label: "Serial Number",
  aliases: aliases ?? ["S/N", "SIN", "SN:", "SN", "SERIAL", "SERIAL NUMBER", "SERIAL NO", "SERIAL#", "SER.", "SERIAL NUM"],
  pattern: /\b([A-Z0-9][A-Z0-9\-]{3,31})\b/i,
  minLength: 4,
  maxLength: 32,
  charset: /^[A-Z0-9\-]+$/i,
  regionHint: region ?? { x: 0.05, y: 0.35, w: 0.9, h: 0.2 },
  ambiguousChars: ["O", "0", "I", "1", "E", "6", "B", "8", "S", "5", "G"],
  validate: validateSerial,
});

const sharedActivationRule = (): LabelFieldRule => ({
  key: "activationCode",
  label: "Activation Code",
  aliases: [
    "OBD ACTIVATION CODE",
    "ACTIVATION CODE",
    "ACT CODE",
    "ACTIVATE",
    "ACT.",
    "ACTIVATION",
  ],
  pattern: /\b([A-Z0-9]{2,4}-[A-Z0-9]{2,4}|[A-Z0-9][A-Z0-9\-]{3,23})\b/i,
  minLength: 4,
  maxLength: 24,
  charset: /^[A-Z0-9\-]+$/i,
  regionHint: { x: 0.05, y: 0.15, w: 0.9, h: 0.2 },
  ambiguousChars: ["O", "0", "I", "1", "E", "6", "B", "8", "S", "5", "G"],
  validate: validateActivation,
});

const sharedMacRule = (): LabelFieldRule => ({
  key: "mac",
  label: "MAC Address",
  aliases: ["MAC", "MAC:", "MAC ADDRESS", "MAC ADDR", "MAC ", "Mac:"],
  pattern: /\b((?:[0-9A-F]{2}[:\-\s]?){5}[0-9A-F]{2}|[0-9A-F]{12})\b/i,
  minLength: 12,
  maxLength: 17,
  charset: /^[0-9A-F:.\-\s]+$/i,
  regionHint: { x: 0.05, y: 0.2, w: 0.9, h: 0.25 },
  ambiguousChars: ["O", "0", "I", "1", "B", "8", "S", "5", "G", "6"],
  validate: validateMac,
  displayNormalize: (v) => formatMacColon(normalizeMacRaw(v)),
});

/** AT3 / Asset Tracker: Activation Code, Serial, IMEI */
export const LINXUP_ASSET_TRACKER_LABEL_PROFILE: LabelExtractionProfile = {
  id: "linxup_asset_tracker_at3_v1",
  formId: "linxup_asset_tracker",
  deviceFamily: "linxup_asset_tracker",
  productLabel: "LinxUp Asset Tracker (AT3)",
  uiSelectLabel: "Asset Tracker",
  expectedBarcodeFormats: ["QR_CODE", "CODE_128", "CODE_39", "DATA_MATRIX"],
  barcodeRegionHint: { x: 0.55, y: 0.1, w: 0.4, h: 0.55 },
  layoutNotes: [
    "Typical AT3 sticker: Activation Code near top, Serial mid, IMEI lower.",
    "Often includes a QR/Code128 encoding one or more identifiers.",
  ],
  fields: [sharedActivationRule(), sharedSerialRule({ x: 0.05, y: 0.35, w: 0.9, h: 0.2 }), sharedImeiRule()],
};

/** Vehicle Tracker family (OBD-II + JBUS share this label). Variant chosen after confirm. */
export const LINXUP_VEHICLE_TRACKER_LABEL_PROFILE: LabelExtractionProfile = {
  id: "linxup_vehicle_tracker_label_v1",
  formId: "linxup_vehicle_tracker",
  deviceFamily: "linxup_vehicle_tracker",
  productLabel: "LinxUp Vehicle Tracker",
  uiSelectLabel: "Vehicle Tracker",
  expectedBarcodeFormats: ["QR_CODE", "CODE_128", "CODE_39", "DATA_MATRIX"],
  barcodeRegionHint: { x: 0.55, y: 0.1, w: 0.4, h: 0.55 },
  layoutNotes: [
    "OBD-II and JBUS use the same/substantially identical base tracker label.",
    "Classifier targets device family only — technician picks OBD-II vs JBUS after confirm.",
    "Barcode-first often recovers IMEI/serial when OCR confuses digits.",
  ],
  fields: [sharedActivationRule(), sharedSerialRule({ x: 0.05, y: 0.35, w: 0.9, h: 0.2 }), sharedImeiRule()],
};

/** Standard LinxCam: MAC + Serial */
export const LINXUP_LINXCAM_LABEL_PROFILE: LabelExtractionProfile = {
  id: "linxup_linxcam_label_v1",
  formId: "linxup_linxcam",
  deviceFamily: "linxup_linxcam",
  productLabel: "LinxCam (Standard)",
  uiSelectLabel: "LinxCam",
  expectedBarcodeFormats: ["QR_CODE", "CODE_128", "CODE_39", "DATA_MATRIX"],
  barcodeRegionHint: { x: 0.5, y: 0.15, w: 0.45, h: 0.5 },
  layoutNotes: [
    "LinxCam label emphasizes MAC Address and Serial Number.",
    "MAC may appear with or without colons; store raw 12-hex and display colon form.",
    "v1 = Standard LinxCam only.",
  ],
  fields: [
    sharedMacRule(),
    sharedSerialRule({ x: 0.05, y: 0.45, w: 0.9, h: 0.25 }, [
      "SERIAL NUM",
      "SERIAL NUMBER",
      "SERIAL",
      "S/N",
      "SN",
    ]),
  ],
};

export const PROTOTYPE_LABEL_PROFILES: LabelExtractionProfile[] = [
  LINXUP_ASSET_TRACKER_LABEL_PROFILE,
  LINXUP_VEHICLE_TRACKER_LABEL_PROFILE,
  LINXUP_LINXCAM_LABEL_PROFILE,
];

export function getPrototypeProfile(formId: string): LabelExtractionProfile {
  return PROTOTYPE_LABEL_PROFILES.find((p) => p.formId === formId) || LINXUP_ASSET_TRACKER_LABEL_PROFILE;
}

export function listPrototypeProfiles(): LabelExtractionProfile[] {
  return PROTOTYPE_LABEL_PROFILES;
}
