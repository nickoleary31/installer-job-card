/**
 * Aggressive still-image barcode decode for LinxCam-style vertical 1D stickers.
 * Browser path — used by the prototype pipeline.
 */

import { BrowserMultiFormatReader } from "@zxing/browser";
import { cropToGuide, enhanceForOcr, rotateCanvas, type GuideRect } from "./preprocess.ts";

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

async function decodeOnce(canvas: HTMLCanvasElement): Promise<string[]> {
  const reader = new BrowserMultiFormatReader();
  const payloads = new Set<string>();
  try {
    const result = reader.decodeFromCanvas(canvas);
    const text = result.getText()?.trim();
    if (text) payloads.add(text);
  } catch {
    /* none */
  }
  try {
    const result = await reader.decodeFromImageUrl(canvas.toDataURL("image/png"));
    const text = result.getText()?.trim();
    if (text) payloads.add(text);
  } catch {
    /* none */
  }
  return [...payloads];
}

/** Binary threshold after grayscale (helps high-contrast outdoor shadows). */
export function thresholdCanvas(source: HTMLCanvasElement, cutoff = 140): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = g >= cutoff ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export function scaleCanvas(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (scale === 1) return source;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

/** Relative crops targeting side-by-side LinxCam sticker barcodes. */
export const LINXCAM_BARCODE_CROPS: GuideRect[] = [
  { x: 0.05, y: 0.15, w: 0.45, h: 0.55 }, // left sticker (MAC)
  { x: 0.5, y: 0.15, w: 0.45, h: 0.55 }, // right sticker (serial)
  { x: 0.08, y: 0.12, w: 0.38, h: 0.4 }, // left barcode band
  { x: 0.52, y: 0.12, w: 0.4, h: 0.4 }, // right barcode band
  { x: 0.1, y: 0.35, w: 0.8, h: 0.35 }, // text band under barcodes
  { x: 0, y: 0, w: 1, h: 1 },
];

export async function decodeBarcodesAggressive(source: HTMLCanvasElement): Promise<{
  payloads: string[];
  attempts: number;
}> {
  const found = new Set<string>();
  let attempts = 0;
  const angles: Array<0 | 90 | 180 | 270> = [0, 90, 270, 180];
  const scales = [1, 2, 2.5];

  for (const crop of LINXCAM_BARCODE_CROPS) {
    const region = cropToGuide(source, crop);
    for (const angle of angles) {
      const rotated = rotateCanvas(region, angle);
      const variants = [rotated, enhanceForOcr(rotated), thresholdCanvas(rotated, 130), thresholdCanvas(enhanceForOcr(rotated), 145)];
      for (const base of variants) {
        for (const scale of scales) {
          const scaled = scaleCanvas(base, scale);
          attempts += 1;
          for (const p of await decodeOnce(scaled)) found.add(p);
          if (found.size >= 2) {
            return { payloads: unique([...found]), attempts };
          }
        }
      }
    }
  }

  return { payloads: unique([...found]), attempts };
}

export async function decodeBarcodesFromCanvas(canvas: HTMLCanvasElement): Promise<string[]> {
  const quick = await decodeOnce(canvas);
  if (quick.length) return unique(quick);
  const aggressive = await decodeBarcodesAggressive(canvas);
  return aggressive.payloads;
}
