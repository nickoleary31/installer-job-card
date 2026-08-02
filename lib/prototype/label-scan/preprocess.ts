/**
 * Client-side image preprocess for label OCR/barcode prototype.
 */

export type GuideRect = {
  /** Fraction of canvas width/height (0–1) for the framing guide */
  x: number;
  y: number;
  w: number;
  h: number;
};

export const DEFAULT_LABEL_GUIDE: GuideRect = {
  x: 0.08,
  y: 0.22,
  w: 0.84,
  h: 0.45,
};

export function rotateCanvas(source: HTMLCanvasElement, degrees: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (degrees === 0) return source;
  const rad = (degrees * Math.PI) / 180;
  const swap = degrees === 90 || degrees === 270;
  const out = document.createElement("canvas");
  out.width = swap ? source.height : source.width;
  out.height = swap ? source.width : source.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

export async function loadImageBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** Draw source into canvas; auto-orient via browser decode (EXIF handled by createImageBitmap when supported). */
export function drawToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

export function cropToGuide(source: HTMLCanvasElement, guide: GuideRect = DEFAULT_LABEL_GUIDE): HTMLCanvasElement {
  const sx = Math.round(guide.x * source.width);
  const sy = Math.round(guide.y * source.height);
  const sw = Math.round(guide.w * source.width);
  const sh = Math.round(guide.h * source.height);
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/** Grayscale + contrast stretch + mild sharpen for OCR. */
export function enhanceForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;

  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let v = ((g - min) / range) * 255;
    // Mild contrast boost around midtones
    v = (v - 128) * 1.25 + 128;
    v = Math.max(0, Math.min(255, v));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export function canvasToDataUrl(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.92): string {
  return canvas.toDataURL(type, quality);
}

/** Build synthetic demo labels (no real device PII). */
export function renderSyntheticLinxupLabel(
  kind: "asset" | "vehicle" | "linxcam" = "asset",
): HTMLCanvasElement {
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
  if (kind === "linxcam") {
    ctx.fillText("LinxCam", 56, 90);
    ctx.font = "28px Arial";
    ctx.fillText("MAC ADDRESS: AA:BB:CC:11:22:33", 56, 180);
    ctx.fillText("SERIAL NUMBER: LC-9F2A18C4", 56, 260);
  } else if (kind === "vehicle") {
    ctx.fillText("LinxUp Vehicle Tracker (OBD)", 56, 90);
    ctx.font = "28px Arial";
    ctx.fillText("ACTIVATION CODE: VT8K2Q91", 56, 170);
    ctx.fillText("SERIAL NUMBER: LXVT-44N1B2", 56, 240);
    ctx.fillText("IMEI: 490154203237518", 56, 310);
  } else {
    ctx.fillText("LinxUp Asset Tracker (AT3)", 56, 90);
    ctx.font = "28px Arial";
    ctx.fillText("ACTIVATION CODE: AT3X7M2P", 56, 170);
    ctx.fillText("SERIAL NUMBER: LXAT-7K92MQ14", 56, 240);
    ctx.fillText("IMEI: 490154203237518", 56, 310);
  }
  ctx.font = "20px Arial";
  ctx.fillText("SAMPLE LABEL — PROTOTYPE ONLY (not a real device)", 56, 470);
  return canvas;
}
