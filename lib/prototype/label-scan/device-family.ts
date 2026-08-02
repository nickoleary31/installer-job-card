/**
 * Initial rollout device-family architecture (prototype only).
 *
 * Three label-detected families:
 *  - linxup_asset_tracker (AT3)
 *  - linxup_vehicle_tracker (OBD + JBUS share the same label/device family)
 *  - linxup_linxcam (Standard LinxCam)
 *
 * Vehicle Tracker requires a technician-selected installationVariant after confirm.
 * Do not OCR-classify OBD vs JBUS from the device label.
 */

import type { InstallGuideDefinition } from "./install-guide.ts";
import { resolveInstallGuide } from "./install-guide.ts";
import type { LabelFieldKey } from "./profile.ts";

export type DeviceFamilyId =
  | "linxup_asset_tracker"
  | "linxup_vehicle_tracker"
  | "linxup_linxcam";

/** Only Vehicle Tracker needs a variant in v1. */
export type InstallationVariantId = "obd_ii" | "jbus" | "standard";

export type CableHarnessType = "obd_ii" | "jbus" | "hardwire" | "other" | null;

export type IdentifierMap = Partial<Record<LabelFieldKey, string>>;

export type InstalledDeviceRecord = {
  id: string;
  deviceFamily: DeviceFamilyId;
  /** Required for vehicle tracker; "standard" for AT3 / LinxCam. */
  installationVariant: InstallationVariantId | null;
  identifiers: IdentifierMap;
  labelPhoto: { path?: string; localPreview?: string } | null;
  extractionSource: "barcode" | "ocr" | "manual" | "mixed" | null;
  detectionConfidence: number | null;
  technicianConfirmed: boolean;
  detectionOverridden: boolean;
  detectedDeviceFamily: DeviceFamilyId | null;
  /** Snapshot of which guide was offered at install time. */
  installGuide: {
    title: string;
    version: string | null;
    usedSource: "cached" | "manufacturer" | null;
    openUrl: string | null;
  } | null;
  formData: Record<string, unknown>;
  cableHarnessType: CableHarnessType;
  installPhotos: Array<{ fieldName: string; path?: string; label?: string }>;
};

/** Shared vehicle/asset block stays outside installedDevices[]. */
export type VehicleJobCardDraftShape = {
  vehicle: {
    customer: string;
    location: string;
    year: string;
    make: string;
    model: string;
    serialVin: string;
    assetNumber: string;
    vehicleType: string;
    hoursMiles: string;
    // …contacts etc.
  };
  vehiclePhotos: Array<{ fieldName: string; path?: string }>;
  installedDevices: InstalledDeviceRecord[];
};

export type DeviceInstallVariantProfile = {
  variantId: InstallationVariantId;
  label: string;
  /** Maps to today's form registry id when dual-writing legacy submissions. */
  legacyFormId: string;
  installGuide: InstallGuideDefinition;
  /** Placeholder keys — production pulls from current LinxUp photo/field requirements. */
  requiredPhotoKeys: string[];
  requiredFormFields: string[];
  notes: string[];
};

export type DeviceFamilyProfile = {
  deviceFamily: DeviceFamilyId;
  displayName: string;
  /** Label-scan / classifier target (not OBD vs JBUS). */
  labelExtractionFormId: string;
  identifierKeys: LabelFieldKey[];
  /** When true, UI must collect installationVariant after family confirm. */
  requiresInstallationVariant: boolean;
  variants: DeviceInstallVariantProfile[];
};

const PLACEHOLDER_HELP_CENTER =
  "https://help.linxup.com/"; /* catalog reference — replace with direct guide URLs when confirmed */

function guideStub(args: {
  title: string;
  version: string;
  cachedPath: string;
  sourceUrl?: string | null;
  preferred?: "cached" | "manufacturer";
}): InstallGuideDefinition {
  return {
    title: args.title,
    sourceUrl: args.sourceUrl ?? PLACEHOLDER_HELP_CENTER,
    cachedUrl: args.cachedPath,
    documentType: "pdf",
    version: args.version,
    revision: null,
    lastVerifiedAt: null,
    preferredSource: args.preferred ?? "cached",
    fallbackSource: args.preferred === "manufacturer" ? "cached" : "manufacturer",
    disabled: false,
  };
}

export const DEVICE_FAMILY_PROFILES: DeviceFamilyProfile[] = [
  {
    deviceFamily: "linxup_asset_tracker",
    displayName: "Asset Tracker (AT3)",
    labelExtractionFormId: "linxup_asset_tracker",
    identifierKeys: ["activationCode", "serial", "imei"],
    requiresInstallationVariant: false,
    variants: [
      {
        variantId: "standard",
        label: "AT3 / Asset Tracker",
        legacyFormId: "linxup_asset_tracker",
        installGuide: guideStub({
          title: "AT3 Installation Guide",
          version: "2026-04",
          cachedPath: "/guides/linxup/at3-install-guide.pdf",
        }),
        requiredPhotoKeys: [
          "assetTrackerTag",
          "powerConnection",
          "groundConnection",
          "ignitionConnection",
          "finalInstall",
        ],
        requiredFormFields: ["powerConnectionDescription", "groundConnectionDescription", "ignitionConnectionDescription"],
        notes: ["Reuse existing Asset Tracker install section requirements."],
      },
    ],
  },
  {
    deviceFamily: "linxup_vehicle_tracker",
    displayName: "Vehicle Tracker",
    labelExtractionFormId: "linxup_vehicle_tracker",
    identifierKeys: ["activationCode", "serial", "imei"],
    requiresInstallationVariant: true,
    variants: [
      {
        variantId: "obd_ii",
        label: "OBD-II",
        legacyFormId: "linxup_vehicle_tracker",
        installGuide: guideStub({
          title: "Vehicle Tracker OBD-II Installation Guide",
          version: "2026-04",
          cachedPath: "/guides/linxup/vehicle-tracker-obd-ii-install-guide.pdf",
        }),
        requiredPhotoKeys: ["vehicleTrackerTag", "installation", "finalInstall"],
        requiredFormFields: ["obdPortConnected", "installationNotes"],
        notes: [
          "OBD-II path maps to today's Fields A (OBD port connected = Yes).",
          "Do not infer OBD vs JBUS from the device label.",
        ],
      },
      {
        variantId: "jbus",
        label: "JBUS",
        legacyFormId: "linxup_vehicle_tracker",
        installGuide: guideStub({
          title: "Vehicle Tracker JBUS Installation Guide",
          version: "2026-04",
          cachedPath: "/guides/linxup/vehicle-tracker-jbus-install-guide.pdf",
        }),
        requiredPhotoKeys: [
          "vehicleTrackerTag",
          "installation",
          "finalInstall",
          "powerConnection",
          "groundConnection",
          "ignitionConnection",
        ],
        requiredFormFields: [
          "obdPortConnected",
          "installationNotes",
          "powerConnectionDescription",
          "groundConnectionDescription",
          "ignitionConnectionDescription",
        ],
        notes: [
          "JBUS / hardwire-style path maps toward today's Fields B requirements.",
          "Store installationVariant=jbus and cableHarnessType separately from identifiers.",
        ],
      },
    ],
  },
  {
    deviceFamily: "linxup_linxcam",
    displayName: "LinxCam (Standard)",
    labelExtractionFormId: "linxup_linxcam",
    identifierKeys: ["mac", "serial"],
    requiresInstallationVariant: false,
    variants: [
      {
        variantId: "standard",
        label: "Standard LinxCam",
        legacyFormId: "linxup_linxcam",
        installGuide: guideStub({
          title: "Standard LinxCam Installation Guide",
          version: "2026-04",
          cachedPath: "/guides/linxup/linxcam-standard-install-guide.pdf",
        }),
        requiredPhotoKeys: ["linxCamTag", "installation", "finalInstall"],
        requiredFormFields: ["obdPortConnected"],
        notes: ["v1 = Standard LinxCam only; other LinxCam SKUs later from help-center catalog."],
      },
    ],
  },
];

export function getDeviceFamilyProfile(family: DeviceFamilyId): DeviceFamilyProfile {
  return DEVICE_FAMILY_PROFILES.find((p) => p.deviceFamily === family)!;
}

export function deviceFamilyFromFormId(formId: string | null | undefined): DeviceFamilyId | null {
  const id = (formId || "").trim();
  if (id === "linxup_asset_tracker") return "linxup_asset_tracker";
  if (id === "linxup_vehicle_tracker") return "linxup_vehicle_tracker";
  if (id === "linxup_linxcam") return "linxup_linxcam";
  return null;
}

export function getVariantProfile(
  family: DeviceFamilyId,
  variantId: InstallationVariantId | null | undefined,
): DeviceInstallVariantProfile | null {
  const fam = getDeviceFamilyProfile(family);
  if (!fam.requiresInstallationVariant) {
    return fam.variants.find((v) => v.variantId === "standard") || fam.variants[0] || null;
  }
  if (!variantId) return null;
  return fam.variants.find((v) => v.variantId === variantId) || null;
}

export function resolveGuideForDevice(
  family: DeviceFamilyId,
  variantId: InstallationVariantId | null,
) {
  const variant = getVariantProfile(family, variantId);
  return resolveInstallGuide(variant?.installGuide);
}

/** Admin / catalog shape for future management UI (not implemented in production yet). */
export type GuideAdminRecord = {
  deviceFamily: DeviceFamilyId;
  installationVariant: InstallationVariantId;
  guide: InstallGuideDefinition;
  /** Storage object key inside private guides bucket — never expose to clients. */
  storageObjectKey?: string;
  previousVersions?: Array<{ version: string; storageObjectKey: string; archivedAt: string }>;
};
