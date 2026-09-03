/**
 * Client-side image compression before upload to Supabase Storage. Runs in the browser
 * (canvas/web worker), so it's safe on-device for phone cameras that routinely produce
 * 5-15MB HEIC/JPEG files — uploading those raw over job-site cellular/wifi is what was
 * making photo uploads slow and prone to failure.
 */
import imageCompression from "browser-image-compression";

export const CLIENT_PHOTO_MAX_LONG_EDGE = 2000;
export const CLIENT_PHOTO_MAX_SIZE_MB = 1.5;

/**
 * Best-effort compression: on any failure (unsupported format, worker unavailable, etc.)
 * fall back to the original file rather than blocking the upload.
 */
export async function compressPhotoForUpload(file: File): Promise<File> {
  try {
    const compressed = await imageCompression(file, {
      maxWidthOrHeight: CLIENT_PHOTO_MAX_LONG_EDGE,
      maxSizeMB: CLIENT_PHOTO_MAX_SIZE_MB,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: 0.82,
    });
    // Guard against a pathological case where "compression" produces a larger file
    // (can happen for already-small/simple images) — upload whichever is smaller.
    if (compressed.size > 0 && compressed.size < file.size) {
      const renamed = compressed.name === file.name ? compressed : new File([compressed], file.name, { type: compressed.type });
      return renamed;
    }
    return file;
  } catch (error) {
    console.warn("[client-photo-optimize] compression failed, uploading original", {
      filename: file.name,
      size: file.size,
      type: file.type,
      error,
    });
    return file;
  }
}
