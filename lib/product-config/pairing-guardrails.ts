/**
 * Single-instance base-form pairing rules for Phase 1.
 * Field UIs are shared per effective section (e.g. one PPD tree) — two products
 * resolving to the same single-instance base cannot share one job card.
 */

import { getBaseFormDefinition } from "./base-forms.ts";
import {
  findNormalizedProduct,
  resolveEffectiveSectionKeyWithLookup,
  buildProductLookupMaps,
} from "./product-lookup.ts";
import type { NormalizedProductDefinition } from "./types.ts";

/**
 * Whether a base form implementation supports multiple selected product instances
 * on one card. Phase 1: none do (PPD/VAC4/CP4/Speed/etc. share one field tree).
 * Future: opt-in via base metadata or product configuration.
 */
export function baseFormSupportsMultipleInstances(baseFormId: string | null | undefined): boolean {
  const id = (baseFormId || "").trim();
  if (!id) return false;
  const base = getBaseFormDefinition(id);
  // Explicit future hook: configuration.supportsMultipleInstances on the base product itself.
  void base;
  return false;
}

export function canonicalBaseFormIdForProduct(
  product: NormalizedProductDefinition | undefined,
): string {
  if (!product) return "";
  const base = (product.baseFormId || "").trim();
  if (base) return base;
  return (product.productKey || product.sectionKey || "").trim();
}

export function selectedProductsViolateSingleInstanceBase(args: {
  products: readonly NormalizedProductDefinition[];
  primaryProductKey: string | null | undefined;
  additionalProductKeys: readonly string[] | null | undefined;
}): boolean {
  const maps = buildProductLookupMaps(args.products);
  const keys = [
    (args.primaryProductKey || "").trim(),
    ...(args.additionalProductKeys ?? []).map((k) => k.trim()).filter(Boolean),
  ].filter(Boolean);

  const byEffective = new Map<string, string[]>();
  for (const key of keys) {
    const product = findNormalizedProduct(args.products, key);
    const baseId = canonicalBaseFormIdForProduct(product);
    if (!baseId || baseFormSupportsMultipleInstances(baseId)) continue;
    const effective = resolveEffectiveSectionKeyWithLookup(key, maps) || baseId;
    const list = byEffective.get(effective) || [];
    list.push(key);
    byEffective.set(effective, list);
  }

  for (const list of byEffective.values()) {
    if (new Set(list).size > 1) return true;
  }
  return false;
}

/**
 * Admin warning: configuration could place two single-instance PPD-family (or other
 * single-instance base) products on one card. Does not rewrite saved config.
 */
export function findSingleInstancePairingConfigWarnings(
  products: readonly NormalizedProductDefinition[],
): string[] {
  const active = products.filter((p) => p.active && !p.configWarning);
  const warnings: string[] = [];

  for (const primary of active.filter((p) => p.allowPrimary)) {
    const primaryBase = canonicalBaseFormIdForProduct(primary);
    if (!primaryBase || baseFormSupportsMultipleInstances(primaryBase)) continue;

    const candidates = active.filter(
      (p) =>
        p.allowAdditional &&
        p.sectionKey !== primary.sectionKey &&
        canonicalBaseFormIdForProduct(p) === primaryBase,
    );
    if (candidates.length === 0) continue;

    const whitelist = primary.allowedAdditionalProductKeys;
    const conflicting =
      whitelist && whitelist.length > 0
        ? candidates.filter(
            (c) => whitelist.includes(c.productKey) || whitelist.includes(c.sectionKey),
          )
        : // Unrestricted pairing: any allowAdditional peer with same base is a risk
          candidates;

    if (conflicting.length === 0) continue;

    warnings.push(
      `"${primary.displayLabel}" (${primary.productKey}) can be paired with another product that uses the same single-instance base "${primaryBase}" (${conflicting
        .map((c) => c.productKey)
        .join(", ")}). Only one instance of that base can appear on a job card.`,
    );
  }

  return warnings;
}
