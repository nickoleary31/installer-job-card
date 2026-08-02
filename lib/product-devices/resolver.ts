/**
 * Map OCR hardware profiles to company products.
 * Never use display labels as identity.
 */

import { BLAXTAIR_AHD_PRODUCT_DEFINITION } from "./blaxtair-ahd.ts";
import {
  DEMO_SHARED_HARDWARE_PRODUCT,
  PILOT_PRODUCT_DEVICE_DEFINITIONS,
} from "./hardware-profiles.ts";
import type {
  HardwareProfileId,
  HardwareToProductMatch,
  ProductDeviceDefinition,
  ResolveHardwareResult,
} from "./types.ts";

export type ResolveDetectedHardwareArgs = {
  companyId: string;
  hardwareProfileId: HardwareProfileId;
  /** Optional OCR confidence 0–100. Low confidence never silently routes. */
  confidence?: number | null;
  /** When true, include demo shared-hardware product for mapping tests. */
  includeDemoSharedHardwareProduct?: boolean;
  /** When true, include Blaxtair AHD fixture (local/test only). */
  includeBlaxtairAhdFixture?: boolean;
  /** Override catalog (tests / future DB). */
  definitions?: ProductDeviceDefinition[];
  /** Confidence below this forces low_confidence (default 45 — matches prototype medium floor). */
  lowConfidenceThreshold?: number;
};

const DEFAULT_LOW = 45;

function definitionMatchesHardware(
  def: ProductDeviceDefinition,
  hardwareProfileId: HardwareProfileId,
): boolean {
  if (def.hardwareProfileId === hardwareProfileId) return true;
  return (def.componentDefinitions || []).some((c) => c.hardwareProfileId === hardwareProfileId);
}

function catalog(args: ResolveDetectedHardwareArgs): ProductDeviceDefinition[] {
  const base = args.definitions ?? PILOT_PRODUCT_DEVICE_DEFINITIONS;
  const extra: ProductDeviceDefinition[] = [];
  if (args.includeDemoSharedHardwareProduct) extra.push(DEMO_SHARED_HARDWARE_PRODUCT);
  if (args.includeBlaxtairAhdFixture) extra.push(BLAXTAIR_AHD_PRODUCT_DEFINITION);
  return [...base, ...extra];
}

function toMatch(def: ProductDeviceDefinition, rank: number): HardwareToProductMatch {
  return {
    productKey: def.productKey,
    companyProductId: def.id,
    displayLabel: def.displayLabel,
    baseFormId: def.baseFormId,
    rank,
    definition: def,
  };
}

/**
 * Resolve OCR hardware profile → company product(s) for the selected company.
 * Pilot: LinxUp definitions are global by productKey; companyId reserved for future DB maps.
 */
export function resolveDetectedHardwareToCompanyProduct(
  args: ResolveDetectedHardwareArgs,
): ResolveHardwareResult {
  void args.companyId;
  const threshold = args.lowConfidenceThreshold ?? DEFAULT_LOW;
  const matches = catalog(args)
    .filter((d) => d.active && definitionMatchesHardware(d, args.hardwareProfileId))
    .map((d, i) => toMatch(d, i + 1));

  const confidence =
    typeof args.confidence === "number" && Number.isFinite(args.confidence)
      ? args.confidence
      : null;

  if (confidence !== null && confidence < threshold) {
    return { status: "low_confidence", matches, confidence };
  }

  if (matches.length === 0) return { status: "none", matches: [] };
  if (matches.length === 1) {
    return { status: "one", match: matches[0]!, requireConfirmation: true };
  }
  return { status: "multiple", matches };
}

export function definitionRequiresInstallationVariant(def: ProductDeviceDefinition): boolean {
  return def.supportedInstallationVariants.some((v) => v === "obd_ii" || v === "jbus");
}

export function definitionIsMultiComponent(def: ProductDeviceDefinition): boolean {
  return def.multiComponent === true || (def.componentDefinitions?.length ?? 0) > 1;
}
