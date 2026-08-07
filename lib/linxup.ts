/**
 * Shared LinxUp install profile field helpers.
 * Product identity comes from the form registry (form id / submission type), not device checkboxes.
 */

import {
  getFormDefinitionById,
  getFormDefinitionBySectionKey,
  isLinxUpFormId,
  isLinxUpSectionKey,
} from "./form-registry";

export const LINXUP_COMPANY_NAME = "LinxUp";

export const LINXUP_VEHICLE_TYPE_OPTIONS = [
  "Vehicle",
  "Trailer",
  "Heavy Equipment",
  "Other Asset",
] as const;

export type LinxUpVehicleType = (typeof LINXUP_VEHICLE_TYPE_OPTIONS)[number];

export const LINXUP_ASSET_TRACKER_FORM_ID = "linxup_asset_tracker";
export const LINXUP_VEHICLE_TRACKER_FORM_ID = "linxup_vehicle_tracker";
export const LINXUP_LINXCAM_FORM_ID = "linxup_linxcam";

/** Vehicle Tracker install details (OBD vs hardwired). */
export type JobCardLinxupVehicleTrackerPayload = {
  /** Yes = OBD port path (Fields A); No = hardwired path (Fields B). */
  obdPortConnected: string;
  installationNotes: string;
  /** Fields B only */
  powerConnectionDescription?: string;
  groundConnectionDescription?: string;
  ignitionConnectionDescription?: string;
};

/** LinxCam install details (OBD vs hardwired). Installation notes are Fields B only. */
export type JobCardLinxupLinxCamPayload = {
  /** Yes = OBD port path (Fields A); No = hardwired path (Fields B). */
  obdPortConnected: string;
  /** Fields B only */
  installationNotes?: string;
  powerConnectionDescription?: string;
  groundConnectionDescription?: string;
  ignitionConnectionDescription?: string;
};

/** Shared field snapshot for any LinxUp product form. */
export type JobCardLinxupPayload = {
  /** Registry form id, e.g. linxup_vehicle_tracker */
  formId: string;
  /** Same as formId for LinxUp products */
  submissionType: string;
  /** Display label from registry, e.g. Vehicle Tracker */
  productLabel: string;
  customer: string;
  location: string;
  primaryContact: string;
  contactNumber: string;
  contactEmail: string;
  /** Optional vehicle/asset year */
  year: string;
  make: string;
  model: string;
  serialVin: string;
  assetNumber: string;
  vehicleType: string;
  hoursMiles: string;
  /** Asset Tracker connection notes (when Asset Tracker is on the card). */
  powerConnectionDescription?: string;
  groundConnectionDescription?: string;
  ignitionConnectionDescription?: string;
  /** Vehicle Tracker OBD / hardwire details (when Vehicle Tracker is on the card). */
  vehicleTracker?: JobCardLinxupVehicleTrackerPayload;
  /** LinxCam OBD / hardwire details (when LinxCam is on the card). */
  linxCam?: JobCardLinxupLinxCamPayload;
  /**
   * Pilot dual-write: device identifiers from installedDevices (review/email).
   * Not used by legacy submissions.
   */
  deviceIdentifiers?: {
    activationCode?: string;
    serialNumber?: string;
    imei?: string;
    macAddress?: string;
    installationVariant?: "obd_ii" | "jbus" | "standard" | null;
  };
  installedDeviceIds?: string[];
};

export function isLinxUpVehicleType(value: string): value is LinxUpVehicleType {
  return (LINXUP_VEHICLE_TYPE_OPTIONS as readonly string[]).includes(value);
}

export function isLinxUpAssetTrackerFormId(formId: string | null | undefined): boolean {
  return (formId || "").trim() === LINXUP_ASSET_TRACKER_FORM_ID;
}

export function isLinxUpVehicleTrackerFormId(formId: string | null | undefined): boolean {
  return (formId || "").trim() === LINXUP_VEHICLE_TRACKER_FORM_ID;
}

export function isLinxUpLinxCamFormId(formId: string | null | undefined): boolean {
  return (formId || "").trim() === LINXUP_LINXCAM_FORM_ID;
}

export { isLinxUpFormId, isLinxUpSectionKey };

export function buildLinxUpPayload(args: {
  formId: string;
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
  includeAssetTrackerFields?: boolean;
  vehicleTracker?: JobCardLinxupVehicleTrackerPayload | null;
  linxCam?: JobCardLinxupLinxCamPayload | null;
}): JobCardLinxupPayload {
  const def =
    getFormDefinitionById(args.formId) || getFormDefinitionBySectionKey(args.formId);
  const formId = def?.id || args.formId;
  const base: JobCardLinxupPayload = {
    formId,
    submissionType: def?.submissionType || formId,
    productLabel: def?.label || formId,
    customer: args.customer.trim(),
    location: args.location.trim(),
    primaryContact: args.primaryContact.trim(),
    contactNumber: args.contactNumber.trim(),
    contactEmail: args.contactEmail.trim(),
    year: args.year.trim(),
    make: args.make.trim(),
    model: args.model.trim(),
    serialVin: args.serialVin.trim(),
    assetNumber: args.assetNumber.trim(),
    vehicleType: args.vehicleType.trim(),
    hoursMiles: args.hoursMiles.trim(),
  };
  if (args.includeAssetTrackerFields || isLinxUpAssetTrackerFormId(formId)) {
    base.powerConnectionDescription = (args.powerConnectionDescription || "").trim();
    base.groundConnectionDescription = (args.groundConnectionDescription || "").trim();
    base.ignitionConnectionDescription = (args.ignitionConnectionDescription || "").trim();
  }
  if (args.vehicleTracker) {
    const vt = args.vehicleTracker;
    const obd = (vt.obdPortConnected || "").trim();
    base.vehicleTracker = {
      obdPortConnected: obd,
      installationNotes: (vt.installationNotes || "").trim(),
      ...(obd === "No"
        ? {
            powerConnectionDescription: (vt.powerConnectionDescription || "").trim(),
            groundConnectionDescription: (vt.groundConnectionDescription || "").trim(),
            ignitionConnectionDescription: (vt.ignitionConnectionDescription || "").trim(),
          }
        : {}),
    };
  }
  if (args.linxCam) {
    const lc = args.linxCam;
    const obd = (lc.obdPortConnected || "").trim();
    base.linxCam = {
      obdPortConnected: obd,
      ...(obd === "No"
        ? {
            installationNotes: (lc.installationNotes || "").trim(),
            powerConnectionDescription: (lc.powerConnectionDescription || "").trim(),
            groundConnectionDescription: (lc.groundConnectionDescription || "").trim(),
            ignitionConnectionDescription: (lc.ignitionConnectionDescription || "").trim(),
          }
        : {}),
    };
  }
  return base;
}
