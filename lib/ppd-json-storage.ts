import { supabase } from "@/lib/supabase/client";

export const PPD_JSON_BUCKET = "customer-site-files";

function safeJsonFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "config.json";
}

function slugUnit(unit: string): string {
  const t = unit.trim();
  if (!t) return "unit";
  return t.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

/**
 * customer-sites/{customerId}/ppd-json/{projectId}/{unit}-{ts}-{name}
 * Falls back to "unassigned" when customerId is unavailable.
 */
export function buildPpdJsonStoragePath(args: {
  companyId: string;
  projectId: string;
  customerId: string | null;
  unitNumber: string;
  originalFileName: string;
  timestampMs?: number;
}): { storagePath: string; usedCustomerPath: boolean } {
  const ts = args.timestampMs ?? Date.now();
  const safe = safeJsonFileName(args.originalFileName);
  const u = slugUnit(args.unitNumber);
  const suffix = `${u}-${ts}-${safe}`;
  const cid = args.customerId?.trim() || "unassigned";
  return {
    storagePath: `customer-sites/${cid}/ppd-json/${args.projectId}/${suffix}`,
    usedCustomerPath: cid !== "unassigned",
  };
}

function isMissingBucketError(error: unknown): boolean {
  const maybe = error as { message?: unknown; error?: unknown };
  const message = String(maybe?.message ?? "").toLowerCase();
  const name = String(maybe?.error ?? "").toLowerCase();
  const messageIndicatesMissingBucket =
    message.includes("bucket") && (message.includes("not found") || message.includes("does not exist"));
  return messageIndicatesMissingBucket || name.includes("bucket not found");
}

export async function uploadPpdJsonFileToStorage(
  file: File,
  args: {
    companyId: string;
    projectId: string;
    customerId: string | null;
    unitNumber: string;
    make: string;
    model: string;
    notes: string;
  },
): Promise<{ storagePath: string; publicUrl: string; uploadedAt: string; usedCustomerPath: boolean }> {
  const { storagePath, usedCustomerPath } = buildPpdJsonStoragePath({
    companyId: args.companyId,
    projectId: args.projectId,
    customerId: args.customerId,
    unitNumber: args.unitNumber,
    originalFileName: file.name,
  });

  const { error: uploadError } = await supabase.storage.from(PPD_JSON_BUCKET).upload(storagePath, file, {
    upsert: false,
    contentType: file.type || "application/json",
  });
  if (uploadError) {
    if (isMissingBucketError(uploadError)) {
      throw new Error(`Missing Supabase bucket: ${PPD_JSON_BUCKET}`);
    }
    throw uploadError;
  }

  const { data: signedData } = await supabase.storage.from(PPD_JSON_BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 7);
  const publicUrl = signedData?.signedUrl || "";
  const uploadedAt = new Date().toISOString();

  return { storagePath, publicUrl, uploadedAt, usedCustomerPath };
}

export async function insertCustomerSiteFileRow(row: {
  company_id: string;
  customer_id: string | null;
  project_id: string;
  submission_id: string | null;
  file_name: string;
  storage_path: string;
  make: string | null;
  model: string | null;
  unit_number: string | null;
  notes: string | null;
  uploaded_by: string | null;
}): Promise<void> {
  const { error } = await supabase.from("customer_site_files").insert({
    company_id: row.company_id,
    customer_id: row.customer_id,
    project_id: row.project_id,
    submission_id: row.submission_id,
    file_type: "ppd_json",
    file_name: row.file_name,
    storage_path: row.storage_path,
    make: row.make,
    model: row.model,
    unit_number: row.unit_number,
    notes: row.notes,
    uploaded_by: row.uploaded_by,
  });
  if (error) throw error;
}
