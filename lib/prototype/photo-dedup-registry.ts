/**
 * Local, single-device simulation of cross-job-card photo reuse detection.
 *
 * Deliberately generic: PhotoCategory is not limited to the device label — it lists every
 * photo category a real job card eventually requires. This demo only ever writes
 * "device_label" records (the one real photo path it has), but the matching logic doesn't
 * know or care which category it's checking, exactly as it should behave in production.
 *
 * IMPORTANT BOUNDARY: this only sees photos submitted from THIS browser. Production needs a
 * global, Storage-backed fingerprint index checked at upload time across every technician and
 * device — explicit follow-up work, out of scope for this local, no-DB-writes demo. See
 * docs/Blaxtair_Demo_Duplicate_Detection.md.
 */

const REGISTRY_KEY = "blaxtair-photo-use-registry-v1";

export type PhotoCategory =
  | "device_label"
  | "power_connection"
  | "ground_connection"
  | "ignition_connection"
  | "device_mounting"
  | "camera_mounting"
  | "camera_view"
  | "equipment_label"
  | "vin"
  | "odometer"
  | "vehicle_overview"
  | "completed_installation"
  | "other";

export type PhotoUseRecord = {
  fingerprint: string;
  jobCardId: string;
  category: PhotoCategory;
  fieldLabel: string;
  usedAt: string;
};

/** Same fingerprint used anywhere on a DIFFERENT job card. */
export function findPhotoReuse(
  records: PhotoUseRecord[],
  fingerprint: string,
  excludeJobCardId: string,
): PhotoUseRecord | null {
  const target = fingerprint.trim();
  if (!target) return null;
  return records.find((r) => r.jobCardId !== excludeJobCardId && r.fingerprint === target) ?? null;
}

export function upsertPhotoUseRecords(records: PhotoUseRecord[], next: PhotoUseRecord[]): PhotoUseRecord[] {
  const map = new Map(records.map((r) => [`${r.jobCardId}:${r.fingerprint}:${r.fieldLabel}`, r]));
  for (const r of next) map.set(`${r.jobCardId}:${r.fingerprint}:${r.fieldLabel}`, r);
  return [...map.values()];
}

export function loadPhotoUseRegistry(): PhotoUseRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PhotoUseRecord[]) : [];
  } catch {
    return [];
  }
}

export function savePhotoUseRegistry(records: PhotoUseRecord[]): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: true };
  try {
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(records));
    return { ok: true };
  } catch {
    return { ok: false, error: "Local storage is full — the photo record could not be saved on this device." };
  }
}
