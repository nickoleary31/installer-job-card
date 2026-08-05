/**
 * DOM-free helpers for the Blaxtair OCR demo — kept separate from blaxtair-bridge.ts
 * (which pulls in the browser-only OCR/barcode pipeline) so these stay unit-testable
 * under the plain Node test runner.
 */

import type { InstalledProductComponent } from "../../product-devices/types.ts";

/**
 * Normalized device identity key: part number + serial number, not serial alone — two
 * different device types must never collide just because they happen to share a serial.
 * Case/whitespace-insensitive for comparison only; never rewrites a stored identifier value
 * (matches the "no silent correction" rule elsewhere in this module).
 * Shared by the same-form check below and the cross-form registry (blaxtair-install-registry.ts)
 * so both use identical matching semantics.
 */
export function normalizeDeviceKey(partNumber: string, serialNumber: string): string {
  return `${partNumber.trim().toUpperCase()}::${serialNumber.trim().toUpperCase()}`;
}

/**
 * Same-form duplicate guard: a (part number, serial number) pair should never appear on two
 * components of the same installed system (accidental reuse of an already-scanned photo, or a
 * technician cutting corners). A component with no serial is never checked — empty/placeholder
 * slots never collide with anything.
 */
export function findDuplicateDeviceInSystem(
  components: InstalledProductComponent[],
  excludeComponentId: string,
  partNumber: string,
  serialNumber: string,
): InstalledProductComponent | null {
  if (!serialNumber.trim()) return null;
  const targetKey = normalizeDeviceKey(partNumber, serialNumber);
  return (
    components.find(
      (c) =>
        c.id !== excludeComponentId &&
        (c.identifiers.serialNumber ?? "").trim() &&
        normalizeDeviceKey(c.identifiers.partNumber ?? "", c.identifiers.serialNumber ?? "") === targetKey,
    ) ?? null
  );
}

/**
 * Same-form photo-reuse guard: the same physical photo (by content fingerprint) should never
 * back two components on one job card — e.g. accidentally re-selecting the Camera 1 photo for
 * Camera 2 from a gallery. Components with no fingerprint on file are never checked.
 */
export function findDuplicatePhotoInSystem(
  components: InstalledProductComponent[],
  excludeComponentId: string,
  fingerprint: string,
): InstalledProductComponent | null {
  const target = fingerprint.trim();
  if (!target) return null;
  return (
    components.find(
      (c) => c.id !== excludeComponentId && (c.labelPhoto?.contentFingerprint ?? "").trim() === target,
    ) ?? null
  );
}

/**
 * Monitor labels have no approved sample yet — do not invent a monitor OCR profile.
 * UI must clearly label monitor scan/OCR as unavailable until a real sample is supplied.
 */
export const BLAXTAIR_MONITOR_LABEL_OCR_SUPPORTED = false;

/** Local/demo persistence boundary — no Supabase/Storage involved. */
export function serializeDraft(value: unknown): string {
  return JSON.stringify(value);
}

export function parseDraftJson<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
