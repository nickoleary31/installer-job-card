/**
 * Explicit product label / baseForm lookup maps for job-card, email, and review.
 * Prefer passing these maps over any module-global overlay.
 */

import {
  getFormDefinitionById,
  getFormDefinitionBySectionKey,
  type FormDefinition,
  type FormProfileId,
} from "../form-registry.ts";
import type { NormalizedProductDefinition } from "./types.ts";

export type ProductLookupMaps = {
  labels: Record<string, string>;
  baseFormIds: Record<string, string>;
  profiles: Record<string, FormProfileId>;
};

export type ProductDisplayContext = {
  labels: Record<string, string>;
  baseFormIds: Record<string, string>;
};

export function buildProductLookupMaps(
  products: readonly NormalizedProductDefinition[],
): ProductLookupMaps {
  const labels: Record<string, string> = {};
  const baseFormIds: Record<string, string> = {};
  const profiles: Record<string, FormProfileId> = {};
  for (const p of products) {
    const key = (p.sectionKey || p.productKey || "").trim();
    if (!key) continue;
    labels[key] = p.displayLabel;
    if (p.productKey && p.productKey !== key) {
      labels[p.productKey] = p.displayLabel;
    }
    const baseId = (p.baseFormId || "").trim();
    if (baseId) {
      baseFormIds[key] = baseId;
      if (p.productKey && p.productKey !== key) baseFormIds[p.productKey] = baseId;
    }
    profiles[key] = p.profileId;
    if (p.productKey && p.productKey !== key) profiles[p.productKey] = p.profileId;
  }
  return { labels, baseFormIds, profiles };
}

export function toProductDisplayContext(maps: ProductLookupMaps): ProductDisplayContext {
  return { labels: { ...maps.labels }, baseFormIds: { ...maps.baseFormIds } };
}

export function findNormalizedProduct(
  products: readonly NormalizedProductDefinition[],
  sectionKey: string | null | undefined,
): NormalizedProductDefinition | undefined {
  const key = (sectionKey || "").trim();
  if (!key) return undefined;
  return products.find((p) => p.sectionKey === key || p.productKey === key);
}

/**
 * Resolve the shared UI/validation section key (follows baseFormId).
 * Uses explicit product maps first, then registry definitions.
 */
export function resolveEffectiveSectionKeyWithLookup(
  sectionKey: string | null | undefined,
  maps?: ProductLookupMaps | ProductDisplayContext | null,
): string {
  if (!sectionKey) return "";
  const key = sectionKey.trim();
  if (!key) return "";

  const def = getFormDefinitionBySectionKey(key);
  if (def?.baseFormId) {
    const base = getFormDefinitionById(def.baseFormId);
    return base?.sectionKey ?? key;
  }

  const overlayBaseId = maps?.baseFormIds?.[key];
  if (overlayBaseId) {
    const base = getFormDefinitionById(overlayBaseId);
    return base?.sectionKey ?? overlayBaseId;
  }

  return key;
}

export function getProductLabelWithLookup(
  sectionKey: string | null | undefined,
  maps?: ProductLookupMaps | ProductDisplayContext | null,
): string {
  const key = (sectionKey || "").trim();
  if (!key) return "";
  const fromMaps = maps?.labels?.[key];
  if (fromMaps) return fromMaps;
  return getFormDefinitionBySectionKey(key)?.label || key;
}

export function formatSectionKeysAsLabelsWithLookup(
  sectionKeys: readonly string[] | null | undefined,
  maps?: ProductLookupMaps | ProductDisplayContext | null,
): string {
  return (sectionKeys ?? [])
    .map((key) => getProductLabelWithLookup(key, maps))
    .filter(Boolean)
    .join(", ");
}

export function selectedSectionsIncludeEffectiveWithLookup(
  selectedSections: readonly string[] | null | undefined,
  targetSectionKey: string,
  maps?: ProductLookupMaps | ProductDisplayContext | null,
): boolean {
  return (selectedSections ?? []).some(
    (s) => resolveEffectiveSectionKeyWithLookup(s, maps) === targetSectionKey,
  );
}

export function toFormDefinitionFromProduct(p: NormalizedProductDefinition): FormDefinition {
  return {
    id: p.productKey,
    label: p.displayLabel,
    submissionType: p.submissionType,
    profileId: p.profileId,
    draftKey: p.draftKey,
    sectionKey: p.sectionKey,
    displayOrder: p.displayOrder,
    active: p.active,
    baseFormId: p.baseFormId !== p.productKey ? p.baseFormId : undefined,
  };
}
