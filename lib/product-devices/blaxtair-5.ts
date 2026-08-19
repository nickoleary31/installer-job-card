/**
 * Blaxtair 5 multi-component product (camera(s) + monitor).
 *
 * Deliberately a standalone copy of blaxtair-ahd.ts rather than a shared/parameterized module —
 * Blaxtair 5's field/requirement set is expected to change after its first live install, and it
 * must be possible to edit those requirements here without touching Blaxtair AHD's definition.
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

export const BLAXTAIR_5_CAMERA_MIN = 1;
export const BLAXTAIR_5_CAMERA_MAX = 4;

export const BLAXTAIR_5_PRODUCT_DEFINITION: ProductDeviceDefinition = {
  id: "def_blaxtair_5",
  displayLabel: "Blaxtair 5",
  hardwareProfileId: "blaxtair_5_camera_label",
  productKey: "blaxtair_5",
  baseFormId: "blaxtair_5",
  expectedIdentifiers: ["serialNumber", "partNumber", "ipAddress"],
  requiredIdentifierKeys: ["serialNumber"],
  supportedInstallationVariants: ["standard"],
  labelExtractionProfileId: "blaxtair_5_camera_label_v1",
  installGuide: GUIDE("Blaxtair 5 Install Guide", "https://www.blaxtair.com/"),
  requiredPhotoDefinitions: [],
  multiComponent: true,
  componentDefinitions: [
    {
      componentType: "camera",
      role: "camera",
      displayLabel: "Camera",
      hardwareProfileId: "blaxtair_5_camera_label",
      expectedIdentifiers: ["serialNumber", "partNumber", "ipAddress"],
      requiredIdentifierKeys: ["serialNumber", "partNumber", "ipAddress"],
      minCount: BLAXTAIR_5_CAMERA_MIN,
      maxCount: BLAXTAIR_5_CAMERA_MAX,
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
      hardwareProfileId: "blaxtair_5_monitor_label",
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
    {
      // Only present when the technician's camera count is 2 or more — see
      // applyBlaxtair5CameraCount, which is the actual gate (minCount here is metadata only).
      componentType: "hub",
      role: "hub",
      displayLabel: "Camera Hub",
      hardwareProfileId: "blaxtair_5_hub_label",
      expectedIdentifiers: ["serialNumber", "partNumber"],
      requiredIdentifierKeys: ["serialNumber", "partNumber"],
      minCount: 0,
      maxCount: 1,
      requiresMountingLocation: false,
      requiresViewDirection: false,
      requiredPhotoDefinitions: [
        { fieldName: "label", label: "Hub label (serial / PN)", minCount: 1 },
        { fieldName: "mounting", label: "Hub mounting", minCount: 1 },
        { fieldName: "connectionPhotos", label: "Hub wire connection photos", minCount: 1 },
      ],
    },
  ],
  active: true,
};

export function blaxtair5CameraSlotKey(index1Based: number): string {
  return `camera_${index1Based}`;
}

export function blaxtair5MonitorSlotKey(): string {
  return "monitor";
}

export function blaxtair5HubSlotKey(): string {
  return "hub";
}

export function buildEmptyBlaxtair5CameraComponent(args: {
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
    slotKey: blaxtair5CameraSlotKey(args.index1Based),
    hardwareProfileId: "blaxtair_5_camera_label",
    detectedHardwareProfileId: args.detectedHardwareProfileId ?? "blaxtair_5_camera_label",
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

export function buildEmptyBlaxtair5MonitorComponent(args: {
  systemId: string;
  nowIso?: string;
}): InstalledProductComponent {
  const now = args.nowIso ?? new Date().toISOString();
  const id = createInstalledComponentId();
  return {
    id,
    componentType: "monitor",
    componentLabel: "Monitor",
    slotKey: blaxtair5MonitorSlotKey(),
    hardwareProfileId: "blaxtair_5_monitor_label",
    detectedHardwareProfileId: "blaxtair_5_monitor_label",
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

export function buildEmptyBlaxtair5HubComponent(args: {
  systemId: string;
  nowIso?: string;
}): InstalledProductComponent {
  const now = args.nowIso ?? new Date().toISOString();
  const id = createInstalledComponentId();
  return {
    id,
    componentType: "hub",
    componentLabel: "Camera Hub",
    slotKey: blaxtair5HubSlotKey(),
    hardwareProfileId: "blaxtair_5_hub_label",
    detectedHardwareProfileId: "blaxtair_5_hub_label",
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
 * After the technician chooses a camera count: keep any existing camera data, allocate
 * remaining empty camera slots + monitor. Never reuses removed slot UUIDs.
 */
export function applyBlaxtair5CameraCount(args: {
  system: InstalledProductSystem;
  cameraCount: number;
  nowIso?: string;
}): InstalledProductSystem {
  const count = Math.min(
    BLAXTAIR_5_CAMERA_MAX,
    Math.max(BLAXTAIR_5_CAMERA_MIN, Math.floor(args.cameraCount)),
  );
  const now = args.nowIso ?? new Date().toISOString();
  const existingBySlot = new Map(args.system.components.map((c) => [c.slotKey, c]));
  const cameras: InstalledProductComponent[] = [];

  for (let i = 1; i <= count; i++) {
    const key = blaxtair5CameraSlotKey(i);
    const existing = existingBySlot.get(key);
    if (existing) {
      cameras.push({
        ...existing,
        componentLabel: `Camera ${i}`,
        slotKey: key,
        updatedAt: now,
      });
    } else if (i === 1) {
      const primary =
        existingBySlot.get("primary") ||
        args.system.components.find((c) => c.componentType === "camera");
      if (primary) {
        cameras.push({
          ...primary,
          componentType: "camera",
          componentLabel: "Camera 1",
          slotKey: blaxtair5CameraSlotKey(1),
          updatedAt: now,
        });
      } else {
        cameras.push(buildEmptyBlaxtair5CameraComponent({ systemId: args.system.id, index1Based: 1, nowIso: now }));
      }
    } else {
      cameras.push(buildEmptyBlaxtair5CameraComponent({ systemId: args.system.id, index1Based: i, nowIso: now }));
    }
  }

  const monitor =
    existingBySlot.get(blaxtair5MonitorSlotKey()) ||
    args.system.components.find((c) => c.componentType === "monitor") ||
    buildEmptyBlaxtair5MonitorComponent({ systemId: args.system.id, nowIso: now });

  // Camera Hub only exists once 2+ cameras are planned — dropped (not just hidden) when the
  // technician reduces the count back to 1, mirroring how excess camera slots are dropped above.
  const hub =
    count >= 2
      ? existingBySlot.get(blaxtair5HubSlotKey()) ||
        args.system.components.find((c) => c.componentType === "hub") ||
        buildEmptyBlaxtair5HubComponent({ systemId: args.system.id, nowIso: now })
      : null;

  return {
    ...args.system,
    plannedCameraCount: count,
    components: sortComponentsDeterministically([
      ...cameras,
      { ...monitor, slotKey: blaxtair5MonitorSlotKey() },
      ...(hub ? [{ ...hub, slotKey: blaxtair5HubSlotKey() }] : []),
    ]),
    updatedAt: now,
  };
}

export function updateBlaxtair5ComponentFields(
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
      | "wireLeads"
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

export function setBlaxtair5SystemExternalAlarm(
  system: InstalledProductSystem,
  alarm: InstalledProductSystem["externalAlarm"],
): InstalledProductSystem {
  return { ...system, externalAlarm: alarm, updatedAt: new Date().toISOString() };
}

export function removeBlaxtair5ComponentById(
  system: InstalledProductSystem,
  componentId: string,
): InstalledProductSystem {
  return {
    ...system,
    components: system.components.filter((c) => c.id !== componentId),
    updatedAt: new Date().toISOString(),
  };
}

export function formatBlaxtair5SystemSummary(system: InstalledProductSystem): string[] {
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
