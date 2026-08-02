/**
 * Blaxtair AHD multi-component fixture (local/test only — not enabled in production UI flag gate).
 */

import { createInstalledComponentId } from "./factory.ts";
import { sortComponentsDeterministically } from "./normalize.ts";
import type {
  DeviceIdentifiers,
  HardwareProfileId,
  InstalledProductComponent,
  InstalledProductSystem,
  LabelPhotoRef,
  MountingLocationId,
  ProductDeviceDefinition,
  ViewDirectionId,
} from "./types.ts";

const GUIDE = (title: string, openUrl: string) => ({ title, openUrl, version: null as string | null });

export const BLAXTAIR_AHD_CAMERA_MIN = 1;
export const BLAXTAIR_AHD_CAMERA_MAX = 4;

export const BLAXTAIR_AHD_PRODUCT_DEFINITION: ProductDeviceDefinition = {
  id: "def_blaxtair_ahd_fixture",
  displayLabel: "Blaxtair AHD",
  hardwareProfileId: "blaxtair_ahd_camera_label",
  productKey: "blaxtair_ahd",
  baseFormId: "blaxtair_ahd",
  expectedIdentifiers: ["serialNumber", "partNumber", "ipAddress"],
  requiredIdentifierKeys: ["serialNumber"],
  supportedInstallationVariants: ["standard"],
  labelExtractionProfileId: "blaxtair_ahd_camera_label_v1",
  installGuide: GUIDE("Blaxtair AHD Install Guide", "https://www.blaxtair.com/"),
  requiredPhotoDefinitions: [],
  multiComponent: true,
  componentDefinitions: [
    {
      componentType: "camera",
      role: "camera",
      displayLabel: "Camera",
      hardwareProfileId: "blaxtair_ahd_camera_label",
      expectedIdentifiers: ["serialNumber", "partNumber", "ipAddress"],
      requiredIdentifierKeys: ["serialNumber", "partNumber", "ipAddress"],
      minCount: BLAXTAIR_AHD_CAMERA_MIN,
      maxCount: BLAXTAIR_AHD_CAMERA_MAX,
      requiresMountingLocation: true,
      requiresViewDirection: true,
      requiredPhotoDefinitions: [
        { fieldName: "label", label: "Camera label", minCount: 1 },
        { fieldName: "mounting", label: "Camera mounting", minCount: 1 },
        { fieldName: "cameraView", label: "Camera view / final view", minCount: 1 },
      ],
    },
    {
      componentType: "monitor",
      role: "monitor",
      displayLabel: "Monitor",
      hardwareProfileId: "blaxtair_ahd_monitor_label",
      expectedIdentifiers: ["serialNumber", "partNumber"],
      requiredIdentifierKeys: ["serialNumber"],
      minCount: 1,
      maxCount: 1,
      requiresMountingLocation: true,
      requiresViewDirection: false,
      requiredPhotoDefinitions: [
        { fieldName: "label", label: "Monitor label", minCount: 1 },
        { fieldName: "installed", label: "Monitor installed", minCount: 1 },
      ],
    },
  ],
  active: true,
};

export function cameraSlotKey(index1Based: number): string {
  return `camera_${index1Based}`;
}

export function monitorSlotKey(): string {
  return "monitor";
}

export function buildEmptyCameraComponent(args: {
  systemId: string;
  index1Based: number;
  identifiers?: DeviceIdentifiers;
  labelPhoto?: LabelPhotoRef | null;
  detectedHardwareProfileId?: HardwareProfileId | null;
  nowIso?: string;
}): InstalledProductComponent {
  const now = args.nowIso ?? new Date().toISOString();
  const id = createInstalledComponentId();
  return {
    id,
    componentType: "camera",
    componentLabel: `Camera ${args.index1Based}`,
    slotKey: cameraSlotKey(args.index1Based),
    hardwareProfileId: "blaxtair_ahd_camera_label",
    detectedHardwareProfileId: args.detectedHardwareProfileId ?? "blaxtair_ahd_camera_label",
    identifiers: args.identifiers ?? {},
    labelPhoto: args.labelPhoto
      ? {
          ...args.labelPhoto,
          systemId: args.systemId,
          componentId: id,
          fieldName: args.labelPhoto.fieldName || "label",
        }
      : null,
    mountingLocation: null,
    viewDirection: null,
    installPhotos: [],
    extractionSource: args.identifiers ? "ocr" : null,
    detectionConfidence: null,
    technicianConfirmed: false,
    detectionOverridden: false,
    identifierEdits: [],
    manualFallbackReason: null,
    installDetails: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function buildEmptyMonitorComponent(args: {
  systemId: string;
  nowIso?: string;
}): InstalledProductComponent {
  const now = args.nowIso ?? new Date().toISOString();
  const id = createInstalledComponentId();
  return {
    id,
    componentType: "monitor",
    componentLabel: "Monitor",
    slotKey: monitorSlotKey(),
    hardwareProfileId: "blaxtair_ahd_monitor_label",
    detectedHardwareProfileId: "blaxtair_ahd_monitor_label",
    identifiers: {},
    labelPhoto: null,
    mountingLocation: null,
    viewDirection: null,
    installPhotos: [],
    extractionSource: null,
    detectionConfidence: null,
    technicianConfirmed: false,
    detectionOverridden: false,
    identifierEdits: [],
    manualFallbackReason: null,
    installDetails: {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * After first camera scan + technician camera count: keep Camera 1 data,
 * allocate remaining empty camera slots + monitor. Never reuses removed slot UUIDs.
 */
export function applyBlaxtairCameraCount(args: {
  system: InstalledProductSystem;
  cameraCount: number;
  nowIso?: string;
}): InstalledProductSystem {
  const count = Math.min(
    BLAXTAIR_AHD_CAMERA_MAX,
    Math.max(BLAXTAIR_AHD_CAMERA_MIN, Math.floor(args.cameraCount)),
  );
  const now = args.nowIso ?? new Date().toISOString();
  const existingBySlot = new Map(args.system.components.map((c) => [c.slotKey, c]));
  const cameras: InstalledProductComponent[] = [];

  for (let i = 1; i <= count; i++) {
    const key = cameraSlotKey(i);
    const existing = existingBySlot.get(key);
    if (existing) {
      cameras.push({
        ...existing,
        componentLabel: `Camera ${i}`,
        slotKey: key,
        updatedAt: now,
      });
    } else if (i === 1) {
      // Promote legacy primary slot if present
      const primary =
        existingBySlot.get("primary") ||
        args.system.components.find((c) => c.componentType === "camera");
      if (primary) {
        cameras.push({
          ...primary,
          componentType: "camera",
          componentLabel: "Camera 1",
          slotKey: cameraSlotKey(1),
          updatedAt: now,
        });
      } else {
        cameras.push(buildEmptyCameraComponent({ systemId: args.system.id, index1Based: 1, nowIso: now }));
      }
    } else {
      cameras.push(buildEmptyCameraComponent({ systemId: args.system.id, index1Based: i, nowIso: now }));
    }
  }

  const monitor =
    existingBySlot.get(monitorSlotKey()) ||
    args.system.components.find((c) => c.componentType === "monitor") ||
    buildEmptyMonitorComponent({ systemId: args.system.id, nowIso: now });

  return {
    ...args.system,
    plannedCameraCount: count,
    components: sortComponentsDeterministically([...cameras, { ...monitor, slotKey: monitorSlotKey() }]),
    updatedAt: now,
  };
}

export function updateComponentFields(
  system: InstalledProductSystem,
  componentId: string,
  patch: Partial<
    Pick<
      InstalledProductComponent,
      | "identifiers"
      | "labelPhoto"
      | "mountingLocation"
      | "mountingLocationOther"
      | "viewDirection"
      | "viewDirectionOther"
      | "installPhotos"
      | "technicianConfirmed"
      | "manualFallbackReason"
      | "extractionSource"
      | "detectionConfidence"
      | "identifierEdits"
    >
  >,
): InstalledProductSystem {
  const now = new Date().toISOString();
  return {
    ...system,
    components: system.components.map((c) =>
      c.id === componentId ? { ...c, ...patch, updatedAt: now } : c,
    ),
    updatedAt: now,
  };
}

export function removeComponentById(
  system: InstalledProductSystem,
  componentId: string,
): InstalledProductSystem {
  return {
    ...system,
    components: system.components.filter((c) => c.id !== componentId),
    updatedAt: new Date().toISOString(),
  };
}

export function formatBlaxtairSystemSummary(system: InstalledProductSystem): string[] {
  const lines: string[] = [];
  for (const c of sortComponentsDeterministically(system.components)) {
    if (c.componentType === "camera") {
      const loc = formatLocation(c.mountingLocation, c.mountingLocationOther);
      const view = formatView(c.viewDirection, c.viewDirectionOther);
      lines.push(
        `${c.componentLabel} — ${loc}/${view} — ${c.identifiers.serialNumber || "—"}`,
      );
    } else if (c.componentType === "monitor") {
      const loc = formatLocation(c.mountingLocation, c.mountingLocationOther);
      lines.push(`${c.componentLabel} — ${loc} — ${c.identifiers.serialNumber || "—"}`);
    }
  }
  return lines;
}

function formatLocation(id: MountingLocationId | null | undefined, other?: string): string {
  if (!id) return "—";
  if (id === "other") return other?.trim() || "other";
  return id;
}

function formatView(id: ViewDirectionId | null | undefined, other?: string): string {
  if (!id) return "—";
  if (id === "other") return other?.trim() || "other";
  return id;
}
