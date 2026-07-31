/**
 * Parse product file definitions from explicit product configuration,
 * with a shared default only for the exact registry PPD product (Matrix + Powerfleet).
 */

import type { ProductFileDefinition, ProductFileCategory } from "./types.ts";
import { PPD_JSON_FILE_KEY, PPD_PRODUCT_KEY } from "./types.ts";

const CATEGORIES = new Set<ProductFileCategory>([
  "configuration",
  "calibration",
  "commissioning",
  "diagnostic",
  "document",
  "other",
]);

/**
 * Shared PPD JSON configuration file (Matrix + Powerfleet — same hardware/workflow).
 * Not inherited by products that only set baseFormId "ppd" (e.g. Blaxtair aliases).
 */
export function ppdJsonFileDefinition(): ProductFileDefinition {
  return {
    key: PPD_JSON_FILE_KEY,
    label: "JSON Configuration File",
    description: "Upload the JSON configuration file for this PPD install.",
    category: "configuration",
    required: true,
    multiple: false,
    acceptedExtensions: [".json"],
    acceptedMimeTypes: ["application/json"],
    includeInReview: true,
    includeInEmail: true,
    productScoped: true,
    displayOrder: 10,
    active: true,
  };
}

/** Explicit configuration bag containing the shared PPD JSON file definition. */
export function ppdProductFileConfiguration(): Record<string, unknown> {
  return {
    productFileDefinitions: [ppdJsonFileDefinition()],
  };
}

/**
 * Exact shared PPD registry product: productKey "PPD" (Matrix + Powerfleet).
 *
 * Matches productKey only — not sectionKey alone (a DB row could set section_key "PPD"
 * with a different product_key) and not baseFormId. DB product_key cannot be "PPD"
 * (lowercase format constraint). When formId is present it must be "ppd".
 */
export function isExactSharedPpdProduct(args: {
  productKey?: string | null;
  sectionKey?: string | null;
  formId?: string | null;
  baseFormId?: string | null;
}): boolean {
  const productKey = (args.productKey || "").trim();
  if (productKey !== PPD_PRODUCT_KEY) return false;
  const formId = (args.formId || "").trim();
  if (formId && formId !== "ppd") return false;
  return true;
}

/**
 * Example definitions for future products — NOT enabled on production registry products.
 * Kept for tests and documentation only.
 */
export const EXAMPLE_PRODUCT_FILE_DEFINITIONS = {
  anotherJsonConfig: {
    key: "device_json_config",
    label: "Device JSON configuration",
    description: "Required JSON configuration for this install.",
    category: "configuration" as const,
    required: true,
    multiple: false,
    acceptedExtensions: [".json"],
    acceptedMimeTypes: ["application/json"],
    includeInReview: true,
    includeInEmail: true,
    productScoped: true,
    displayOrder: 10,
    active: true,
  } satisfies ProductFileDefinition,
  pdfCalibration: {
    key: "calibration_report_pdf",
    label: "Calibration report (PDF)",
    description: "Upload the calibration report PDF.",
    category: "calibration" as const,
    required: true,
    multiple: false,
    acceptedExtensions: [".pdf"],
    acceptedMimeTypes: ["application/pdf"],
    maxFileSizeBytes: 25 * 1024 * 1024,
    includeInReview: true,
    includeInEmail: true,
    productScoped: true,
    displayOrder: 20,
    active: true,
  } satisfies ProductFileDefinition,
  multiDiagnostic: {
    key: "diagnostic_logs",
    label: "Diagnostic files",
    description: "Optional diagnostic exports (multiple allowed).",
    category: "diagnostic" as const,
    required: false,
    multiple: true,
    acceptedExtensions: [".txt", ".log", ".json", ".csv"],
    acceptedMimeTypes: ["text/plain", "application/json", "text/csv"],
    maxFileSizeBytes: 10 * 1024 * 1024,
    includeInReview: true,
    includeInEmail: false,
    productScoped: true,
    displayOrder: 30,
    active: true,
  } satisfies ProductFileDefinition,
};

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

export function parseProductFileDefinition(raw: unknown): ProductFileDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const key = String(o.key || "").trim();
  const label = String(o.label || "").trim();
  if (!key || !label) return null;
  const categoryRaw = String(o.category || "other").trim() as ProductFileCategory;
  const category = CATEGORIES.has(categoryRaw) ? categoryRaw : "other";
  const extensions = asStringArray(o.acceptedExtensions).map((e) =>
    e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`,
  );
  const mimes = asStringArray(o.acceptedMimeTypes).map((m) => m.toLowerCase());
  const max =
    typeof o.maxFileSizeBytes === "number" && Number.isFinite(o.maxFileSizeBytes)
      ? Math.max(0, Math.floor(o.maxFileSizeBytes))
      : undefined;

  return {
    key,
    label,
    description: typeof o.description === "string" ? o.description : undefined,
    category,
    required: o.required !== false && o.required !== "false",
    multiple: o.multiple === true || o.multiple === "true",
    acceptedExtensions: extensions.length ? extensions : [".bin"],
    acceptedMimeTypes: mimes,
    ...(max !== undefined ? { maxFileSizeBytes: max } : {}),
    includeInReview: o.includeInReview !== false && o.includeInReview !== "false",
    includeInEmail: o.includeInEmail !== false && o.includeInEmail !== "false",
    productScoped: o.productScoped !== false && o.productScoped !== "false",
    displayOrder:
      typeof o.displayOrder === "number" && Number.isFinite(o.displayOrder)
        ? o.displayOrder
        : 100,
    active: o.active !== false && o.active !== "false",
  };
}

export function parseProductFileDefinitions(raw: unknown): ProductFileDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductFileDefinition[] = [];
  for (const item of raw) {
    const def = parseProductFileDefinition(item);
    if (def) out.push(def);
  }
  return out.sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label));
}

export function activeProductFileDefinitions(
  defs: readonly ProductFileDefinition[] | null | undefined,
): ProductFileDefinition[] {
  return (defs ?? []).filter((d) => d.active);
}

/**
 * Resolve product file definitions:
 * 1. Explicit `productFileDefinitions` (including `[]` = none) wins
 * 2. Legacy `artifactDefinitions` is read for compatibility
 * 3. Else exact shared PPD product (productKey "PPD") → shared JSON file
 * 4. Else none (PPD baseFormId aliases do not inherit)
 */
export function resolveProductFileDefinitionsForProduct(args: {
  baseFormId?: string;
  productKey: string;
  sectionKey?: string;
  formId?: string;
  configuration?: Record<string, unknown> | null;
}): ProductFileDefinition[] {
  const config = args.configuration || {};
  if (Object.prototype.hasOwnProperty.call(config, "productFileDefinitions")) {
    return activeProductFileDefinitions(parseProductFileDefinitions(config.productFileDefinitions));
  }
  if (Object.prototype.hasOwnProperty.call(config, "artifactDefinitions")) {
    return activeProductFileDefinitions(parseProductFileDefinitions(config.artifactDefinitions));
  }
  if (
    isExactSharedPpdProduct({
      productKey: args.productKey,
      sectionKey: args.sectionKey || args.productKey,
      formId: args.formId,
      baseFormId: args.baseFormId,
    })
  ) {
    return [ppdJsonFileDefinition()];
  }
  return [];
}

export { PPD_PRODUCT_KEY };
