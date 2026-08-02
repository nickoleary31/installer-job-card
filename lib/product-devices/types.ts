/**
 * Product Devices — system (company product) + component (physical unit).
 * Shared vehicle/asset info stays outside installedProductSystems[].
 * Product Files stay at system/product level unless explicitly component-scoped.
 */

export type HardwareProfileId =
  | "linxup_at3_label"
  | "linxup_vehicle_tracker_label"
  | "linxup_linxcam_label"
  | "blaxtair_ahd_camera_label"
  | "blaxtair_ahd_monitor_label";

export type InstallationVariantId = "obd_ii" | "jbus" | "standard";

export type ExtractionSource = "barcode" | "ocr" | "manual" | "mixed";

export type ManualFallbackReason =
  | "label_damaged"
  | "label_unreadable"
  | "camera_unavailable"
  | "unsupported_label"
  | "other";

export type ProductComponentType =
  | "camera"
  | "monitor"
  | "tracker"
  | "recorder"
  | "hub"
  | "sensor"
  | "display"
  | "gateway"
  | "other";

export type DeviceIdentifierKey =
  | "serialNumber"
  | "imei"
  | "macAddress"
  | "activationCode"
  | "iccid"
  | "deviceId"
  | "firmwareVersion"
  | "partNumber"
  | "ipAddress";

export type DeviceIdentifiers = Partial<Record<DeviceIdentifierKey, string>> & {
  /** Extensible custom identifiers without colliding with known keys. */
  custom?: Record<string, string>;
};

export type IdentifierEdit = {
  key: DeviceIdentifierKey | string;
  fromValue: string;
  toValue: string;
  editedAt: string;
  source: "technician";
};

export type LabelPhotoRef = {
  fieldName: string;
  /** Ownership namespace: system UUID / component UUID / field. */
  systemId?: string;
  componentId?: string;
  storagePath?: string;
  publicUrl?: string;
  localPreview?: string;
  originalFileName?: string;
  uploadedAt?: string;
};

export type InstallPhotoRef = {
  fieldName: string;
  systemId: string;
  componentId: string;
  /** @deprecated Prefer componentId — kept for legacy installedDevices photo rows. */
  deviceId?: string;
  storagePath?: string;
  publicUrl?: string;
  label?: string;
  uploadedAt?: string;
};

export type InstallGuideRef = {
  title: string;
  openUrl: string | null;
  version?: string | null;
};

export type MountingLocationId =
  | "front"
  | "rear"
  | "driver_side"
  | "passenger_side"
  | "left_rear"
  | "right_rear"
  | "cab_interior"
  | "boom"
  | "body_or_bed"
  | "other";

export type ViewDirectionId =
  | "forward"
  | "rearward"
  | "left"
  | "right"
  | "downward"
  | "interior"
  | "other";

export type ProductComponentDefinition = {
  componentType: ProductComponentType;
  /** Slot role, e.g. primary_camera | monitor | tracker. */
  role: string;
  displayLabel: string;
  hardwareProfileId: HardwareProfileId | null;
  expectedIdentifiers: DeviceIdentifierKey[];
  requiredIdentifierKeys: DeviceIdentifierKey[];
  minCount: number;
  maxCount: number;
  requiresMountingLocation?: boolean;
  requiresViewDirection?: boolean;
  requiredPhotoDefinitions: Array<{ fieldName: string; label: string; minCount?: number }>;
};

export type ProductDeviceDefinition = {
  id: string;
  displayLabel: string;
  /** Primary hardware profile used for first-scan product resolution. */
  hardwareProfileId: HardwareProfileId;
  /** Registry / company product key. Not a display label. */
  productKey: string;
  baseFormId: string;
  expectedIdentifiers: DeviceIdentifierKey[];
  requiredIdentifierKeys: DeviceIdentifierKey[];
  supportedInstallationVariants: InstallationVariantId[];
  labelExtractionProfileId: string;
  installGuide: InstallGuideRef;
  requiredPhotoDefinitions: Array<{ fieldName: string; label: string; minCount?: number }>;
  /** Multi-component catalog (Blaxtair AHD, etc.). Absent → single primary component. */
  componentDefinitions?: ProductComponentDefinition[];
  /** When true, first scan opens system; later scans add components. */
  multiComponent?: boolean;
  active: boolean;
};

/** Physical unit inside an installed company product/system. */
export type InstalledProductComponent = {
  id: string;
  componentType: ProductComponentType;
  componentLabel: string;
  /** Stable slot key within the system (e.g. camera_1, monitor). Not an array index. */
  slotKey: string;
  hardwareProfileId: HardwareProfileId | null;
  detectedHardwareProfileId: HardwareProfileId | null;
  identifiers: DeviceIdentifiers;
  labelPhoto: LabelPhotoRef | null;
  mountingLocation: MountingLocationId | null;
  mountingLocationOther?: string;
  viewDirection: ViewDirectionId | null;
  viewDirectionOther?: string;
  installPhotos: InstallPhotoRef[];
  extractionSource: ExtractionSource | null;
  detectionConfidence: number | null;
  technicianConfirmed: boolean;
  detectionOverridden: boolean;
  identifierEdits: IdentifierEdit[];
  manualFallbackReason: ManualFallbackReason | null;
  manualFallbackNotes?: string;
  installDetails: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

/** One installed company product / system on the vehicle job card. */
export type InstalledProductSystem = {
  id: string;
  companyProductId: string | null;
  productKey: string;
  displayLabel: string;
  hardwareProfileId: HardwareProfileId;
  detectedHardwareProfileId: HardwareProfileId | null;
  installationVariant: InstallationVariantId | null;
  technicianConfirmed: boolean;
  detectionConfidence: number | null;
  detectionOverridden: boolean;
  extractionSource: ExtractionSource | null;
  manualFallbackReason: ManualFallbackReason | null;
  manualFallbackNotes?: string;
  components: InstalledProductComponent[];
  /** Expected camera count for multi-camera systems (technician-chosen). */
  plannedCameraCount?: number | null;
  installDetails: Record<string, unknown>;
  installPhotos: InstallPhotoRef[];
  /** Product Files stay system-scoped unless a future schema marks component-scoped. */
  productFileRefs?: Array<{ fileKey: string; storagePath?: string; productKey?: string }>;
  installGuide: InstallGuideRef | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * @deprecated Phase 1 flat hybrid. Prefer InstalledProductSystem + InstalledProductComponent.
 * Still readable via normalizeInstalledProductSystems().
 */
export type InstalledProductDevice = {
  id: string;
  companyProductId: string | null;
  productKey: string;
  hardwareProfileId: HardwareProfileId;
  detectedHardwareProfileId: HardwareProfileId | null;
  installationVariant: InstallationVariantId | null;
  identifiers: DeviceIdentifiers;
  labelPhoto: LabelPhotoRef | null;
  extractionSource: ExtractionSource | null;
  detectionConfidence: number | null;
  technicianConfirmed: boolean;
  detectionOverridden: boolean;
  identifierEdits: IdentifierEdit[];
  manualFallbackReason: ManualFallbackReason | null;
  manualFallbackNotes?: string;
  installDetails: Record<string, unknown>;
  installPhotos: InstallPhotoRef[];
  installGuide: InstallGuideRef | null;
  createdAt: string;
  updatedAt: string;
};

export type HardwareToProductMatch = {
  productKey: string;
  companyProductId: string | null;
  displayLabel: string;
  baseFormId: string;
  rank: number;
  definition: ProductDeviceDefinition;
};

export type ResolveHardwareResult =
  | { status: "one"; match: HardwareToProductMatch; requireConfirmation: true }
  | { status: "multiple"; matches: HardwareToProductMatch[] }
  | { status: "none"; matches: [] }
  | { status: "low_confidence"; matches: HardwareToProductMatch[]; confidence: number };

export const MANUAL_FALLBACK_REASON_LABELS: Record<ManualFallbackReason, string> = {
  label_damaged: "Label damaged",
  label_unreadable: "Label unreadable",
  camera_unavailable: "Camera unavailable",
  unsupported_label: "Unsupported label",
  other: "Other",
};

export const MOUNTING_LOCATION_LABELS: Record<MountingLocationId, string> = {
  front: "Front",
  rear: "Rear",
  driver_side: "Driver side",
  passenger_side: "Passenger side",
  left_rear: "Left rear",
  right_rear: "Right rear",
  cab_interior: "Cab interior",
  boom: "Boom",
  body_or_bed: "Body / bed",
  other: "Other",
};

export const VIEW_DIRECTION_LABELS: Record<ViewDirectionId, string> = {
  forward: "Forward",
  rearward: "Rearward",
  left: "Left",
  right: "Right",
  downward: "Downward",
  interior: "Interior",
  other: "Other",
};
