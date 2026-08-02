/**
 * Score known LinxUp label profiles from OCR/barcode evidence.
 * Never silently routes on weak scores — UI must confirm / override / retake.
 */

import { extractFromBarcodeAndOcr } from "./extract.ts";
import {
  listPrototypeProfiles,
  normalizeMacRaw,
  onlyDigits,
  type LabelExtractionProfile,
} from "./profile.ts";

export type ClassificationBand = "high" | "medium" | "low";

export type ClassificationEvidence = {
  kind: string;
  detail: string;
  weight: number;
};

export type ProfileScore = {
  profile: LabelExtractionProfile;
  score: number;
  confidence: number;
  evidence: ClassificationEvidence[];
};

export type ClassificationResult = {
  ranked: ProfileScore[];
  top: ProfileScore | null;
  band: ClassificationBand;
  /** Safe to preselect top profile (still requires technician confirm). */
  canPreselect: boolean;
  requireManualChoice: boolean;
  notes: string[];
};

function bandFor(confidence: number): ClassificationBand {
  if (confidence >= 72) return "high";
  if (confidence >= 45) return "medium";
  return "low";
}

function pushEvidence(list: ClassificationEvidence[], kind: string, detail: string, weight: number) {
  if (!weight) return;
  list.push({ kind, detail, weight });
}

function scoreProfile(args: {
  profile: LabelExtractionProfile;
  ocrText: string;
  barcodePayloads: string[];
}): ProfileScore {
  const text = `${args.ocrText}\n${args.barcodePayloads.join("\n")}`;
  const upper = text.toUpperCase();
  const evidence: ClassificationEvidence[] = [];
  let score = 0;

  const keywordHits: Array<{ re: RegExp; label: string; weight: number }> =
    args.profile.formId === "linxup_vehicle_tracker"
      ? [
          { re: /OBD\s*ACTIVATION/, label: "OBD Activation keyword", weight: 35 },
          { re: /\bOBD\b/, label: "OBD token", weight: 18 },
          { re: /ACTIVATION\s*CODE/, label: "Activation Code", weight: 8 },
          { re: /\bIMEI\b/, label: "IMEI field", weight: 12 },
          { re: /\bS\/N\b|\bSERIAL\b/, label: "Serial field", weight: 8 },
        ]
      : args.profile.formId === "linxup_asset_tracker"
        ? [
            { re: /ACTIVATION\s*CODE/, label: "Activation Code", weight: 18 },
            { re: /\bAT3\b|\bASSET\s*TRACKER\b/, label: "AT3/Asset Tracker token", weight: 16 },
            { re: /\bIMEI\b/, label: "IMEI field", weight: 12 },
            { re: /\bS\/N\b|\bSERIAL\b/, label: "Serial field", weight: 8 },
            // Penalize OBD-specific wording later via negative evidence
          ]
        : [
            { re: /\bMAC\b/, label: "MAC field", weight: 28 },
            { re: /SERIAL\s*NUM/, label: "Serial Num label", weight: 16 },
            { re: /\bLINXCAM\b|\bLINX\s*CAM\b/, label: "LinxCam token", weight: 20 },
            { re: /MADE IN VIETNAM/, label: "Made in Vietnam", weight: 6 },
          ];

  for (const hit of keywordHits) {
    if (hit.re.test(upper)) {
      score += hit.weight;
      pushEvidence(evidence, "keyword", hit.label, hit.weight);
    }
  }

  // Format / field presence from extractor
  const extraction = extractFromBarcodeAndOcr({
    profile: args.profile,
    barcodePayloads: args.barcodePayloads,
    ocrText: args.ocrText,
    ocrConfidence: 75,
  });

  const linxcamTrusted =
    args.profile.formId !== "linxup_linxcam" ||
    /\bMAC\b|SERIAL\s*NUM|\bLINXCAM\b/i.test(upper) ||
    args.barcodePayloads.length > 0;

  for (const c of extraction.candidates) {
    if (!c.validationOk) continue;
    if (args.profile.formId === "linxup_linxcam" && (c.key === "mac" || c.key === "serial") && !linxcamTrusted) {
      continue;
    }
    if (args.profile.formId === "linxup_linxcam" && c.key === "mac" && c.source === "ocr" && !/\bMAC\b/i.test(c.rawEvidence || upper)) {
      continue;
    }
    const w =
      c.key === "imei" ? 14 : c.key === "mac" ? 18 : c.key === "activationCode" ? 10 : c.key === "serial" ? 8 : 4;
    score += w;
    pushEvidence(evidence, "field", `${c.key}=${c.value} (${c.source})`, w);
  }

  // Strong structural signals
  const hasImei = /\bIMEI\b/.test(upper) || /\b\d{15}\b/.test(upper);
  const hasMacKeyword = /\bMAC\b/.test(upper);
  const hasMacValue = normalizeMacRaw(upper.match(/([0-9A-F]{12})/i)?.[1] || "").length === 12;

  if (args.profile.formId === "linxup_linxcam") {
    const hasSerialKeyword = /SERIAL\s*NUM|\bSERIAL\b/.test(upper);
    const macFromBarcode = args.barcodePayloads.some((p) => normalizeMacRaw(p).length === 12);

    if (hasMacKeyword) {
      score += 20;
      pushEvidence(evidence, "structure", "MAC keyword present (LinxCam signal)", 20);
    }
    if (hasSerialKeyword) {
      score += 10;
      pushEvidence(evidence, "structure", "Serial keyword present", 10);
    }
    if (macFromBarcode) {
      score += 22;
      pushEvidence(evidence, "barcode", "MAC-shaped barcode payload", 22);
    } else if (args.barcodePayloads.length > 0) {
      score += 12;
      pushEvidence(evidence, "barcode", `${args.barcodePayloads.length} barcode payload(s)`, 12);
    }
    if (!hasMacKeyword && !hasSerialKeyword && args.barcodePayloads.length === 0 && hasMacValue) {
      score -= 20;
      pushEvidence(evidence, "structure", "MAC-shaped token without keyword/barcode — not trusted", -20);
    }
    if (hasImei) {
      score -= 25;
      pushEvidence(evidence, "structure", "IMEI present (against LinxCam)", -25);
    }
  } else {
    if (hasImei) {
      score += 12;
      pushEvidence(evidence, "structure", "IMEI present (tracker signal)", 12);
    }
    if (hasMacKeyword && hasMacValue && !hasImei) {
      score -= 20;
      pushEvidence(evidence, "structure", "MAC-only label (against tracker)", -20);
    }
  }

  // Disambiguate AT3 vs OBD
  if (args.profile.formId === "linxup_vehicle_tracker" && /OBD\s*ACTIVATION/.test(upper)) {
    score += 10;
    pushEvidence(evidence, "disambiguation", "OBD Activation Code phrasing", 10);
  }
  if (args.profile.formId === "linxup_asset_tracker" && /OBD\s*ACTIVATION/.test(upper)) {
    score -= 30;
    pushEvidence(evidence, "disambiguation", "OBD Activation wording (against AT3)", -30);
  }
  if (args.profile.formId === "linxup_asset_tracker" && /ACTIVATION\s*CODE/.test(upper) && !/OBD/.test(upper)) {
    score += 10;
    pushEvidence(evidence, "disambiguation", "Activation Code without OBD", 10);
  }

  // Barcode density for trackers (LinxCam handled above)
  if (args.barcodePayloads.length > 0 && args.profile.formId !== "linxup_linxcam") {
    score += 4;
    pushEvidence(evidence, "barcode", `${args.barcodePayloads.length} barcode payload(s)`, 4);
  }

  // Soft length sanity for activation codes like EE1-RVY / G6R-81Q
  const act = upper.match(/ACTIVATION[^A-Z0-9]{0,12}([A-Z0-9]{2,4}-[A-Z0-9]{2,4})/);
  if (act && (args.profile.formId === "linxup_asset_tracker" || args.profile.formId === "linxup_vehicle_tracker")) {
    score += 8;
    pushEvidence(evidence, "format", `Activation-like token ${act[1]}`, 8);
  }

  // Digits that look like IMEI near keyword
  if (args.profile.formId !== "linxup_linxcam") {
    const imeiMatch = text.match(/IMEI[:\s]*([0-9OIlBSGQ]{14,17})/i);
    if (imeiMatch) {
      const digits = onlyDigits(
        imeiMatch[1]
          .replace(/O/gi, "0")
          .replace(/I|l/g, "1")
          .replace(/B/gi, "8")
          .replace(/S/gi, "5")
          .replace(/G/gi, "6"),
      );
      if (digits.length === 15) {
        score += 6;
        pushEvidence(evidence, "format", "15-digit IMEI-shaped value", 6);
      }
    }
  }

  const confidence = Math.max(0, Math.min(99, Math.round(score)));
  return { profile: args.profile, score, confidence, evidence };
}

export function classifyDeviceLabel(args: {
  ocrText: string;
  barcodePayloads: string[];
  profiles?: LabelExtractionProfile[];
}): ClassificationResult {
  const profiles = args.profiles || listPrototypeProfiles();
  const ranked = profiles
    .map((profile) => scoreProfile({ profile, ocrText: args.ocrText, barcodePayloads: args.barcodePayloads }))
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence);

  const top = ranked[0] || null;
  const second = ranked[1] || null;
  const margin = top && second ? top.score - second.score : top?.score || 0;
  let confidence = top?.confidence || 0;

  // Reduce confidence when top two are close
  if (top && second && margin < 12) {
    confidence = Math.min(confidence, 55);
  }
  if (top && second && margin < 6) {
    confidence = Math.min(confidence, 40);
  }

  // LinxCam: never high-band on a lone MAC-shaped token without keyword or barcode
  if (top?.profile.formId === "linxup_linxcam") {
    const upper = `${args.ocrText}\n${args.barcodePayloads.join("\n")}`.toUpperCase();
    const hasKeyword = /\bMAC\b|SERIAL\s*NUM|\bLINXCAM\b/.test(upper);
    const hasBarcode = args.barcodePayloads.length > 0;
    if (!hasKeyword && !hasBarcode) {
      confidence = Math.min(confidence, 40);
    }
  }

  const band = bandFor(confidence);
  const notes: string[] = [];
  if (band === "high") notes.push("High confidence — preselect device, still require confirmation.");
  if (band === "medium") notes.push("Medium confidence — show ranked choices.");
  if (band === "low") notes.push("Low confidence — require manual choice or retake.");
  if (top && second && margin < 12) notes.push(`Top margin only ${margin} points vs ${second.profile.uiSelectLabel}.`);

  return {
    ranked: ranked.map((r) => ({ ...r, confidence: r === top ? confidence : r.confidence })),
    top: top ? { ...top, confidence } : null,
    band,
    canPreselect: band === "high",
    requireManualChoice: band === "low",
    notes,
  };
}
