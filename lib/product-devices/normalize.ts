/**
 * Normalize legacy installedDevices[] ↔ canonical installedProductSystems[].
 * Read-time only — no DB migration.
 */

import type {
  HardwareProfileId,
  InstalledProductComponent,
  InstalledProductDevice,
  InstalledProductSystem,
  ProductComponentType,
} from "./types.ts";

function inferComponentType(productKey: string, hardwareProfileId: HardwareProfileId | null): ProductComponentType {
  if (hardwareProfileId === "blaxtair_ahd_camera_label" || productKey.includes("camera")) return "camera";
  if (hardwareProfileId === "blaxtair_ahd_monitor_label" || productKey.includes("monitor")) return "monitor";
  if (productKey.includes("linxcam") || hardwareProfileId === "linxup_linxcam_label") return "camera";
  if (productKey.includes("tracker") || hardwareProfileId?.includes("tracker") || hardwareProfileId === "linxup_at3_label") {
    return "tracker";
  }
  return "other";
}

function componentLabelFor(type: ProductComponentType, productKey: string): string {
  if (type === "camera") return "Camera";
  if (type === "monitor") return "Monitor";
  if (type === "tracker") {
    if (productKey.includes("asset")) return "Asset Tracker";
    if (productKey.includes("vehicle")) return "Vehicle Tracker";
    return "Tracker";
  }
  if (productKey.includes("linxcam")) return "LinxCam";
  return productKey || "Component";
}

export function legacyDeviceToSystem(device: InstalledProductDevice): InstalledProductSystem {
  const componentType = inferComponentType(device.productKey, device.hardwareProfileId);
  const component: InstalledProductComponent = {
    id: device.id,
    componentType,
    componentLabel: componentLabelFor(componentType, device.productKey),
    slotKey: "primary",
    hardwareProfileId: device.hardwareProfileId,
    detectedHardwareProfileId: device.detectedHardwareProfileId,
    identifiers: device.identifiers ?? {},
    labelPhoto: device.labelPhoto
      ? { ...device.labelPhoto, systemId: device.id, componentId: device.id }
      : null,
    mountingLocation: null,
    viewDirection: null,
    installPhotos: (device.installPhotos || []).map((p) => ({
      ...p,
      systemId: p.systemId || device.id,
      componentId: p.componentId || p.deviceId || device.id,
      deviceId: p.deviceId || p.componentId || device.id,
    })),
    extractionSource: device.extractionSource,
    detectionConfidence: device.detectionConfidence,
    technicianConfirmed: device.technicianConfirmed,
    detectionOverridden: device.detectionOverridden,
    identifierEdits: device.identifierEdits ?? [],
    manualFallbackReason: device.manualFallbackReason,
    manualFallbackNotes: device.manualFallbackNotes,
    installDetails: device.installDetails ?? {},
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };

  return {
    id: device.id,
    companyProductId: device.companyProductId,
    productKey: device.productKey,
    displayLabel: component.componentLabel,
    hardwareProfileId: device.hardwareProfileId,
    detectedHardwareProfileId: device.detectedHardwareProfileId,
    installationVariant: device.installationVariant,
    technicianConfirmed: device.technicianConfirmed,
    detectionConfidence: device.detectionConfidence,
    detectionOverridden: device.detectionOverridden,
    extractionSource: device.extractionSource,
    manualFallbackReason: device.manualFallbackReason,
    manualFallbackNotes: device.manualFallbackNotes,
    components: [component],
    plannedCameraCount: null,
    installDetails: {},
    installPhotos: [],
    productFileRefs: [],
    installGuide: device.installGuide,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

/** Flatten a system to Phase-1 hybrid rows (pilot dual-compat / dual-write). */
export function flattenSystemToLegacyDevices(system: InstalledProductSystem): InstalledProductDevice[] {
  const primary = system.components[0];
  if (!primary) {
    return [
      {
        id: system.id,
        companyProductId: system.companyProductId,
        productKey: system.productKey,
        hardwareProfileId: system.hardwareProfileId,
        detectedHardwareProfileId: system.detectedHardwareProfileId,
        installationVariant: system.installationVariant,
        identifiers: {},
        labelPhoto: null,
        extractionSource: system.extractionSource,
        detectionConfidence: system.detectionConfidence,
        technicianConfirmed: system.technicianConfirmed,
        detectionOverridden: system.detectionOverridden,
        identifierEdits: [],
        manualFallbackReason: system.manualFallbackReason,
        manualFallbackNotes: system.manualFallbackNotes,
        installDetails: system.installDetails ?? {},
        installPhotos: [],
        installGuide: system.installGuide,
        createdAt: system.createdAt,
        updatedAt: system.updatedAt,
      },
    ];
  }

  // One legacy hybrid per system for LinxUp dual-write (product-level),
  // using the primary component identifiers.
  return [
    {
      id: system.id,
      companyProductId: system.companyProductId,
      productKey: system.productKey,
      hardwareProfileId: system.hardwareProfileId,
      detectedHardwareProfileId: system.detectedHardwareProfileId,
      installationVariant: system.installationVariant,
      identifiers: primary.identifiers,
      labelPhoto: primary.labelPhoto,
      extractionSource: primary.extractionSource ?? system.extractionSource,
      detectionConfidence: system.detectionConfidence,
      technicianConfirmed: system.technicianConfirmed,
      detectionOverridden: system.detectionOverridden,
      identifierEdits: primary.identifierEdits,
      manualFallbackReason: system.manualFallbackReason ?? primary.manualFallbackReason,
      manualFallbackNotes: system.manualFallbackNotes ?? primary.manualFallbackNotes,
      installDetails: { ...system.installDetails, ...primary.installDetails },
      installPhotos: primary.installPhotos.map((p) => ({
        ...p,
        deviceId: p.componentId || p.deviceId || primary.id,
      })),
      installGuide: system.installGuide,
      createdAt: system.createdAt,
      updatedAt: system.updatedAt,
    },
  ];
}

export function flattenSystemsToLegacyDevices(
  systems: InstalledProductSystem[],
): InstalledProductDevice[] {
  return systems.flatMap(flattenSystemToLegacyDevices);
}

/**
 * Canonical read path: prefer installedProductSystems, else lift installedDevices.
 * Sorts systems by createdAt then id for deterministic ordering.
 */
export function normalizeInstalledProductSystems(args: {
  installedProductSystems?: InstalledProductSystem[] | null;
  installedDevices?: InstalledProductDevice[] | null;
}): InstalledProductSystem[] {
  const systems = Array.isArray(args.installedProductSystems)
    ? args.installedProductSystems.filter((s) => s?.id)
    : [];
  if (systems.length > 0) {
    return sortSystemsDeterministically(systems.map(ensureSystemShape));
  }
  const legacy = Array.isArray(args.installedDevices) ? args.installedDevices.filter((d) => d?.id) : [];
  return sortSystemsDeterministically(legacy.map(legacyDeviceToSystem));
}

function ensureSystemShape(system: InstalledProductSystem): InstalledProductSystem {
  const components = Array.isArray(system.components) ? system.components : [];
  return {
    ...system,
    components: components.map((c) => ({
      ...c,
      installPhotos: (c.installPhotos || []).map((p) => ({
        ...p,
        systemId: p.systemId || system.id,
        componentId: p.componentId || p.deviceId || c.id,
        deviceId: p.deviceId || p.componentId || c.id,
      })),
      labelPhoto: c.labelPhoto
        ? { ...c.labelPhoto, systemId: c.labelPhoto.systemId || system.id, componentId: c.labelPhoto.componentId || c.id }
        : null,
    })),
    productFileRefs: system.productFileRefs ?? [],
    installPhotos: system.installPhotos ?? [],
  };
}

export function sortSystemsDeterministically(
  systems: InstalledProductSystem[],
): InstalledProductSystem[] {
  return systems.slice().sort((a, b) => {
    const ca = a.createdAt || "";
    const cb = b.createdAt || "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function sortComponentsDeterministically(
  components: InstalledProductComponent[],
): InstalledProductComponent[] {
  return components.slice().sort((a, b) => {
    if (a.slotKey !== b.slotKey) return a.slotKey < b.slotKey ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
