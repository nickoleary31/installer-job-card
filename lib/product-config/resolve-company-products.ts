/**
 * Map database rows → NormalizedProductDefinition; hybrid resolve with registry fallback.
 */

import { getBaseFormDefinition } from "./base-forms.ts";
import { pairingFieldsFromConfiguration } from "./configuration.ts";
import { selectedProductsViolateSingleInstanceBase } from "./pairing-guardrails.ts";
import { resolveCompanyProductsFromRegistry } from "./registry-adapter.ts";
import { resolveProductFileDefinitionsForProduct } from "../product-files/definitions.ts";
import type {
  CompanyFormProductRow,
  CompanyProductResolveResult,
  NormalizedProductDefinition,
} from "./types.ts";

export function normalizeDatabaseProductRow(row: CompanyFormProductRow): NormalizedProductDefinition {
  const base = getBaseFormDefinition(row.base_form_id);
  const config = pairingFieldsFromConfiguration(row.configuration);
  const warning = base
    ? undefined
    : `Unknown base form "${row.base_form_id}" for product "${row.product_key}".`;

  return {
    productKey: row.product_key,
    displayLabel: row.display_label,
    baseFormId: row.base_form_id,
    sectionKey: row.section_key || row.product_key,
    submissionType: row.submission_type || row.product_key,
    draftKey: row.draft_key || row.product_key,
    profileId: base?.profileId || "legacy_hardware",
    allowPrimary: !!row.allow_primary,
    allowAdditional: !!row.allow_additional,
    active: !!row.active,
    displayOrder: Number.isFinite(row.display_order) ? row.display_order : 100,
    allowedAdditionalProductKeys: config.allowedAdditionalProductKeys ?? null,
    maxAdditionalCount: config.maxAdditionalCount ?? null,
    productFileDefinitions: resolveProductFileDefinitionsForProduct({
      baseFormId: row.base_form_id,
      productKey: row.product_key,
      sectionKey: row.section_key || row.product_key,
      // Do not pass base_form_id as formId — aliases reuse "ppd" with distinct product keys.
      configuration: (row.configuration || {}) as Record<string, unknown>,
    }),
    source: "database",
    configWarning: warning,
    databaseId: row.id,
  };
}

export function sortProducts(products: NormalizedProductDefinition[]): NormalizedProductDefinition[] {
  return [...products].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.displayLabel.localeCompare(b.displayLabel),
  );
}

export function filterSelectableProducts(
  products: NormalizedProductDefinition[],
): NormalizedProductDefinition[] {
  return products.filter((p) => p.active && !p.configWarning);
}

export function getAllowedPrimaryProducts(
  products: NormalizedProductDefinition[],
): NormalizedProductDefinition[] {
  return filterSelectableProducts(products).filter((p) => p.allowPrimary);
}

export function getAllowedAdditionalProducts(
  products: NormalizedProductDefinition[],
  primaryProductKey: string | null | undefined,
): NormalizedProductDefinition[] {
  const primaryKey = (primaryProductKey || "").trim();
  const selectable = filterSelectableProducts(products);
  const primary = selectable.find((p) => p.sectionKey === primaryKey || p.productKey === primaryKey);
  if (!primaryKey || !primary) return [];

  const candidates = selectable.filter(
    (p) => p.allowAdditional && p.sectionKey !== primary.sectionKey,
  );

  let filtered = candidates;
  if (primary.allowedAdditionalProductKeys && primary.allowedAdditionalProductKeys.length > 0) {
    const allowed = new Set(primary.allowedAdditionalProductKeys);
    filtered = candidates.filter((p) => allowed.has(p.productKey) || allowed.has(p.sectionKey));
  }

  // Hide peers that would violate single-instance base pairing with this primary.
  return filtered.filter(
    (candidate) =>
      !selectedProductsViolateSingleInstanceBase({
        products,
        primaryProductKey: primary.sectionKey,
        additionalProductKeys: [candidate.sectionKey],
      }),
  );
}

export function areAdditionalProductsAllowed(
  products: NormalizedProductDefinition[],
  primaryProductKey: string | null | undefined,
  additionalProductKeys: readonly string[] | null | undefined,
): boolean {
  const allowed = new Set(
    getAllowedAdditionalProducts(products, primaryProductKey).map((p) => p.sectionKey),
  );
  const extras = additionalProductKeys ?? [];
  if (extras.some((key) => !allowed.has(key))) return false;

  const primary = filterSelectableProducts(products).find(
    (p) => p.sectionKey === primaryProductKey || p.productKey === primaryProductKey,
  );
  if (primary?.maxAdditionalCount != null && extras.length > primary.maxAdditionalCount) {
    return false;
  }

  if (
    selectedProductsViolateSingleInstanceBase({
      products,
      primaryProductKey,
      additionalProductKeys: extras,
    })
  ) {
    return false;
  }

  return true;
}

export type FetchCompanyFormProducts = (
  companyId: string,
) => Promise<{ rows: CompanyFormProductRow[]; error?: string }>;

/**
 * Hybrid resolve:
 * 1. If DB returns ≥1 row for company → database products (override registry).
 * 2. If DB returns 0 rows → registry fallback.
 * 3. If DB request fails → registry fallback + error flag.
 *
 * Does not mutate module-global label state — callers pass products / lookup maps explicitly.
 */
export async function resolveCompanyProducts(args: {
  companyId: string | null | undefined;
  companyName: string | null | undefined;
  fetchProducts: FetchCompanyFormProducts;
}): Promise<CompanyProductResolveResult> {
  const companyId = (args.companyId || "").trim();
  const companyName = (args.companyName || "").trim();

  const registryProducts = sortProducts(resolveCompanyProductsFromRegistry(companyName));

  if (!companyId) {
    return {
      products: registryProducts,
      selectableProducts: filterSelectableProducts(registryProducts),
      source: "registry",
      usedDatabase: false,
      fellBackDueToError: false,
      configWarnings: [],
    };
  }

  let rows: CompanyFormProductRow[] = [];
  let fetchError: string | undefined;
  try {
    const result = await args.fetchProducts(companyId);
    rows = result.rows || [];
    fetchError = result.error;
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "Failed to load company form products.";
  }

  if (fetchError) {
    console.error("[product-config] database fetch failed; using registry fallback", {
      companyId,
      companyName,
      error: fetchError,
    });
    return {
      products: registryProducts,
      selectableProducts: filterSelectableProducts(registryProducts),
      source: "registry",
      usedDatabase: false,
      fellBackDueToError: true,
      errorMessage: fetchError,
      configWarnings: [],
    };
  }

  if (rows.length === 0) {
    return {
      products: registryProducts,
      selectableProducts: filterSelectableProducts(registryProducts),
      source: "registry",
      usedDatabase: false,
      fellBackDueToError: false,
      configWarnings: [],
    };
  }

  const products = sortProducts(rows.map(normalizeDatabaseProductRow));
  const configWarnings = products
    .map((p) => p.configWarning)
    .filter((w): w is string => !!w);
  for (const warning of configWarnings) {
    console.warn("[product-config]", warning, { companyId });
  }

  return {
    products,
    selectableProducts: filterSelectableProducts(products),
    source: "database",
    usedDatabase: true,
    fellBackDueToError: false,
    configWarnings,
  };
}
