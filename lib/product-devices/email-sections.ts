/**
 * Email/review field builders for installed product systems (node:test friendly).
 */

import { MOUNTING_LOCATION_LABELS, VIEW_DIRECTION_LABELS } from "./types.ts";
import type { InstalledProductDevice, InstalledProductSystem } from "./types.ts";
import { sortComponentsDeterministically, sortSystemsDeterministically } from "./normalize.ts";

export type SimpleEmailField = { label: string; value: string };
export type SimpleEmailSection = { id: string; title: string; fields: SimpleEmailField[] };

function dash(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return t || "—";
}

export function buildInstalledSystemEmailSections(
  systems: InstalledProductSystem[] | null | undefined,
): SimpleEmailSection[] {
  const list = sortSystemsDeterministically(Array.isArray(systems) ? systems : []);
  return list.map((system, index) => {
    const fields: SimpleEmailField[] = [
      { label: "Product", value: dash(system.displayLabel || system.productKey) },
      { label: "Installation variant", value: dash(system.installationVariant || undefined) },
      {
        label: "Detection confidence",
        value:
          typeof system.detectionConfidence === "number"
            ? String(system.detectionConfidence)
            : "—",
      },
    ];
    for (const c of sortComponentsDeterministically(system.components)) {
      fields.push({
        label: c.componentLabel,
        value: [
          c.identifiers.serialNumber ? `SN ${c.identifiers.serialNumber}` : null,
          c.identifiers.macAddress ? `MAC ${c.identifiers.macAddress}` : null,
          c.identifiers.partNumber ? `PN ${c.identifiers.partNumber}` : null,
          c.identifiers.ipAddress ? `IP ${c.identifiers.ipAddress}` : null,
          c.mountingLocation
            ? MOUNTING_LOCATION_LABELS[c.mountingLocation] || c.mountingLocation
            : null,
          c.viewDirection ? VIEW_DIRECTION_LABELS[c.viewDirection] || c.viewDirection : null,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
      });
    }
    if (system.manualFallbackReason) {
      fields.push({ label: "Manual fallback reason", value: system.manualFallbackReason });
    }
    return {
      id: `installed-system-${system.id || index}`,
      title: `Installed product ${index + 1}`,
      fields,
    };
  });
}

/** @deprecated Prefer buildInstalledSystemEmailSections */
export function buildInstalledDeviceEmailSections(
  devices: InstalledProductDevice[] | null | undefined,
): SimpleEmailSection[] {
  const installed = Array.isArray(devices) ? devices : [];
  return installed.map((device, index) => {
    const fields: SimpleEmailField[] = [
      { label: "Product", value: dash(device.productKey) },
      { label: "Installation variant", value: dash(device.installationVariant || undefined) },
      { label: "Extraction", value: dash(device.extractionSource || undefined) },
      {
        label: "Detection confidence",
        value:
          typeof device.detectionConfidence === "number"
            ? String(device.detectionConfidence)
            : "—",
      },
    ];
    const ids = device.identifiers || {};
    if (ids.activationCode) fields.push({ label: "Activation code", value: ids.activationCode });
    if (ids.serialNumber) fields.push({ label: "Serial number", value: ids.serialNumber });
    if (ids.imei) fields.push({ label: "IMEI", value: ids.imei });
    if (ids.macAddress) fields.push({ label: "MAC address", value: ids.macAddress });
    if (ids.iccid) fields.push({ label: "ICCID", value: ids.iccid });
    if (ids.deviceId) fields.push({ label: "Device ID", value: ids.deviceId });
    if (ids.partNumber) fields.push({ label: "Part number", value: ids.partNumber });
    if (ids.ipAddress) fields.push({ label: "IP address", value: ids.ipAddress });
    if (device.manualFallbackReason) {
      fields.push({ label: "Manual fallback reason", value: device.manualFallbackReason });
    }
    return {
      id: `installed-device-${device.id || index}`,
      title: `Installed device ${index + 1}`,
      fields,
    };
  });
}
