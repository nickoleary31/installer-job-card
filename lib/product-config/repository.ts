/**
 * Supabase repository for company_form_products (Phase 1).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyFormProductRow, ProductConfiguration } from "./types.ts";

const TABLE = "company_form_products";

export type UpsertCompanyFormProductInput = {
  companyId: string;
  productKey: string;
  displayLabel: string;
  baseFormId: string;
  sectionKey?: string;
  submissionType?: string;
  draftKey?: string;
  allowPrimary: boolean;
  allowAdditional: boolean;
  active: boolean;
  displayOrder: number;
  configuration?: ProductConfiguration;
};

function mapRow(raw: Record<string, unknown>): CompanyFormProductRow {
  return {
    id: String(raw.id || ""),
    company_id: String(raw.company_id || ""),
    product_key: String(raw.product_key || ""),
    display_label: String(raw.display_label || ""),
    base_form_id: String(raw.base_form_id || ""),
    section_key: String(raw.section_key || ""),
    submission_type: String(raw.submission_type || ""),
    draft_key: String(raw.draft_key || ""),
    allow_primary: !!raw.allow_primary,
    allow_additional: !!raw.allow_additional,
    active: !!raw.active,
    display_order: typeof raw.display_order === "number" ? raw.display_order : Number(raw.display_order) || 100,
    configuration: (raw.configuration as ProductConfiguration) || {},
    created_at: raw.created_at ? String(raw.created_at) : undefined,
    updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
  };
}

export async function fetchCompanyFormProducts(
  client: SupabaseClient,
  companyId: string,
): Promise<{ rows: CompanyFormProductRow[]; error?: string }> {
  const { data, error } = await client
    .from(TABLE)
    .select(
      "id, company_id, product_key, display_label, base_form_id, section_key, submission_type, draft_key, allow_primary, allow_additional, active, display_order, configuration, created_at, updated_at",
    )
    .eq("company_id", companyId)
    .order("display_order", { ascending: true });

  if (error) {
    return { rows: [], error: error.message };
  }
  return { rows: (data || []).map((row) => mapRow(row as Record<string, unknown>)) };
}

export async function fetchAllCompanyFormProductCounts(
  client: SupabaseClient,
): Promise<{ counts: Record<string, number>; error?: string }> {
  const { data, error } = await client.from(TABLE).select("company_id");
  if (error) return { counts: {}, error: error.message };
  const counts: Record<string, number> = {};
  for (const row of data || []) {
    const id = String((row as { company_id?: string }).company_id || "");
    if (!id) continue;
    counts[id] = (counts[id] || 0) + 1;
  }
  return { counts };
}

export async function insertCompanyFormProduct(
  client: SupabaseClient,
  input: UpsertCompanyFormProductInput,
): Promise<{ row?: CompanyFormProductRow; error?: string }> {
  const productKey = input.productKey.trim();
  const payload = {
    company_id: input.companyId,
    product_key: productKey,
    display_label: input.displayLabel.trim(),
    base_form_id: input.baseFormId.trim(),
    section_key: (input.sectionKey || productKey).trim(),
    submission_type: (input.submissionType || productKey).trim(),
    draft_key: (input.draftKey || productKey).trim(),
    allow_primary: input.allowPrimary,
    allow_additional: input.allowAdditional,
    active: input.active,
    display_order: input.displayOrder,
    configuration: input.configuration || {},
  };

  const { data, error } = await client.from(TABLE).insert(payload).select("*").maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Insert succeeded but no row returned." };
  return { row: mapRow(data as Record<string, unknown>) };
}

export async function updateCompanyFormProduct(
  client: SupabaseClient,
  args: {
    id: string;
    displayLabel: string;
    baseFormId: string;
    allowPrimary: boolean;
    allowAdditional: boolean;
    active: boolean;
    displayOrder: number;
    configuration?: ProductConfiguration;
  },
): Promise<{ row?: CompanyFormProductRow; error?: string }> {
  const payload = {
    display_label: args.displayLabel.trim(),
    base_form_id: args.baseFormId.trim(),
    allow_primary: args.allowPrimary,
    allow_additional: args.allowAdditional,
    active: args.active,
    display_order: args.displayOrder,
    configuration: args.configuration || {},
  };

  const { data, error } = await client
    .from(TABLE)
    .update(payload)
    .eq("id", args.id)
    .select("*")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Update succeeded but no row returned." };
  return { row: mapRow(data as Record<string, unknown>) };
}

export async function setCompanyFormProductActive(
  client: SupabaseClient,
  id: string,
  active: boolean,
): Promise<{ row?: CompanyFormProductRow; error?: string }> {
  const { data, error } = await client
    .from(TABLE)
    .update({ active })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Update succeeded but no row returned." };
  return { row: mapRow(data as Record<string, unknown>) };
}
