/**
 * Identifier validation and normalization.
 * Serial values are never silently altered — only validated.
 * MAC may strip separators and uppercase for storage display.
 * IMEI uses length + Luhn when digits-only.
 */

import type { DeviceIdentifierKey, DeviceIdentifiers, IdentifierEdit } from "./types.ts";

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

export type IdentifierValidation = {
  ok: boolean;
  reason?: string;
  /** Present only when a safe display/storage normalize is allowed (never for serial). */
  normalized?: string;
};

/** Serial: validate shape only — never rewrite the technician/OCR string. */
export function validateSerialNumber(raw: string): IdentifierValidation {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "Serial is required" };
  if (value.length < 4) return { ok: false, reason: "Serial looks too short" };
  if (value.length > 64) return { ok: false, reason: "Serial looks too long" };
  return { ok: true };
}

export function validateActivationCode(raw: string): IdentifierValidation {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "Activation code is required" };
  if (value.length < 4) return { ok: false, reason: "Activation code looks too short" };
  return { ok: true };
}

export function validateImei(raw: string): IdentifierValidation {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 15) return { ok: false, reason: "IMEI must be 15 digits" };
  if (!luhnOk(digits)) return { ok: false, reason: "IMEI failed Luhn check" };
  return { ok: true, normalized: digits };
}

/** MAC: separators may be removed and letters uppercased — the only silent normalize. */
export function normalizeMacAddress(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

export function validateMacAddress(raw: string): IdentifierValidation {
  const normalized = normalizeMacAddress(raw);
  if (normalized.length !== 12) {
    return { ok: false, reason: "MAC must be 12 hex characters" };
  }
  return { ok: true, normalized };
}

export function validateIdentifier(
  key: DeviceIdentifierKey,
  raw: string,
): IdentifierValidation {
  switch (key) {
    case "serialNumber":
      return validateSerialNumber(raw);
    case "activationCode":
      return validateActivationCode(raw);
    case "imei":
      return validateImei(raw);
    case "macAddress":
      return validateMacAddress(raw);
    case "iccid":
    case "deviceId":
    case "firmwareVersion":
    case "partNumber":
      return raw.trim() ? { ok: true } : { ok: false, reason: "Value is required" };
    case "ipAddress":
      return validateIpAddress(raw);
    default:
      return { ok: true };
  }
}

export function validateIpAddress(raw: string): IdentifierValidation {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "IP address is required" };
  // IPv4 loose check — do not rewrite the technician string beyond trim.
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return { ok: false, reason: "IP address looks invalid" };
  }
  return { ok: true };
}

/**
 * Apply a technician edit. Serial is stored exactly as provided (trimmed only).
 * MAC may normalize separators/case. Never invent corrections.
 */
export function applyIdentifierEdit(args: {
  identifiers: DeviceIdentifiers;
  key: DeviceIdentifierKey;
  nextRaw: string;
  edits: IdentifierEdit[];
  nowIso?: string;
}): { identifiers: DeviceIdentifiers; edits: IdentifierEdit[] } {
  const prev = args.identifiers[args.key] ?? "";
  let next = args.nextRaw.trim();
  if (args.key === "macAddress") {
    const v = validateMacAddress(next);
    if (v.normalized) next = v.normalized;
  } else if (args.key === "imei") {
    // Keep technician typing; do not force digit strip into the stored serial-like field
    // unless validation's normalized digits are explicitly accepted by caller.
    // Store trimmed raw; validation is separate.
    next = args.nextRaw.trim();
  } else if (args.key === "serialNumber") {
    next = args.nextRaw.trim(); // never rewrite characters
  }

  const edit: IdentifierEdit = {
    key: args.key,
    fromValue: prev,
    toValue: next,
    editedAt: args.nowIso ?? new Date().toISOString(),
    source: "technician",
  };

  return {
    identifiers: { ...args.identifiers, [args.key]: next },
    edits: [...args.edits, edit],
  };
}

/** Map prototype / OCR label keys → durable identifier keys. */
export function mapPrototypeFieldsToIdentifiers(
  fields: Partial<
    Record<
      | "activationCode"
      | "serial"
      | "imei"
      | "mac"
      | "iccid"
      | "deviceId"
      | "partNumber"
      | "ipAddress",
      string
    >
  >,
): DeviceIdentifiers {
  const out: DeviceIdentifiers = {};
  if (fields.activationCode?.trim()) out.activationCode = fields.activationCode.trim();
  if (fields.serial?.trim()) out.serialNumber = fields.serial.trim(); // no rewrite
  if (fields.imei?.trim()) out.imei = fields.imei.trim();
  if (fields.mac?.trim()) {
    const v = validateMacAddress(fields.mac);
    out.macAddress = v.normalized ?? fields.mac.trim();
  }
  if (fields.iccid?.trim()) out.iccid = fields.iccid.trim();
  if (fields.deviceId?.trim()) out.deviceId = fields.deviceId.trim();
  if (fields.partNumber?.trim()) out.partNumber = fields.partNumber.trim();
  if (fields.ipAddress?.trim()) out.ipAddress = fields.ipAddress.trim();
  return out;
}
