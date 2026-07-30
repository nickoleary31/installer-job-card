/**
 * Normalized company product definitions for Form/Product Admin Phase 1.
 * Same shape whether sourced from database or hardcoded registry.
 */

import type { FormProfileId } from "../form-registry.ts";

export type ProductConfigSource = "database" | "registry";

/**
 * Product configuration JSON.
 * Known Phase 1 pairing fields are validated; additional keys are preserved for forward compatibility
 * (sections, fields, conditionals, photos, guides, OCR mapping).
 */
export type ProductConfiguration = {
  /** When set, only these product keys may be chosen as additional for this primary. */
  allowedAdditionalProductKeys?: string[];
  /** Optional cap on how many additional products may be selected. */
  maxAdditionalCount?: number;
  /** Forward-compatible extension bag — unknown keys survive read/update. */
  [key: string]: unknown;
};

export type CompanyFormProductRow = {
  id: string;
  company_id: string;
  product_key: string;
  display_label: string;
  base_form_id: string;
  section_key: string;
  submission_type: string;
  draft_key: string;
  allow_primary: boolean;
  allow_additional: boolean;
  active: boolean;
  display_order: number;
  configuration: ProductConfiguration | Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export type NormalizedProductDefinition = {
  /** Stable selection / storage id (section key). */
  productKey: string;
  displayLabel: string;
  /** Registry implementation id reused for UI/validation/email. */
  baseFormId: string;
  sectionKey: string;
  submissionType: string;
  draftKey: string;
  profileId: FormProfileId;
  allowPrimary: boolean;
  allowAdditional: boolean;
  active: boolean;
  displayOrder: number;
  /** null = any other allowAdditional peer (registry Matrix-style). */
  allowedAdditionalProductKeys: string[] | null;
  maxAdditionalCount: number | null;
  source: ProductConfigSource;
  /** Set when baseFormId is not a known registry implementation. */
  configWarning?: string;
  /** Database row id when source is database. */
  databaseId?: string;
};

export type CompanyProductResolveResult = {
  products: NormalizedProductDefinition[];
  /** Products usable in technician selection (active, no config warning). */
  selectableProducts: NormalizedProductDefinition[];
  source: ProductConfigSource;
  /** true when DB was queried and returned ≥1 row for the company. */
  usedDatabase: boolean;
  /** true when DB query failed and registry was used. */
  fellBackDueToError: boolean;
  errorMessage?: string;
  configWarnings: string[];
};

export type CompanyProductConfigMode = "registry" | "database" | "hybrid_empty";
