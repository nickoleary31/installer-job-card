/**
 * Server-side image optimization for email CID attachments.
 * Original Storage objects are never modified.
 */

import sharp, { type Sharp } from "sharp";

export const TARGET_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const HARD_MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
/** Raw attachment budget before Base64 expansion (~25 MB). */
export const MAX_TOTAL_PHOTO_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type OptimizeImageResult = {
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
  originalBytes: number;
  optimizedBytes: number;
  width: number;
  height: number;
};

export type OptimizeImageOptions = {
  maxLongEdge?: number;
  quality?: number;
  targetBytes?: number;
  hardMaxBytes?: number;
};

const DEFAULT_MAX_LONG_EDGE = 1800;

async function encodeJpeg(
  pipeline: Sharp,
  quality: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const out = await pipeline
    .rotate()
    .jpeg({ quality, mozjpeg: true, force: true })
    .toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height };
}

/**
 * Resize/compress for email. Auto-rotates via EXIF. Converts to JPEG unless alpha is meaningful.
 */
export async function optimizeImageForEmailAttachment(
  input: Buffer,
  options: OptimizeImageOptions = {},
): Promise<OptimizeImageResult> {
  const originalBytes = input.byteLength;
  const targetBytes = options.targetBytes ?? TARGET_ATTACHMENT_BYTES;
  const hardMaxBytes = options.hardMaxBytes ?? HARD_MAX_ATTACHMENT_BYTES;
  let maxLongEdge = options.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;
  let quality = options.quality ?? 80;

  const meta = await sharp(input).metadata();
  const hasAlpha = meta.hasAlpha === true;

  if (hasAlpha) {
    const png = await sharp(input)
      .rotate()
      .resize({ width: maxLongEdge, height: maxLongEdge, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, force: true })
      .toBuffer({ resolveWithObject: true });
    if (png.data.byteLength <= hardMaxBytes) {
      return {
        buffer: png.data,
        contentType: "image/png",
        extension: "png",
        originalBytes,
        optimizedBytes: png.data.byteLength,
        width: png.info.width,
        height: png.info.height,
      };
    }
  }

  let pipeline = sharp(input).rotate().resize({
    width: maxLongEdge,
    height: maxLongEdge,
    fit: "inside",
    withoutEnlargement: true,
  });

  let encoded = await encodeJpeg(pipeline, quality);

  for (let pass = 0; pass < 8 && encoded.buffer.byteLength > targetBytes; pass += 1) {
    if (quality > 55) {
      quality -= 7;
    } else if (maxLongEdge > 960) {
      maxLongEdge = Math.round(maxLongEdge * 0.85);
      quality = Math.max(quality, 60);
    } else {
      quality = Math.max(45, quality - 5);
    }
    pipeline = sharp(input).rotate().resize({
      width: maxLongEdge,
      height: maxLongEdge,
      fit: "inside",
      withoutEnlargement: true,
    });
    encoded = await encodeJpeg(pipeline, quality);
  }

  if (encoded.buffer.byteLength > hardMaxBytes) {
    throw new Error(
      `Could not compress image below ${Math.round(hardMaxBytes / (1024 * 1024))}MB (got ${(encoded.buffer.byteLength / (1024 * 1024)).toFixed(2)}MB)`,
    );
  }

  return {
    buffer: encoded.buffer,
    contentType: "image/jpeg",
    extension: "jpg",
    originalBytes,
    optimizedBytes: encoded.buffer.byteLength,
    width: encoded.width,
    height: encoded.height,
  };
}
