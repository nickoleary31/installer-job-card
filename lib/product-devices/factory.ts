/**
 * Factory helpers for Product Device systems + components.
 */

import { createInstalledDeviceId } from "./merge.ts";
import type {
  ExtractionSource,
  HardwareProfileId,
  InstallationVariantId,
  InstalledProductComponent,
  InstalledProductSystem,
  ManualFallbackReason,
  DeviceIdentifiers,
  ProductComponentType,
  ProductDeviceDefinition,
  LabelPhotoRef,
} from "./types.ts";

export function createInstalledSystemId(): string {
  return createInstalledDeviceId();
}

export function createInstalledComponentId(): string {
  return createInstalledDeviceId();
}

function primaryComponentType(def: ProductDeviceDefinition): ProductComponentType {
  if (def.multiComponent && def.componentDefinitions?.length) {
    return def.componentDefinitions[0]!.componentType;
  }
  if (def.productKey.includes("linxcam")) return "camera";
  if (def.productKey.includes("tracker") || def.productKey.includes("asset")) return "tracker";
  return "other";
}

function primaryComponentLabel(def: ProductDeviceDefinition): string {
  if (def.multiComponent && def.componentDefinitions?.length) {
    return def.componentDefinitions[0]!.displayLabel;
  }
  return def.displayLabel;
}

export function buildPrimaryComponent(args: {
  definition: ProductDeviceDefinition;
  systemId: string;
  identifiers?: DeviceIdentifiers;
  detectedHardwareProfileId?: HardwareProfileId | null;
  extractionSource?: ExtractionSource | null;
  detectionConfidence?: number | null;
  technicianConfirmed?: boolean;
  detectionOverridden?: boolean;
  manualFallbackReason?: ManualFallbackReason | null;
  manualFallbackNotes?: string;
  labelPhoto?: LabelPhotoRef | null;
  slotKey?: string;
  componentType?: ProductComponentType;
  componentLabel?: string;
  nowIso?: string;
}): InstalledProductComponent {
  const now = args.nowIso ?? new Date().toISOString();
  const id = createInstalledComponentId();
  const componentType = args.componentType ?? primaryComponentType(args.definition);
  return {
    id,
    componentType,
    componentLabel: args.componentLabel ?? primaryComponentLabel(args.definition),
    slotKey: args.slotKey ?? "primary",
    hardwareProfileId: args.definition.hardwareProfileId,
    detectedHardwareProfileId:
      args.detectedHardwareProfileId ?? args.definition.hardwareProfileId,
    identifiers: args.identifiers ?? {},
    labelPhoto: args.labelPhoto
      ? {
          ...args.labelPhoto,
          systemId: args.systemId,
          componentId: id,
          fieldName: args.labelPhoto.fieldName || "deviceLabel",
        }
      : null,
    mountingLocation: null,
    viewDirection: null,
    installPhotos: [],
    extractionSource: args.extractionSource ?? null,
    detectionConfidence: args.detectionConfidence ?? null,
    technicianConfirmed: args.technicianConfirmed ?? false,
    detectionOverridden: args.detectionOverridden ?? false,
    identifierEdits: [],
    manualFallbackReason: args.manualFallbackReason ?? null,
    manualFallbackNotes: args.manualFallbackNotes,
    installDetails: {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Simple LinxUp products: one system with one primary component.
 * Multi-component (Blaxtair): one system; caller adds more components.
 */
export function buildInstalledProductSystem(args: {
  definition: ProductDeviceDefinition;
  identifiers?: DeviceIdentifiers;
  detectedHardwareProfileId?: HardwareProfileId | null;
  installationVariant?: InstallationVariantId | null;
  extractionSource?: ExtractionSource | null;
  detectionConfidence?: number | null;
  technicianConfirmed?: boolean;
  detectionOverridden?: boolean;
  manualFallbackReason?: ManualFallbackReason | null;
  manualFallbackNotes?: string;
  labelPhoto?: LabelPhotoRef | null;
  plannedCameraCount?: number | null;
  nowIso?: string;
}): InstalledProductSystem {
  const now = args.nowIso ?? new Date().toISOString();
  const systemId = createInstalledSystemId();
  const needsVariant = args.definition.supportedInstallationVariants.some(
    (v) => v === "obd_ii" || v === "jbus",
  );
  const primary = buildPrimaryComponent({
    definition: args.definition,
    systemId,
    identifiers: args.identifiers,
    detectedHardwareProfileId: args.detectedHardwareProfileId,
    extractionSource: args.extractionSource,
    detectionConfidence: args.detectionConfidence,
    technicianConfirmed: args.technicianConfirmed,
    detectionOverridden: args.detectionOverridden,
    manualFallbackReason: args.manualFallbackReason,
    manualFallbackNotes: args.manualFallbackNotes,
    labelPhoto: args.labelPhoto,
    nowIso: now,
  });

  return {
    id: systemId,
    companyProductId: args.definition.id,
    productKey: args.definition.productKey,
    displayLabel: args.definition.displayLabel,
    hardwareProfileId: args.definition.hardwareProfileId,
    detectedHardwareProfileId:
      args.detectedHardwareProfileId ?? args.definition.hardwareProfileId,
    installationVariant: args.installationVariant ?? (needsVariant ? null : "standard"),
    technicianConfirmed: args.technicianConfirmed ?? false,
    detectionConfidence: args.detectionConfidence ?? null,
    detectionOverridden: args.detectionOverridden ?? false,
    extractionSource: args.extractionSource ?? null,
    manualFallbackReason: args.manualFallbackReason ?? null,
    manualFallbackNotes: args.manualFallbackNotes,
    components: [primary],
    plannedCameraCount: args.plannedCameraCount ?? null,
    installDetails: {},
    installPhotos: [],
    productFileRefs: [],
    installGuide: args.definition.installGuide,
    createdAt: now,
    updatedAt: now,
  };
}

/** @deprecated Use buildInstalledProductSystem — kept for older call sites. */
export function buildInstalledProductDevice(args: {
  definition: ProductDeviceDefinition;
  identifiers?: DeviceIdentifiers;
  detectedHardwareProfileId?: HardwareProfileId | null;
  installationVariant?: InstallationVariantId | null;
  extractionSource?: ExtractionSource | null;
  detectionConfidence?: number | null;
  technicianConfirmed?: boolean;
  detectionOverridden?: boolean;
  manualFallbackReason?: ManualFallbackReason | null;
  manualFallbackNotes?: string;
  labelPhoto?: LabelPhotoRef | null;
  nowIso?: string;
}) {
  const system = buildInstalledProductSystem(args);
  const primary = system.components[0]!;
  return {
    id: system.id,
    companyProductId: system.companyProductId,
    productKey: system.productKey,
    hardwareProfileId: system.hardwareProfileId,
    detectedHardwareProfileId: system.detectedHardwareProfileId,
    installationVariant: system.installationVariant,
    identifiers: primary.identifiers,
    labelPhoto: primary.labelPhoto,
    extractionSource: primary.extractionSource,
    detectionConfidence: system.detectionConfidence,
    technicianConfirmed: system.technicianConfirmed,
    detectionOverridden: system.detectionOverridden,
    identifierEdits: primary.identifierEdits,
    manualFallbackReason: system.manualFallbackReason,
    manualFallbackNotes: system.manualFallbackNotes,
    installDetails: primary.installDetails,
    installPhotos: primary.installPhotos,
    installGuide: system.installGuide,
    createdAt: system.createdAt,
    updatedAt: system.updatedAt,
  };
}
