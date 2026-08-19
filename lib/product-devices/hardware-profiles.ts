/**
 * Internal OCR hardware profiles vs company products.
 * Admins never need to know manufacturer profile ids — mapping is code/config.
 */

import { BLAXTAIR_AHD_PRODUCT_DEFINITION } from "./blaxtair-ahd.ts";
import { BLAXTAIR_5_PRODUCT_DEFINITION } from "./blaxtair-5.ts";
import type {
  HardwareProfileId,
  ProductDeviceDefinition,
} from "./types.ts";

const GUIDE = (title: string, openUrl: string) => ({ title, openUrl, version: null as string | null });

/** Internal OCR targets — not customer-facing product names. */
export const HARDWARE_PROFILES: Record<
  HardwareProfileId,
  {
    id: HardwareProfileId;
    labelExtractionProfileId: string;
    legacyFormIdHint: string;
    notes: string;
  }
> = {
  linxup_at3_label: {
    id: "linxup_at3_label",
    labelExtractionProfileId: "linxup_asset_tracker_label_v1",
    legacyFormIdHint: "linxup_asset_tracker",
    notes: "LinxUp AT3 / Asset Tracker device label",
  },
  linxup_vehicle_tracker_label: {
    id: "linxup_vehicle_tracker_label",
    labelExtractionProfileId: "linxup_vehicle_tracker_label_v1",
    legacyFormIdHint: "linxup_vehicle_tracker",
    notes: "Vehicle Tracker family — OBD-II vs JBUS is technician-selected after confirm",
  },
  linxup_linxcam_label: {
    id: "linxup_linxcam_label",
    labelExtractionProfileId: "linxup_linxcam_label_v1",
    legacyFormIdHint: "linxup_linxcam",
    notes: "Standard LinxCam label (MAC + serial)",
  },
  blaxtair_ahd_camera_label: {
    id: "blaxtair_ahd_camera_label",
    labelExtractionProfileId: "blaxtair_ahd_camera_label_v1",
    legacyFormIdHint: "blaxtair_ahd",
    notes: "Blaxtair AHD camera label (part / serial / IP) — fixture only",
  },
  blaxtair_ahd_monitor_label: {
    id: "blaxtair_ahd_monitor_label",
    labelExtractionProfileId: "blaxtair_ahd_monitor_label_v1",
    legacyFormIdHint: "blaxtair_ahd",
    notes: "Blaxtair AHD monitor label — fixture only",
  },
  blaxtair_5_camera_label: {
    id: "blaxtair_5_camera_label",
    labelExtractionProfileId: "blaxtair_5_camera_label_v1",
    legacyFormIdHint: "blaxtair_5",
    notes: "Blaxtair 5 camera label (part / serial / IP) — fixture only",
  },
  blaxtair_5_monitor_label: {
    id: "blaxtair_5_monitor_label",
    labelExtractionProfileId: "blaxtair_5_monitor_label_v1",
    legacyFormIdHint: "blaxtair_5",
    notes: "Blaxtair 5 monitor label — fixture only",
  },
  blaxtair_5_hub_label: {
    id: "blaxtair_5_hub_label",
    labelExtractionProfileId: "blaxtair_5_hub_label_v1",
    legacyFormIdHint: "blaxtair_5",
    notes: "Blaxtair 5 camera hub label (part / serial) — fixture only",
  },
};

/**
 * LinxUp pilot company-product definitions (simple: one system → one component).
 */
export const PILOT_PRODUCT_DEVICE_DEFINITIONS: ProductDeviceDefinition[] = [
  {
    id: "def_linxup_asset_tracker",
    displayLabel: "Asset Tracker",
    hardwareProfileId: "linxup_at3_label",
    productKey: "linxup_asset_tracker",
    baseFormId: "linxup_asset_tracker",
    expectedIdentifiers: ["activationCode", "serialNumber", "imei"],
    requiredIdentifierKeys: ["activationCode", "serialNumber", "imei"],
    supportedInstallationVariants: ["standard"],
    labelExtractionProfileId: "linxup_asset_tracker_label_v1",
    installGuide: GUIDE("Asset Tracker / AT3 Install Guide", "https://help.linxup.com/"),
    requiredPhotoDefinitions: [
      { fieldName: "assetTrackerTag", label: "Asset Tracker — tag", minCount: 1 },
      { fieldName: "powerConnection", label: "Power connection", minCount: 1 },
      { fieldName: "groundConnection", label: "Ground connection", minCount: 1 },
      { fieldName: "ignitionConnection", label: "Ignition connection", minCount: 1 },
      { fieldName: "finalInstall", label: "Final install", minCount: 1 },
    ],
    active: true,
  },
  {
    id: "def_linxup_vehicle_tracker",
    displayLabel: "Vehicle Tracker",
    hardwareProfileId: "linxup_vehicle_tracker_label",
    productKey: "linxup_vehicle_tracker",
    baseFormId: "linxup_vehicle_tracker",
    expectedIdentifiers: ["activationCode", "serialNumber", "imei"],
    requiredIdentifierKeys: ["activationCode", "serialNumber", "imei"],
    supportedInstallationVariants: ["obd_ii", "jbus"],
    labelExtractionProfileId: "linxup_vehicle_tracker_label_v1",
    installGuide: GUIDE("Vehicle Tracker Install Guide", "https://help.linxup.com/"),
    requiredPhotoDefinitions: [
      { fieldName: "vehicleTrackerTag", label: "Vehicle Tracker — tag", minCount: 1 },
      { fieldName: "installation", label: "Installation", minCount: 1 },
      { fieldName: "finalInstall", label: "Final install", minCount: 1 },
    ],
    active: true,
  },
  {
    id: "def_linxup_linxcam",
    displayLabel: "LinxCam",
    hardwareProfileId: "linxup_linxcam_label",
    productKey: "linxup_linxcam",
    baseFormId: "linxup_linxcam",
    expectedIdentifiers: ["macAddress", "serialNumber"],
    requiredIdentifierKeys: ["macAddress", "serialNumber"],
    supportedInstallationVariants: ["standard"],
    labelExtractionProfileId: "linxup_linxcam_label_v1",
    installGuide: GUIDE("LinxCam Install Guide", "https://help.linxup.com/"),
    requiredPhotoDefinitions: [
      { fieldName: "linxCamTag", label: "LinxCam — tag", minCount: 1 },
      { fieldName: "installation", label: "Installation", minCount: 1 },
      { fieldName: "finalInstall", label: "Final install", minCount: 1 },
    ],
    active: true,
  },
];

/** Demo: second company product sharing the LinxCam hardware profile (mapping tests). */
export const DEMO_SHARED_HARDWARE_PRODUCT: ProductDeviceDefinition = {
  id: "def_demo_shared_camera",
  displayLabel: "Demo Shared Camera Product",
  hardwareProfileId: "linxup_linxcam_label",
  productKey: "demo_shared_camera",
  baseFormId: "linxup_linxcam",
  expectedIdentifiers: ["macAddress", "serialNumber"],
  requiredIdentifierKeys: ["macAddress", "serialNumber"],
  supportedInstallationVariants: ["standard"],
  labelExtractionProfileId: "linxup_linxcam_label_v1",
  installGuide: GUIDE("Demo Camera Guide", "https://help.linxup.com/"),
  requiredPhotoDefinitions: [],
  active: true,
};

/** Not in production pilot catalog — tests / local Blaxtair fixture only. */
export { BLAXTAIR_AHD_PRODUCT_DEFINITION, BLAXTAIR_5_PRODUCT_DEFINITION };

export function classifierFamilyToHardwareProfile(
  family: string | null | undefined,
): HardwareProfileId | null {
  switch (family) {
    case "linxup_asset_tracker":
      return "linxup_at3_label";
    case "linxup_vehicle_tracker":
      return "linxup_vehicle_tracker_label";
    case "linxup_linxcam":
      return "linxup_linxcam_label";
    case "blaxtair_ahd":
    case "blaxtair_ahd_camera":
      return "blaxtair_ahd_camera_label";
    case "blaxtair_ahd_monitor":
      return "blaxtair_ahd_monitor_label";
    case "blaxtair_5":
    case "blaxtair_5_camera":
      return "blaxtair_5_camera_label";
    case "blaxtair_5_monitor":
      return "blaxtair_5_monitor_label";
    case "blaxtair_5_hub":
      return "blaxtair_5_hub_label";
    default:
      return null;
  }
}
