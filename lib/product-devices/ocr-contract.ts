/**
 * Live OCR will later provide this shape. Structural model must not import Tesseract.
 */
import type {
  DeviceIdentifiers,
  HardwareProfileId,
  LabelPhotoRef,
} from "./types.ts";

export type LabelDetectionInput = {
  hardwareProfileId: HardwareProfileId | null;
  confidence: number | null;
  rawOcrText: string | null;
  decodedBarcodeValues: string[];
  proposedIdentifiers: DeviceIdentifiers;
  labelImage: LabelPhotoRef | null;
};

export type LabelDetectionSource = "simulated" | "live_ocr" | "manual";

export function emptyLabelDetectionInput(): LabelDetectionInput {
  return {
    hardwareProfileId: null,
    confidence: null,
    rawOcrText: null,
    decodedBarcodeValues: [],
    proposedIdentifiers: {},
    labelImage: null,
  };
}
