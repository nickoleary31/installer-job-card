/**
 * Durable merge for installed product systems — protect against thin autosave.
 * Ownership by system UUID + component UUID, never array index alone.
 */

import { sortSystemsDeterministically } from "./normalize.ts";
import type { InstalledProductComponent, InstalledProductDevice, InstalledProductSystem } from "./types.ts";

export type MergeInstalledSystemsResult = {
  merged: InstalledProductSystem[];
  thinPayloadProtected: boolean;
};

function byIdSystems(list: InstalledProductSystem[]): Map<string, InstalledProductSystem> {
  const m = new Map<string, InstalledProductSystem>();
  for (const s of list) {
    if (s?.id) m.set(s.id, s);
  }
  return m;
}

function mergeComponents(
  cloud: InstalledProductComponent[],
  memory: InstalledProductComponent[],
): InstalledProductComponent[] {
  const map = new Map<string, InstalledProductComponent>();
  for (const c of cloud) {
    if (c?.id) map.set(c.id, c);
  }
  for (const c of memory) {
    if (c?.id) map.set(c.id, c);
  }
  const ordered: InstalledProductComponent[] = [];
  const seen = new Set<string>();
  for (const c of memory) {
    if (!c?.id) continue;
    ordered.push(map.get(c.id)!);
    seen.add(c.id);
  }
  for (const c of cloud) {
    if (c?.id && !seen.has(c.id)) ordered.push(c);
  }
  return ordered;
}

export function mergeDurableInstalledSystems(args: {
  cloudSystems: InstalledProductSystem[];
  memorySystems: InstalledProductSystem[];
  allowClear?: boolean;
}): MergeInstalledSystemsResult {
  const cloud = Array.isArray(args.cloudSystems) ? args.cloudSystems.filter((s) => s?.id) : [];
  const memory = Array.isArray(args.memorySystems) ? args.memorySystems.filter((s) => s?.id) : [];

  if (memory.length === 0 && cloud.length > 0 && !args.allowClear) {
    return { merged: sortSystemsDeterministically(cloud), thinPayloadProtected: true };
  }

  if (args.allowClear && memory.length === 0) {
    return { merged: [], thinPayloadProtected: false };
  }

  const cloudMap = byIdSystems(cloud);
  const mergedMap = new Map<string, InstalledProductSystem>();

  for (const s of memory) {
    const cloudSys = cloudMap.get(s.id);
    if (cloudSys) {
      mergedMap.set(s.id, {
        ...cloudSys,
        ...s,
        components: mergeComponents(cloudSys.components || [], s.components || []),
        productFileRefs:
          (s.productFileRefs?.length ?? 0) > 0
            ? s.productFileRefs
            : cloudSys.productFileRefs,
      });
    } else {
      mergedMap.set(s.id, s);
    }
  }
  for (const s of cloud) {
    if (!mergedMap.has(s.id)) mergedMap.set(s.id, s);
  }

  const ordered: InstalledProductSystem[] = [];
  const seen = new Set<string>();
  for (const s of memory) {
    ordered.push(mergedMap.get(s.id)!);
    seen.add(s.id);
  }
  for (const s of cloud) {
    if (!seen.has(s.id)) ordered.push(s);
  }

  return {
    merged: sortSystemsDeterministically(ordered),
    thinPayloadProtected: cloud.length > 0 && memory.length > 0 && memory.length < cloud.length,
  };
}

/** @deprecated Prefer mergeDurableInstalledSystems */
export function mergeDurableInstalledDevices(args: {
  cloudDevices: InstalledProductDevice[];
  memoryDevices: InstalledProductDevice[];
  allowClear?: boolean;
}): { merged: InstalledProductDevice[]; thinPayloadProtected: boolean } {
  const cloud = Array.isArray(args.cloudDevices) ? args.cloudDevices.filter((d) => d?.id) : [];
  const memory = Array.isArray(args.memoryDevices) ? args.memoryDevices.filter((d) => d?.id) : [];

  if (memory.length === 0 && cloud.length > 0 && !args.allowClear) {
    return { merged: cloud, thinPayloadProtected: true };
  }
  if (args.allowClear && memory.length === 0) {
    return { merged: [], thinPayloadProtected: false };
  }

  const map = new Map<string, InstalledProductDevice>();
  for (const d of cloud) map.set(d.id, d);
  for (const d of memory) map.set(d.id, d);

  const ordered: InstalledProductDevice[] = [];
  const seen = new Set<string>();
  for (const d of memory) {
    ordered.push(map.get(d.id)!);
    seen.add(d.id);
  }
  for (const d of cloud) {
    if (!seen.has(d.id)) ordered.push(d);
  }
  return {
    merged: ordered,
    thinPayloadProtected: cloud.length > 0 && memory.length > 0 && memory.length < cloud.length,
  };
}

export function removeInstalledSystem(
  systems: InstalledProductSystem[],
  systemId: string,
): InstalledProductSystem[] {
  return systems.filter((s) => s.id !== systemId);
}

export function upsertInstalledSystem(
  systems: InstalledProductSystem[],
  system: InstalledProductSystem,
): InstalledProductSystem[] {
  const idx = systems.findIndex((s) => s.id === system.id);
  if (idx < 0) return sortSystemsDeterministically([...systems, system]);
  const next = systems.slice();
  next[idx] = system;
  return sortSystemsDeterministically(next);
}

export function removeInstalledDevice(
  devices: InstalledProductDevice[],
  deviceId: string,
): InstalledProductDevice[] {
  return devices.filter((d) => d.id !== deviceId);
}

export function upsertInstalledDevice(
  devices: InstalledProductDevice[],
  device: InstalledProductDevice,
): InstalledProductDevice[] {
  const idx = devices.findIndex((d) => d.id === device.id);
  if (idx < 0) return [...devices, device];
  const next = devices.slice();
  next[idx] = device;
  return next;
}

export function createInstalledDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function photoNamespace(args: {
  systemId: string;
  componentId: string;
  fieldName: string;
}): string {
  return `${args.systemId}/${args.componentId}/${args.fieldName}`;
}
