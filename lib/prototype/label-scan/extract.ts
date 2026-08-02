/**
 * Parse barcode payloads + OCR text into candidate field values for a label profile.
 */

import { suggestCorrections, type CorrectionSuggestion } from "./corrections.ts";
import type { LabelExtractionProfile, LabelFieldKey } from "./profile.ts";

export type FieldCandidate = {
  key: LabelFieldKey;
  /** Value proposed to the technician (may be display-normalized for MAC). */
  value: string;
  /** Unmodified matched token before display normalization. */
  rawValue: string;
  source: "barcode" | "ocr" | "manual";
  confidence: number; // 0–100
  validationOk: boolean;
  validationReason?: string;
  ambiguous: boolean;
  rawEvidence?: string;
  /** Suggested fixes — never auto-applied. */
  correctionSuggestions: CorrectionSuggestion[];
};

export type ExtractionResult = {
  rawOcrText: string;
  barcodePayloads: string[];
  candidates: FieldCandidate[];
  warnings: string[];
};

function normalizeToken(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function hasAmbiguousChars(value: string, chars?: string[]): boolean {
  if (!chars?.length) return false;
  const upper = value.toUpperCase();
  return chars.some((c) => upper.includes(c.toUpperCase()));
}

function linesFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

const LABEL_NOISE = new Set([
  "CODE",
  "ACTIVATION",
  "OBD",
  "SERIAL",
  "NUMBER",
  "NUM",
  "IMEI",
  "MAC",
  "ADDRESS",
  "ADDR",
  "S",
  "N",
  "SN",
  "SIN",
]);

function isNoiseToken(value: string): boolean {
  const v = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return !v || LABEL_NOISE.has(v) || v.length < 4;
}

function valueAfterAlias(line: string, aliases: string[]): string | null {
  const upper = line.toUpperCase();
  // Longer aliases first so "ACTIVATION CODE" wins over "ACTIVATION"
  const ordered = [...aliases].sort((a, b) => b.length - a.length);
  for (const alias of ordered) {
    const idx = upper.indexOf(alias.toUpperCase());
    if (idx < 0) continue;
    const after = line.slice(idx + alias.length).replace(/^[\s:=\-]+/, "").trim();
    if (after) return after;
  }
  return null;
}

function candidateQuality(
  fieldKey: LabelFieldKey,
  value: string,
  validationOk: boolean,
  aliasHit: boolean,
): number {
  let q = (validationOk ? 40 : 0) + (aliasHit ? 20 : 0) + Math.min(value.length, 20);
  if (fieldKey === "activationCode" && /^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/i.test(value)) q += 25;
  if (fieldKey === "serial" && value.length >= 10) q += 15;
  if (fieldKey === "serial" && value.length < 8) q -= 10;
  if (fieldKey === "imei" && /^\d{15}$/.test(value.replace(/\D/g, ""))) q += 20;
  if (fieldKey === "mac" && value.replace(/[^0-9A-Fa-f]/g, "").length === 12) q += 20;
  return q;
}

/** Prefer alias-labeled lines; fall back to global pattern scan. */
function extractForField(
  profile: LabelExtractionProfile,
  fieldKey: LabelFieldKey,
  text: string,
  source: "barcode" | "ocr",
  baseConfidence: number,
): FieldCandidate | null {
  const rule = profile.fields.find((f) => f.key === fieldKey);
  if (!rule) return null;

  const lines = linesFromText(text);
  type Hit = { value: string; evidence: string; confidence: number; aliasHit: boolean };
  const hits: Hit[] = [];

  const pushHit = (value: string, evidence: string, aliasHit: boolean, bonus = 0) => {
    const cleaned = normalizeToken(value).replace(/[^\w:.\-]/g, "");
    if (!cleaned || isNoiseToken(cleaned)) return;
    hits.push({
      value: cleaned,
      evidence,
      confidence: Math.min(99, baseConfidence + (aliasHit ? 14 : 0) + bonus),
      aliasHit,
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const upper = line.toUpperCase();
    const aliasHit = rule.aliases.some((a) => upper.includes(a.toUpperCase()));

    if (aliasHit) {
      const after = valueAfterAlias(line, rule.aliases);
      if (after) {
        const m = after.match(rule.pattern) || after.match(/^([A-Z0-9:.\-\s]{4,32})/i);
        if (m?.[1]) pushHit(m[1], line, true);
        else pushHit(after.split(/\s{2,}|\s\|\s/)[0] || after, line, true);
      }
      // Value often sits on the next OCR line after a noisy label
      const next = lines[i + 1];
      if (next) {
        const mNext = next.match(rule.pattern);
        if (mNext?.[1]) pushHit(mNext[1], `${line} → ${next}`, true, 8);
      }
    }

    const match = line.match(rule.pattern);
    if (match?.[1]) pushHit(match[1], line, aliasHit);
  }

  // Activation: prefer explicit XXXX-XXXX tokens anywhere in text
  if (fieldKey === "activationCode") {
    for (const m of text.matchAll(/\b([A-Z0-9]{2,4}-[A-Z0-9]{2,4})\b/gi)) {
      pushHit(m[1], m[0], true, 12);
    }
  }

  if (!hits.length) {
    const match = text.match(rule.pattern);
    if (match?.[1]) pushHit(match[1], text.slice(0, 160), false, -8);
  }

  if (!hits.length) return null;

  let best: Hit | null = null;
  let bestQ = -1;
  for (const hit of hits) {
    const validation = rule.validate(hit.value);
    const q = candidateQuality(fieldKey, hit.value, validation.ok, hit.aliasHit) + hit.confidence / 10;
    if (q > bestQ) {
      bestQ = q;
      best = hit;
    }
  }
  if (!best) return null;

  const rawValue = best.value;
  const validation = rule.validate(rawValue);
  const normalized = validation.normalized || rawValue;
  const displayValue = rule.displayNormalize ? rule.displayNormalize(normalized) : normalized;
  const ambiguous = hasAmbiguousChars(rawValue, rule.ambiguousChars);
  const correctionSuggestions = suggestCorrections({
    fieldKey,
    value: rawValue,
    validationOk: validation.ok,
  });

  return {
    key: fieldKey,
    value: displayValue,
    rawValue,
    source,
    confidence: validation.ok ? best.confidence : Math.min(best.confidence, 55),
    validationOk: validation.ok,
    validationReason: validation.reason,
    ambiguous,
    rawEvidence: best.evidence,
    correctionSuggestions,
  };
}

export function extractFromBarcodeAndOcr(args: {
  profile: LabelExtractionProfile;
  barcodePayloads: string[];
  ocrText: string;
  ocrConfidence?: number;
}): ExtractionResult {
  const warnings: string[] = [];
  const barcodeJoined = args.barcodePayloads.join("\n");
  const ocrText = args.ocrText || "";
  const ocrBase = typeof args.ocrConfidence === "number" ? Math.round(args.ocrConfidence) : 70;
  const isLinxCam = args.profile.formId === "linxup_linxcam";

  const byKey = new Map<LabelFieldKey, FieldCandidate>();

  const consider = (c: FieldCandidate | null) => {
    if (!c) return;
    // LinxCam: reject OCR MAC/serial without keyword proximity unless source is barcode
    if (isLinxCam && c.source === "ocr" && (c.key === "mac" || c.key === "serial")) {
      const nearKeyword =
        c.key === "mac"
          ? /\bMAC\b/i.test(c.rawEvidence || "")
          : /SERIAL\s*NUM|SERIAL\s*NUMBER|\bSERIAL\b/i.test(c.rawEvidence || "");
      if (!nearKeyword) {
        warnings.push(`Ignored OCR ${c.key} without MAC/SERIAL keyword proximity: ${c.rawValue}`);
        return;
      }
    }
    const existing = byKey.get(c.key);
    if (!existing) {
      byKey.set(c.key, c);
      return;
    }
    const score = (x: FieldCandidate) => {
      let s = (x.source === "barcode" ? 30 : 0) + x.confidence + (x.validationOk ? 15 : 0) + (x.ambiguous ? -5 : 0);
      // Short numeric barcode noise must not override OCR activation/serial on trackers
      if (
        x.source === "barcode" &&
        (x.key === "activationCode" || x.key === "serial") &&
        /^\d{3,8}$/.test(x.rawValue.replace(/\D/g, ""))
      ) {
        s -= 60;
      }
      // Activation from barcode should look like XXX-XXX when hyphenated form is expected
      if (x.key === "activationCode" && x.source === "barcode" && !/[A-Z].*-.*[A-Z0-9]/i.test(x.rawValue) && x.rawValue.length < 8) {
        s -= 40;
      }
      return s;
    };
    if (score(c) > score(existing)) byKey.set(c.key, c);
  };

  // LinxCam: map barcode payloads by shape first (12 hex → MAC, 10 hex → serial)
  if (isLinxCam) {
    for (const payload of args.barcodePayloads) {
      const hex = payload.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
      if (hex.length === 12) {
        const rule = args.profile.fields.find((f) => f.key === "mac");
        if (rule) {
          const validation = rule.validate(hex);
          const displayValue = rule.displayNormalize ? rule.displayNormalize(validation.normalized || hex) : hex;
          consider({
            key: "mac",
            value: displayValue,
            rawValue: hex,
            source: "barcode",
            confidence: 96,
            validationOk: validation.ok,
            validationReason: validation.reason,
            ambiguous: false,
            rawEvidence: `barcode:${payload}`,
            correctionSuggestions: suggestCorrections({ fieldKey: "mac", value: hex, validationOk: validation.ok }),
          });
        }
      } else if (/^[0-9A-F]{10}$/i.test(hex)) {
        const rule = args.profile.fields.find((f) => f.key === "serial");
        if (rule) {
          const validation = rule.validate(hex);
          consider({
            key: "serial",
            value: validation.normalized || hex,
            rawValue: hex,
            source: "barcode",
            confidence: 94,
            validationOk: validation.ok,
            validationReason: validation.reason,
            ambiguous: false,
            rawEvidence: `barcode:${payload}`,
            correctionSuggestions: suggestCorrections({ fieldKey: "serial", value: hex, validationOk: validation.ok }),
          });
        }
      }
    }
  }

  for (const field of args.profile.fields) {
    // LinxCam: skip generic barcode text scrape — only shaped payloads above
    if (!(isLinxCam && args.barcodePayloads.length)) {
      consider(extractForField(args.profile, field.key, barcodeJoined, "barcode", 92));
    } else if (isLinxCam) {
      // still allow shaped payloads already considered; also try OCR
    }
    consider(extractForField(args.profile, field.key, ocrText, "ocr", ocrBase));
  }

  if (!args.barcodePayloads.length) {
    warnings.push("No barcode/QR decoded — OCR-only path.");
  }
  if (!ocrText.trim()) {
    warnings.push("OCR returned no text.");
  }

  return {
    rawOcrText: ocrText,
    barcodePayloads: args.barcodePayloads,
    candidates: [...byKey.values()],
    warnings,
  };
}
