/**
 * Blaxtair AHD camera — approved synthetic ground-truth sample.
 *
 * Values come from one approved example label (docs/OCR_Strategy.md / Tuesday demo brief):
 *   device text: AHD Camera
 *   part number: 210-110-001
 *   serial number: 26062215
 *   IP address: 192.168.89.250
 *   2D code present (decoded payload content not provided — not fabricated here)
 *
 * This is a synthetic OCR-text fixture (checked in per docs/OCR_Strategy.md's
 * "prefer checked-in synthetic fixtures for CI" guidance) — no real device data.
 */

export const BLAXTAIR_CAMERA_GROUND_TRUTH = {
  ocrText: [
    "AHD Camera",
    "P/N: 210-110-001",
    "S/N: 26062215",
    "IP ADDRESS: 192.168.89.250",
  ].join("\n"),
  expectedPartNumber: "210-110-001",
  expectedSerial: "26062215",
  expectedIp: "192.168.89.250",
  /** No real 2D payload string is available — barcode decode is exercised at runtime via zxing, not faked here. */
  barcodePayloads: [] as string[],
};

/** Build a synthetic demo label canvas — no real device PII. Browser-only (client canvas APIs). */
export function renderSyntheticBlaxtairCameraLabel(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.fillStyle = "#f5f5f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 4;
  ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

  ctx.fillStyle = "#111";
  ctx.font = "bold 34px Arial";
  ctx.fillText("AHD Camera", 56, 90);
  ctx.font = "28px Arial";
  ctx.fillText(`P/N: ${BLAXTAIR_CAMERA_GROUND_TRUTH.expectedPartNumber}`, 56, 170);
  ctx.fillText(`S/N: ${BLAXTAIR_CAMERA_GROUND_TRUTH.expectedSerial}`, 56, 240);
  ctx.fillText(`IP ADDRESS: ${BLAXTAIR_CAMERA_GROUND_TRUTH.expectedIp}`, 56, 310);

  // Simple 2D-code placeholder square (not a real decodable QR — visual only).
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 3;
  ctx.strokeRect(760, 60, 140, 140);
  ctx.font = "14px Arial";
  ctx.fillText("2D CODE", 790, 135);

  ctx.font = "20px Arial";
  ctx.fillText("SAMPLE LABEL — PROTOTYPE ONLY (not a real device)", 56, 470);
  return canvas;
}
