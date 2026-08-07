/**
 * Bridge: real Blaxtair camera OCR (this prototype) → Product Devices identifiers.
 * Prototype-only — local processing, no DB/Storage writes. See docs/OCR_Strategy.md.
 *
 * lib/product-devices/ocr-contract.ts describes the shape "live OCR will later provide";
 * this module is that provider for the Blaxtair camera demo path specifically.
 */

import { mapPrototypeFieldsToIdentifiers, type DeviceIdentifiers } from "../../product-devices/index.ts";
import { BLAXTAIR_AHD_CAMERA_LABEL_PROFILE, inferTruncatedBlaxtairPartNumber } from "./blaxtair-profile.ts";
export {
  BLAXTAIR_MONITOR_LABEL_OCR_SUPPORTED,
  findDuplicateDeviceInSystem,
  findDuplicatePhotoInSystem,
  normalizeDeviceKey,
  serializeDraft,
  parseDraftJson,
} from "./blaxtair-draft.ts";
import { classifyDeviceLabel, type ClassificationResult } from "./classify.ts";
import type { FieldCandidate } from "./extract.ts";
import { runLabelScanPipeline } from "./pipeline.ts";
import { listPrototypeProfiles, type LabelFieldKey } from "./profile.ts";

export type BlaxtairCameraScanResult = {
  classification: ClassificationResult;
  candidates: FieldCandidate[];
  identifiers: DeviceIdentifiers;
  rawOcrText: string;
  barcodePayloads: string[];
  warnings: string[];
  ocrMs: number;
  barcodeMs: number;
  previewDataUrl: string;
  /** Bounded-size JPEG suitable for persisting on the component (labelPhoto.localPreview). */
  thumbnailDataUrl: string;
  /** True when partNumber was proposed from the known-truncation assumption, not read directly. */
  partNumberInferred: boolean;
};

function candidatesToFieldValues(candidates: FieldCandidate[]): Partial<Record<LabelFieldKey, string>> {
  const out: Partial<Record<LabelFieldKey, string>> = {};
  for (const c of candidates) {
    if (c.validationOk) out[c.key] = c.value;
  }
  return out;
}

/**
 * Real camera-label scan: pipeline → classify (against Blaxtair + LinxUp candidates) → extract → identifiers.
 *
 * Barcode decode stays on (barcode-first) but quick-only: a single decode attempt per
 * canvas/angle, never escalating to the shared aggressive multi-crop fallback. That fallback's
 * crop coordinates are tuned for LinxCam's side-by-side sticker layout and don't apply to the
 * Blaxtair camera label's single 2D code — escalating to it just burns ~288 attempts finding
 * nothing whenever the quick decode misses, which stalls the scan for a minute or more on a
 * real photo. OCR (part number / serial / IP) is unaffected either way.
 */
export async function runBlaxtairCameraScan(
  source: Blob | HTMLCanvasElement,
  opts?: {
    /** Skip barcode decode entirely — used for the synthetic sample, which has no real 2D code. */
    skipBarcodeDecode?: boolean;
  },
): Promise<BlaxtairCameraScanResult> {
  const { canvasToDataUrl, canvasToThumbnailDataUrl } = await import("./preprocess.ts");
  const result = await runLabelScanPipeline({
    profile: BLAXTAIR_AHD_CAMERA_LABEL_PROFILE,
    source,
    skipBarcodeDecode: opts?.skipBarcodeDecode,
    barcodeQuickOnly: true,
    // Barcode is no longer the bottleneck (quick-only above), so there's compute headroom to
    // keep more detail for OCR — real photos often frame the label as a small part of the scene.
    maxSourceWidth: 2800,
  });

  const classification = classifyDeviceLabel({
    ocrText: result.extraction.rawOcrText,
    barcodePayloads: result.extraction.barcodePayloads,
    profiles: [...listPrototypeProfiles(), BLAXTAIR_AHD_CAMERA_LABEL_PROFILE],
  });

  const candidates = [...result.extraction.candidates];
  let partNumberInferred = false;
  const hasValidPartNumber = candidates.some((c) => c.key === "partNumber" && c.validationOk);
  if (!hasValidPartNumber) {
    const inferred = inferTruncatedBlaxtairPartNumber(result.extraction.rawOcrText);
    if (inferred) {
      partNumberInferred = true;
      candidates.push({
        key: "partNumber",
        value: inferred,
        rawValue: inferred,
        source: "inferred",
        confidence: 60,
        validationOk: true,
        ambiguous: false,
        rawEvidence:
          "Assumed from known truncated print (physical label clips the final digit for the current model) — confirm against the label.",
        correctionSuggestions: [],
      });
    }
  }

  const fieldValues = candidatesToFieldValues(candidates);
  const identifiers = mapPrototypeFieldsToIdentifiers(fieldValues);

  return {
    classification,
    candidates,
    identifiers,
    rawOcrText: result.extraction.rawOcrText,
    barcodePayloads: result.extraction.barcodePayloads,
    warnings: result.extraction.warnings,
    ocrMs: result.ocrMs,
    barcodeMs: result.barcodeMs,
    previewDataUrl: canvasToDataUrl(result.croppedCanvas),
    thumbnailDataUrl: canvasToThumbnailDataUrl(result.croppedCanvas),
    partNumberInferred,
  };
}
