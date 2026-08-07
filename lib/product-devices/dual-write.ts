/**
 * Dual-write InstalledProductDevice → legacy LinxUp payload fields for current review/email.
 */

import { flattenSystemsToLegacyDevices, sortSystemsDeterministically } from "./normalize.ts";
import type {
  InstallationVariantId,
  InstalledProductDevice,
  InstalledProductSystem,
} from "./types.ts";

const LINXUP_ASSET_TRACKER_FORM_ID = "linxup_asset_tracker";
const LINXUP_VEHICLE_TRACKER_FORM_ID = "linxup_vehicle_tracker";
const LINXUP_LINXCAM_FORM_ID = "linxup_linxcam";

export type DeviceIdentifierDualWrite = {
  activationCode?: string;
  serialNumber?: string;
  imei?: string;
  macAddress?: string;
  installationVariant?: InstallationVariantId | null;
};

/** Minimal LinxUp payload shape for dual-write (avoids Next path aliases in node:test). */
export type LinxUpDualWriteBase = {
  formId: string;
  submissionType: string;
  productLabel: string;
  customer: string;
  location: string;
  primaryContact: string;
  contactNumber: string;
  contactEmail: string;
  year: string;
  make: string;
  model: string;
  serialVin: string;
  assetNumber: string;
  vehicleType: string;
  hoursMiles: string;
  powerConnectionDescription?: string;
  groundConnectionDescription?: string;
  ignitionConnectionDescription?: string;
  vehicleTracker?: {
    obdPortConnected: string;
    installationNotes: string;
    powerConnectionDescription?: string;
    groundConnectionDescription?: string;
    ignitionConnectionDescription?: string;
  };
  linxCam?: {
    obdPortConnected: string;
    installationNotes?: string;
    powerConnectionDescription?: string;
    groundConnectionDescription?: string;
    ignitionConnectionDescription?: string;
  };
};

export type LinxUpPilotDualWriteFields = {
  deviceIdentifiers?: DeviceIdentifierDualWrite;
  installedDeviceIds?: string[];
};

export function variantToObdPortConnected(
  variant: InstallationVariantId | null | undefined,
): string {
  if (variant === "obd_ii") return "Yes";
  if (variant === "jbus") return "No";
  return "";
}

export function obdPortConnectedToVariant(obd: string | undefined): InstallationVariantId | null {
  const v = (obd ?? "").trim();
  if (v === "Yes") return "obd_ii";
  if (v === "No") return "jbus";
  return null;
}

export function dualWriteLinxUpFromInstalledDevices(args: {
  base: LinxUpDualWriteBase;
  devices: InstalledProductDevice[];
  primaryProductKey?: string | null;
}): LinxUpDualWriteBase & LinxUpPilotDualWriteFields {
  const devices = args.devices.filter((d) => d.technicianConfirmed || d.manualFallbackReason);
  const primary = args.primaryProductKey || devices[0]?.productKey || args.base.formId;

  let vehicleTracker = args.base.vehicleTracker;
  let linxCam = args.base.linxCam;
  let powerConnectionDescription = args.base.powerConnectionDescription;
  let groundConnectionDescription = args.base.groundConnectionDescription;
  let ignitionConnectionDescription = args.base.ignitionConnectionDescription;

  const identifierBag: DeviceIdentifierDualWrite = {};
  const first = devices.find((d) => d.productKey === primary) || devices[0];

  for (const d of devices) {
    if (d.productKey === LINXUP_VEHICLE_TRACKER_FORM_ID) {
      const fromInstall = d.installDetails as Partial<NonNullable<LinxUpDualWriteBase["vehicleTracker"]>>;
      vehicleTracker = {
        obdPortConnected:
          fromInstall.obdPortConnected ||
          variantToObdPortConnected(d.installationVariant) ||
          vehicleTracker?.obdPortConnected ||
          "",
        installationNotes: fromInstall.installationNotes || vehicleTracker?.installationNotes || "",
        powerConnectionDescription:
          fromInstall.powerConnectionDescription || vehicleTracker?.powerConnectionDescription,
        groundConnectionDescription:
          fromInstall.groundConnectionDescription || vehicleTracker?.groundConnectionDescription,
        ignitionConnectionDescription:
          fromInstall.ignitionConnectionDescription || vehicleTracker?.ignitionConnectionDescription,
      };
    }
    if (d.productKey === LINXUP_LINXCAM_FORM_ID) {
      const fromInstall = d.installDetails as Partial<NonNullable<LinxUpDualWriteBase["linxCam"]>>;
      linxCam = {
        obdPortConnected: fromInstall.obdPortConnected || linxCam?.obdPortConnected || "",
        installationNotes: fromInstall.installationNotes || linxCam?.installationNotes,
        powerConnectionDescription:
          fromInstall.powerConnectionDescription || linxCam?.powerConnectionDescription,
        groundConnectionDescription:
          fromInstall.groundConnectionDescription || linxCam?.groundConnectionDescription,
        ignitionConnectionDescription:
          fromInstall.ignitionConnectionDescription || linxCam?.ignitionConnectionDescription,
      };
    }
    if (d.productKey === LINXUP_ASSET_TRACKER_FORM_ID) {
      const fromInstall = d.installDetails as Record<string, string>;
      powerConnectionDescription =
        fromInstall.powerConnectionDescription || powerConnectionDescription;
      groundConnectionDescription =
        fromInstall.groundConnectionDescription || groundConnectionDescription;
      ignitionConnectionDescription =
        fromInstall.ignitionConnectionDescription || ignitionConnectionDescription;
    }
  }

  if (first) {
    if (first.identifiers.activationCode) identifierBag.activationCode = first.identifiers.activationCode;
    if (first.identifiers.serialNumber) identifierBag.serialNumber = first.identifiers.serialNumber;
    if (first.identifiers.imei) identifierBag.imei = first.identifiers.imei;
    if (first.identifiers.macAddress) identifierBag.macAddress = first.identifiers.macAddress;
    identifierBag.installationVariant = first.installationVariant;
  }

  return {
    ...args.base,
    formId: primary,
    submissionType: primary,
    vehicleTracker,
    linxCam,
    powerConnectionDescription,
    groundConnectionDescription,
    ignitionConnectionDescription,
    deviceIdentifiers: identifierBag,
    installedDeviceIds: devices.map((d) => d.id),
  };
}

export function selectedSectionsFromInstalledDevices(
  devices: InstalledProductDevice[],
): string[] {
  const keys: string[] = [];
  for (const d of devices) {
    if (!d.productKey) continue;
    if (!keys.includes(d.productKey)) keys.push(d.productKey);
  }
  return keys;
}

export function selectedSectionsFromInstalledSystems(
  systems: InstalledProductSystem[],
): string[] {
  const keys: string[] = [];
  for (const s of sortSystemsDeterministically(systems)) {
    if (!s.productKey || !s.technicianConfirmed) continue;
    if (!keys.includes(s.productKey)) keys.push(s.productKey);
  }
  return keys;
}

export function dualWriteLinxUpFromInstalledSystems(args: {
  base: LinxUpDualWriteBase;
  systems: InstalledProductSystem[];
  primaryProductKey?: string | null;
}): LinxUpDualWriteBase & LinxUpPilotDualWriteFields {
  const devices = flattenSystemsToLegacyDevices(
    args.systems.filter((s) => s.technicianConfirmed || s.manualFallbackReason),
  );
  return dualWriteLinxUpFromInstalledDevices({
    base: args.base,
    devices,
    primaryProductKey: args.primaryProductKey,
  });
}
