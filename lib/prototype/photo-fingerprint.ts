/**
 * Content-based photo fingerprinting — deliberately NOT under lib/prototype/label-scan/.
 * This is meant to generalize to every job-card photo category (power connection, ground
 * connection, mounting, VIN, odometer, vehicle overview, completed install, etc.), not just
 * the Blaxtair camera label. This demo only exercises it via the one real photo path it has
 * (the camera label scan/upload), but the API takes no label-scan-specific inputs.
 *
 * SHA-256 of the exact file bytes — content-based, never derived from filename. This catches
 * "the exact same photo file reused elsewhere" reliably. It will NOT catch a re-compressed or
 * re-cropped copy of a visually-similar photo (that needs perceptual hashing) — see
 * docs/Blaxtair_Demo_Duplicate_Detection.md for that known limitation and the production plan.
 */

/** Pure — testable directly with fixed byte input. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintBlob(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  return sha256Hex(bytes);
}

/**
 * Fingerprints the ORIGINAL captured/uploaded bytes, not a re-encoded working canvas — canvas
 * JPEG re-encoding is lossy and not byte-stable across runs/browsers, which would make the same
 * physical photo hash differently each time. The synthetic sample (an in-memory canvas, not a
 * real file) is the one legitimate case with no original bytes to hash, so it's encoded once
 * via toBlob() here.
 */
export async function fingerprintSource(source: Blob | HTMLCanvasElement): Promise<string> {
  if (source instanceof Blob) return fingerprintBlob(source);
  const blob = await new Promise<Blob>((resolve, reject) => {
    source.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
  return fingerprintBlob(blob);
}
