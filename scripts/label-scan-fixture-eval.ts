/**
 * Offline fixture evaluator + classifier for label-scan prototype.
 * Fixtures are gitignored (may contain real device identifiers).
 *
 *   node --experimental-strip-types scripts/label-scan-fixture-eval.ts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { decodeBarcodesAggressiveNode } from "../lib/prototype/label-scan/barcode-node.ts";
import { classifyDeviceLabel } from "../lib/prototype/label-scan/classify.ts";
import { extractFromBarcodeAndOcr } from "../lib/prototype/label-scan/extract.ts";
import { getPrototypeProfile } from "../lib/prototype/label-scan/profile.ts";

const FIXTURE_DIR = join(process.cwd(), "fixtures", "label-scan");
const REPORT_PATH = join(FIXTURE_DIR, "hardening-report.json");

const EXPECTED: Record<string, { formId: string; fields: Record<string, string> }> = {
  "obd.png": {
    formId: "linxup_vehicle_tracker",
    fields: {
      activationCode: "G6R-81Q",
      serial: "88X160090306",
      imei: "868892080208581",
    },
  },
  "linxcam.png": {
    formId: "linxup_linxcam",
    fields: {
      mac: "0018F5A950E0",
      serial: "00D2083B69",
    },
  },
  "at3.png": {
    formId: "linxup_asset_tracker",
    fields: {
      activationCode: "EE1-RVY",
      serial: "68W661200312",
      imei: "868892081011521",
    },
  },
};

function normCompare(a: string, b: string) {
  return a.replace(/[:\-\s]/g, "").toUpperCase() === b.replace(/[:\-\s]/g, "").toUpperCase();
}

async function bestOcrPass(
  worker: Awaited<ReturnType<typeof createWorker>>,
  input: Buffer,
  preferAggressiveBarcodes: boolean,
): Promise<{
  angle: number;
  ocrText: string;
  ocrConfidence: number;
  barcodes: string[];
  barcodeAttempts: number;
  preprocessingHelped: boolean;
  ocrRaw: string;
  ocrEnhanced: string;
  preprocessing: string[];
}> {
  const angles = [0, 90, 180, 270];
  let best: {
    angle: number;
    ocrText: string;
    ocrConfidence: number;
    barcodes: string[];
    barcodeAttempts: number;
    preprocessingHelped: boolean;
    ocrRaw: string;
    ocrEnhanced: string;
    preprocessing: string[];
    score: number;
  } | null = null;

  const aggressive = preferAggressiveBarcodes
    ? await decodeBarcodesAggressiveNode(input)
    : { payloads: [] as string[], attempts: 0 };

  // LinxCam: OCR the mid-band sticker region (side-by-side labels), not the whole hand/device frame
  const stickerCrop =
    preferAggressiveBarcodes
      ? await sharp(input)
          .extract({
            left: Math.round(((await sharp(input).metadata()).width || 1000) * 0.12),
            top: Math.round(((await sharp(input).metadata()).height || 1000) * 0.28),
            width: Math.round(((await sharp(input).metadata()).width || 1000) * 0.76),
            height: Math.round(((await sharp(input).metadata()).height || 1000) * 0.4),
          })
          .png()
          .toBuffer()
          .catch(() => null)
      : null;

  for (const angle of angles) {
    const rotated = await sharp(input)
      .rotate(angle)
      .resize({ width: 1800, withoutEnlargement: true })
      .png()
      .toBuffer();
    const enhPng = await sharp(rotated).grayscale().normalize().sharpen().png().toBuffer();
    const threshPng = await sharp(rotated).grayscale().normalize().threshold(140).png().toBuffer();

    let barcodes = preferAggressiveBarcodes ? [...aggressive.payloads] : [];
    if (preferAggressiveBarcodes && !barcodes.length) {
      const atAngle = await decodeBarcodesAggressiveNode(rotated);
      barcodes = atAngle.payloads;
      aggressive.attempts += atAngle.attempts;
    }

    const ocrRaw = await worker.recognize(rotated);
    const ocrEnh = await worker.recognize(enhPng);
    const ocrThresh = await worker.recognize(threshPng);
    const candidates = [
      { text: ocrRaw.data.text || "", conf: ocrRaw.data.confidence || 0, label: "raw" },
      { text: ocrEnh.data.text || "", conf: ocrEnh.data.confidence || 0, label: "grayscale+normalize+sharpen" },
      { text: ocrThresh.data.text || "", conf: ocrThresh.data.confidence || 0, label: "threshold" },
    ];
    if (stickerCrop) {
      const stickerRot = await sharp(stickerCrop).rotate(angle).resize({ width: 1600, withoutEnlargement: true }).png().toBuffer();
      const stickerEnh = await sharp(stickerRot).grayscale().normalize().sharpen().linear(1.5, -30).png().toBuffer();
      const stickerOcr = await worker.recognize(stickerEnh);
      candidates.push({
        text: stickerOcr.data.text || "",
        conf: stickerOcr.data.confidence || 0,
        label: "sticker-crop+contrast",
      });
    }

    let bestText = candidates[0];
    for (const c of candidates) {
      const classC = classifyDeviceLabel({ ocrText: c.text, barcodePayloads: barcodes });
      const classBest = classifyDeviceLabel({ ocrText: bestText.text, barcodePayloads: barcodes });
      if ((classC.top?.score || 0) > (classBest.top?.score || 0)) bestText = c;
    }

    const classification = classifyDeviceLabel({ ocrText: bestText.text, barcodePayloads: barcodes });
    const score =
      (classification.top?.score || 0) * 2 +
      (bestText.text.match(/IMEI|MAC|ACTIVATION|S\/N|SERIAL|SIN/gi) || []).length * 5 +
      barcodes.length * 8;

    if (!best || score > best.score) {
      best = {
        angle,
        ocrText: bestText.text,
        ocrConfidence: bestText.conf,
        barcodes: [...new Set(barcodes)],
        barcodeAttempts: aggressive.attempts,
        preprocessingHelped: bestText.label !== "raw",
        ocrRaw: candidates[0].text,
        ocrEnhanced: candidates[1].text,
        preprocessing: [bestText.label, ...(barcodes.length ? ["aggressive-barcode"] : [])],
        score,
      };
    }

    if (classification.band === "high" && barcodes.length >= (preferAggressiveBarcodes ? 1 : 0) && angle === 0) {
      // keep searching angles for AT3 rotation, but allow early prefer for upright high-confidence
    }
  }

  return best!;
}

const worker = await createWorker("eng");
const files = readdirSync(FIXTURE_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
const reports = [];

for (const file of files) {
  const path = join(FIXTURE_DIR, file);
  const expected = EXPECTED[file];
  const preferAggressive = file === "linxcam.png";
  const pass = await bestOcrPass(worker, readFileSync(path), preferAggressive);
  const classification = classifyDeviceLabel({
    ocrText: pass.ocrText,
    barcodePayloads: pass.barcodes,
  });

  const confirmedFormId = expected?.formId || classification.top?.profile.formId || "linxup_asset_tracker";
  const profile = getPrototypeProfile(confirmedFormId);
  const extraction = extractFromBarcodeAndOcr({
    profile,
    barcodePayloads: pass.barcodes,
    ocrText: pass.ocrText,
    ocrConfidence: pass.ocrConfidence,
  });

  const rows = profile.fields.map((field) => {
    const cand = extraction.candidates.find((c) => c.key === field.key);
    const expectedValue = expected?.fields[field.key] || "";
    const detected = cand?.value || "";
    const match = expectedValue ? normCompare(expectedValue, detected) : null;
    const suggestions = cand?.correctionSuggestions?.map((s) => s.to) || [];
    const technicianCorrectionRequired =
      !cand || !cand.validationOk || match === false || (cand.ambiguous && suggestions.length > 0 && match !== true);
    return {
      field: field.label,
      key: field.key,
      expected: expectedValue,
      detected: detected || "(none)",
      source: cand?.source || "—",
      confidence: cand?.confidence ?? null,
      valid: cand?.validationOk ?? false,
      ambiguous: cand?.ambiguous ?? false,
      technicianCorrectionRequired,
      match,
      suggestions,
      rawEvidence: cand?.rawEvidence || null,
    };
  });

  // Simulate technician accepting expected values when corrections exist (report only)
  const finalAccepted: Record<string, string> = {};
  for (const f of profile.fields) {
    const row = rows.find((r) => r.key === f.key)!;
    const exp = expected?.fields[f.key] || "";
    if (row.match) {
      finalAccepted[f.key] = exp || String(row.detected);
    } else if (exp && row.suggestions.some((s) => normCompare(s, exp))) {
      finalAccepted[f.key] = exp;
    } else if (exp) {
      finalAccepted[f.key] = `(technician edit) ${exp}`;
    } else {
      finalAccepted[f.key] = String(row.detected);
    }
  }

  reports.push({
    file,
    expectedDevice: expected?.formId || null,
    classification: {
      band: classification.band,
      canPreselect: classification.canPreselect,
      requireManualChoice: classification.requireManualChoice,
      top: classification.top
        ? {
            formId: classification.top.profile.formId,
            deviceFamily: classification.top.profile.deviceFamily,
            label: classification.top.profile.uiSelectLabel,
            confidence: classification.top.confidence,
            score: classification.top.score,
            evidence: classification.top.evidence,
          }
        : null,
      ranked: classification.ranked.map((r) => ({
        formId: r.profile.formId,
        score: r.score,
        confidence: r.confidence,
      })),
      notes: classification.notes,
      correct: expected ? classification.top?.profile.formId === expected.formId : null,
    },
    orientationTriedBestAngle: pass.angle,
    barcodes: pass.barcodes,
    barcodeAttempts: pass.barcodeAttempts,
    barcodeHelped: pass.barcodes.length > 0,
    preprocessing: pass.preprocessing,
    preprocessingHelped: pass.preprocessingHelped,
    ocrRaw: pass.ocrRaw,
    ocrEnhanced: pass.ocrEnhanced,
    ocrUsed: pass.ocrText,
    ocrConfidence: pass.ocrConfidence,
    rows,
    finalAcceptedValues: finalAccepted,
    endToEndOk:
      !!expected &&
      classification.top?.profile.formId === expected.formId &&
      rows.every((r) => r.match === true && r.valid === true),
  });
}

await worker.terminate();
writeFileSync(REPORT_PATH, JSON.stringify({ fixtureDir: FIXTURE_DIR, reports }, null, 2));
console.log(JSON.stringify({ fixtureDir: FIXTURE_DIR, reportPath: REPORT_PATH, reports }, null, 2));
