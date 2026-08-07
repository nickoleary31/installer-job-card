/**
 * Local, single-device simulation of cross-job device reuse detection.
 *
 * Modeled as an append-only INSTALLATION HISTORY (events: installed / removed / transferred /
 * reinstalled) rather than a permanent "used" flag, because equipment legitimately moves
 * between assets. "Is this device currently installed somewhere, and where" is a VIEW derived
 * from the latest event for a given device key — never a boolean stamped on the device itself.
 * getCurrentInstallation() is that derived view; the event log underneath is the source of truth.
 *
 * IMPORTANT BOUNDARY: this only sees installs completed in THIS browser (localStorage). A real
 * cross-technician / cross-device version needs a backend (device registry table + installation
 * history table) plus API routes the app checks against — explicit follow-up work, out of scope
 * for this local, no-DB-writes demo. See docs/Blaxtair_Demo_Duplicate_Detection.md for the
 * intended production schema and the exact swap-in points.
 */

import { normalizeDeviceKey } from "./blaxtair-draft.ts";

const HISTORY_KEY = "blaxtair-device-installation-history-v1";

export type DeviceInstallationStatus = "installed" | "removed" | "transferred" | "reinstalled";

export type DeviceInstallationEvent = {
  id: string;
  partNumber: string;
  serialNumber: string;
  systemId: string;
  componentId: string;
  componentLabel: string;
  status: DeviceInstallationStatus;
  installedAt: string;
  /** Set on transferred/reinstalled events when the prior system is known. */
  previousSystemId?: string | null;
};

function deviceKeyOf(e: Pick<DeviceInstallationEvent, "partNumber" | "serialNumber">): string {
  return normalizeDeviceKey(e.partNumber, e.serialNumber);
}

/** Latest event for a device key — the derived "device registry" view (current owner/status). */
export function getCurrentInstallation(
  events: DeviceInstallationEvent[],
  partNumber: string,
  serialNumber: string,
): DeviceInstallationEvent | null {
  const key = normalizeDeviceKey(partNumber, serialNumber);
  if (!serialNumber.trim()) return null;
  const matches = events
    .filter((e) => deviceKeyOf(e) === key)
    .sort((a, b) => (a.installedAt < b.installedAt ? 1 : -1));
  return matches[0] ?? null;
}

/** Full chronological history for one device key — what a device-detail admin view would show. */
export function getDeviceHistory(
  events: DeviceInstallationEvent[],
  partNumber: string,
  serialNumber: string,
): DeviceInstallationEvent[] {
  const key = normalizeDeviceKey(partNumber, serialNumber);
  return events.filter((e) => deviceKeyOf(e) === key).sort((a, b) => (a.installedAt < b.installedAt ? -1 : 1));
}

/**
 * Cross-form reuse check: is this device's CURRENT installation under a different system?
 * Returns null if never installed before, or if its current installation is this same system
 * (re-completing the same job is not reuse).
 */
export function findCrossFormInstall(
  events: DeviceInstallationEvent[],
  args: { serialNumber: string; partNumber: string; excludeSystemId: string },
): DeviceInstallationEvent | null {
  const current = getCurrentInstallation(events, args.partNumber, args.serialNumber);
  if (!current || current.systemId === args.excludeSystemId) return null;
  return current;
}

/** Pure append — history is immutable; corrections happen by appending a new event, never editing. */
export function appendInstallationEvents(
  events: DeviceInstallationEvent[],
  next: DeviceInstallationEvent[],
): DeviceInstallationEvent[] {
  return [...events, ...next];
}

export function loadInstallationHistory(): DeviceInstallationEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeviceInstallationEvent[]) : [];
  } catch {
    return [];
  }
}

export function saveInstallationHistory(events: DeviceInstallationEvent[]): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: true };
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(events));
    return { ok: true };
  } catch {
    return { ok: false, error: "Local storage is full — the install record could not be saved on this device." };
  }
}
