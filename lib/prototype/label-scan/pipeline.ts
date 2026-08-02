/**
 * End-to-end prototype pipeline: preprocess → barcode → OCR → extract.
 * Retries 90/180/270° when the first pass lacks strong label keywords (e.g. rotated AT3).
 */

import { decodeBarcodesAggressive, decodeBarcodesFromCanvas } from "./barcode.ts";
import { classifyDeviceLabel } from "./classify.ts";
import { extractFromBarcodeAndOcr, type ExtractionResult } from "./extract.ts";
import { runLabelOcr } from "./ocr.ts";
import {
  cropToGuide,
  DEFAULT_LABEL_GUIDE,
  drawToCanvas,
  enhanceForOcr,
  loadImageBitmap,
  rotateCanvas,
  type GuideRect,
} from "./preprocess.ts";
import type { LabelExtractionProfile } from "./profile.ts";

export type PipelineArtifacts = {
  fullCanvas: HTMLCanvasElement;
  croppedCanvas: HTMLCanvasElement;
  enhancedCanvas: HTMLCanvasElement;
  extraction: ExtractionResult;
  ocrMs: number;
  barcodeMs: number;
  /** Whether enhanced OCR beat raw-crop OCR on valid field count */
  preprocessingHelped: boolean;
  ocrTextRaw: string;
  ocrTextEnhanced: string;
  orientationDegrees: 0 | 90 | 180 | 270;
};

function uniquePush(list: string[], values: string[]) {
  for (const v of values) {
    if (v && !list.includes(v)) list.push(v);
  }
}

function countValid(extraction: ExtractionResult): number {
  return extraction.candidates.filter((c) => c.validationOk).length;
}

function hasStrongLabelKeywords(text: string): boolean {
  return /OBD\s*ACTIVATION|ACTIVATION\s*CODE|\bIMEI\b|\bMAC\b|SERIAL\s*NUM/i.test(text);
}

function passScore(ocrText: string, barcodes: string[]): number {
  const classification = classifyDeviceLabel({ ocrText, barcodePayloads: barcodes });
  return (
    (classification.top?.score || 0) * 2 +
    (ocrText.match(/IMEI|MAC|ACTIVATION|S\/N|SERIAL|SIN/gi) || []).length * 5 +
    barcodes.length * 3
  );
}

async function decodePass(canvases: HTMLCanvasElement[], aggressive: boolean): Promise<string[]> {
  const barcodePayloads: string[] = [];
  for (const c of canvases) {
    if (aggressive) {
      uniquePush(barcodePayloads, (await decodeBarcodesAggressive(c)).payloads);
    } else {
      uniquePush(barcodePayloads, await decodeBarcodesFromCanvas(c));
    }
  }
  return barcodePayloads;
}

export async function runLabelScanPipeline(args: {
  profile: LabelExtractionProfile;
  source: Blob | HTMLCanvasElement;
  guide?: GuideRect | null;
  /** When true (default for uploads), process the whole image as the label. */
  useFullFrame?: boolean;
}): Promise<PipelineArtifacts> {
  let baseCanvas: HTMLCanvasElement;
  if (args.source instanceof HTMLCanvasElement) {
    baseCanvas = args.source;
  } else {
    const bitmap = await loadImageBitmap(args.source);
    const maxW = 1800;
    const scale = bitmap.width > maxW ? maxW / bitmap.width : 1;
    baseCanvas = drawToCanvas(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    bitmap.close();
  }

  const useFull = args.useFullFrame !== false;
  const guide = useFull ? { x: 0, y: 0, w: 1, h: 1 } : (args.guide ?? DEFAULT_LABEL_GUIDE);

  const angles: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  let best: PipelineArtifacts | null = null;
  let bestScore = -1;
  let ocrMsTotal = 0;
  let barcodeMsTotal = 0;

  for (const angle of angles) {
    const fullCanvas = rotateCanvas(baseCanvas, angle);
    const croppedCanvas = cropToGuide(fullCanvas, guide);
    const enhancedCanvas = enhanceForOcr(croppedCanvas);

    const t0 = performance.now();
    const aggressive = args.profile.formId === "linxup_linxcam";
    const barcodePayloads = await decodePass([croppedCanvas, enhancedCanvas, fullCanvas], aggressive);
    if (args.profile.barcodeRegionHint) {
      const band = cropToGuide(fullCanvas, args.profile.barcodeRegionHint);
      if (aggressive) {
        uniquePush(barcodePayloads, (await decodeBarcodesAggressive(band)).payloads);
      } else {
        uniquePush(barcodePayloads, await decodeBarcodesFromCanvas(band));
      }
    }
    barcodeMsTotal += performance.now() - t0;

    const t1 = performance.now();
    const ocrRaw = await runLabelOcr(croppedCanvas);
    const ocrEnhanced = await runLabelOcr(enhancedCanvas);

    const regionTexts: string[] = [];
    for (const field of args.profile.fields) {
      if (!field.regionHint) continue;
      const region = cropToGuide(croppedCanvas, field.regionHint);
      const enhancedRegion = enhanceForOcr(region);
      const r = await runLabelOcr(enhancedRegion);
      if (r.text.trim()) regionTexts.push(`${field.label}: ${r.text.trim()}`);
    }
    ocrMsTotal += performance.now() - t1;

    const mergedRawText = [ocrRaw.text, ...regionTexts].filter(Boolean).join("\n");
    const mergedEnhancedText = [ocrEnhanced.text, ...regionTexts].filter(Boolean).join("\n");

    const extractionRaw = extractFromBarcodeAndOcr({
      profile: args.profile,
      barcodePayloads,
      ocrText: mergedRawText,
      ocrConfidence: ocrRaw.confidence,
    });
    const extractionEnhanced = extractFromBarcodeAndOcr({
      profile: args.profile,
      barcodePayloads,
      ocrText: mergedEnhancedText,
      ocrConfidence: ocrEnhanced.confidence,
    });

    const preprocessingHelped = countValid(extractionEnhanced) > countValid(extractionRaw);
    const extraction =
      preprocessingHelped || countValid(extractionEnhanced) === countValid(extractionRaw)
        ? extractionEnhanced
        : extractionRaw;

    const usedText = extraction.rawOcrText;
    const score = passScore(usedText, barcodePayloads);

    if (!best || score > bestScore) {
      bestScore = score;
      const warnings = [...extraction.warnings];
      if (preprocessingHelped) {
        warnings.push("Preprocessing (contrast) improved valid field detections vs raw crop.");
      } else if (countValid(extractionRaw) > countValid(extractionEnhanced)) {
        warnings.push("Raw crop OCR outperformed enhanced OCR for this label; used raw OCR text.");
      }
      if (angle !== 0) warnings.push(`Used ${angle}° orientation for best label read.`);

      best = {
        fullCanvas,
        croppedCanvas,
        enhancedCanvas,
        extraction: { ...extraction, warnings },
        ocrMs: ocrMsTotal,
        barcodeMs: barcodeMsTotal,
        preprocessingHelped,
        ocrTextRaw: ocrRaw.text,
        ocrTextEnhanced: ocrEnhanced.text,
        orientationDegrees: angle,
      };
    }

    // Fast path: upright labels with strong keywords skip remaining angles
    if (angle === 0 && hasStrongLabelKeywords(usedText) && score >= 80) {
      break;
    }
  }

  return best!;
}
