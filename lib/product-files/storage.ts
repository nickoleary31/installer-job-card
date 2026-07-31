/**
 * Storage helpers for product files.
 * Reuses customer-site-files bucket; preserves shared PPD JSON path for productKey "PPD".
 */

import { supabase } from "@/lib/supabase/client";
import {
  buildPpdJsonStoragePath,
  insertCustomerSiteFileRow,
  PPD_JSON_BUCKET,
  uploadPpdJsonFileToStorage,
} from "../ppd-json-storage.ts";
import { PPD_JSON_FILE_KEY } from "./types.ts";
import type { ProductFileDefinition, UploadedProductFile } from "./types.ts";

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file.bin";
}

function slug(value: string, fallback: string): string {
  const t = value.trim();
  if (!t) return fallback;
  return t.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

/**
 * Path: customer-sites/{customerId}/product-files/{productKey}/{fileKey}/{projectId}/{unit}-{ts}-{name}
 * Exact shared PPD product (productKey "PPD") keeps the historical ppd-json path.
 */
export function buildProductFileStoragePath(args: {
  productKey: string;
  fileKey: string;
  projectId: string;
  customerId: string | null;
  unitNumber: string;
  originalFileName: string;
  timestampMs?: number;
}): { storagePath: string; usedCustomerPath: boolean } {
  const ts = args.timestampMs ?? Date.now();
  const safe = safeFileName(args.originalFileName);
  const u = slug(args.unitNumber, "unit");
  const product = slug(args.productKey, "product");
  const fileKey = slug(args.fileKey, "file");
  const cid = args.customerId?.trim() || "unassigned";
  return {
    storagePath: `customer-sites/${cid}/product-files/${product}/${fileKey}/${args.projectId}/${u}-${ts}-${safe}`,
    usedCustomerPath: cid !== "unassigned",
  };
}

export async function uploadProductFile(args: {
  file: File;
  definition: ProductFileDefinition;
  productKey: string;
  baseFormId?: string;
  companyId: string;
  projectId: string;
  customerId: string | null;
  unitNumber: string;
  make?: string;
  model?: string;
  notes?: string;
  uploadedByUserId?: string | null;
  deviceInstanceId?: string | null;
}): Promise<UploadedProductFile> {
  const isSharedPpdJsonPath =
    args.definition.key === PPD_JSON_FILE_KEY && args.productKey === "PPD";

  if (isSharedPpdJsonPath) {
    // Preserve shared PPD storage layout: customer-sites/{id}/ppd-json/{projectId}/...
    const uploaded = await uploadPpdJsonFileToStorage(args.file, {
      companyId: args.companyId,
      projectId: args.projectId,
      customerId: args.customerId,
      unitNumber: args.unitNumber,
      make: args.make || "",
      model: args.model || "",
      notes: args.notes || "",
    });
    return {
      fileKey: PPD_JSON_FILE_KEY,
      productKey: args.productKey,
      deviceInstanceId: args.deviceInstanceId ?? null,
      originalFileName: args.file.name,
      storageBucket: PPD_JSON_BUCKET,
      storagePath: uploaded.storagePath,
      mimeType: args.file.type || "application/json",
      sizeBytes: args.file.size,
      uploadedAt: uploaded.uploadedAt,
      uploadedByUserId: args.uploadedByUserId ?? null,
      displayLabel: args.definition.label,
      baseFormId: args.baseFormId || "ppd",
      downloadUrl: uploaded.publicUrl,
      includeInReview: args.definition.includeInReview,
      includeInEmail: args.definition.includeInEmail,
      make: args.make || "",
      model: args.model || "",
      unitNumber: args.unitNumber,
      notes: args.notes || "",
      companyId: args.companyId,
      projectId: args.projectId,
      customerId: args.customerId,
    };
  }

  const { storagePath } = buildProductFileStoragePath({
    productKey: args.productKey,
    fileKey: args.definition.key,
    projectId: args.projectId,
    customerId: args.customerId,
    unitNumber: args.unitNumber,
    originalFileName: args.file.name,
  });

  const { error: uploadError } = await supabase.storage.from(PPD_JSON_BUCKET).upload(storagePath, args.file, {
    upsert: false,
    contentType: args.file.type || "application/octet-stream",
  });
  if (uploadError) throw uploadError;

  const { data: signedData } = await supabase.storage
    .from(PPD_JSON_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  return {
    fileKey: args.definition.key,
    productKey: args.productKey,
    deviceInstanceId: args.deviceInstanceId ?? null,
    originalFileName: args.file.name,
    storageBucket: PPD_JSON_BUCKET,
    storagePath,
    mimeType: args.file.type || "application/octet-stream",
    sizeBytes: args.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedByUserId: args.uploadedByUserId ?? null,
    displayLabel: args.definition.label,
    baseFormId: args.baseFormId,
    downloadUrl: signedData?.signedUrl || "",
    includeInReview: args.definition.includeInReview,
    includeInEmail: args.definition.includeInEmail,
    make: args.make,
    model: args.model,
    unitNumber: args.unitNumber,
    notes: args.notes,
    companyId: args.companyId,
    projectId: args.projectId,
    customerId: args.customerId,
  };
}

/** Insert site-file metadata. Shared PPD product (productKey PPD) keeps file_type=ppd_json. */
export async function insertProductFileSiteRow(args: {
  file: UploadedProductFile;
  submissionId: string | null;
}): Promise<void> {
  const a = args.file;
  const isSharedPpdJson = a.fileKey === PPD_JSON_FILE_KEY && a.productKey === "PPD";
  const metaNotes = isSharedPpdJson
    ? a.notes || null
    : JSON.stringify({
        productKey: a.productKey,
        fileKey: a.fileKey,
        deviceInstanceId: a.deviceInstanceId ?? null,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        displayLabel: a.displayLabel,
        baseFormId: a.baseFormId ?? null,
        notes: a.notes || "",
      });

  await insertCustomerSiteFileRow({
    company_id: a.companyId || "",
    customer_id: a.customerId ?? null,
    project_id: a.projectId || "",
    submission_id: args.submissionId,
    file_name: a.originalFileName,
    storage_path: a.storagePath,
    make: a.make ?? null,
    model: a.model ?? null,
    unit_number: a.unitNumber ?? null,
    notes: metaNotes,
    uploaded_by: a.uploadedByUserId ?? null,
  });
}

/** Extended insert that sets file_type appropriately. */
export async function insertProductFileSiteRowTyped(args: {
  file: UploadedProductFile;
  submissionId: string | null;
}): Promise<void> {
  const a = args.file;
  const isSharedPpdJson = a.fileKey === PPD_JSON_FILE_KEY && a.productKey === "PPD";
  if (isSharedPpdJson) {
    await insertProductFileSiteRow(args);
    return;
  }

  const { error } = await supabase.from("customer_site_files").insert({
    company_id: a.companyId || "",
    customer_id: a.customerId ?? null,
    project_id: a.projectId || "",
    submission_id: args.submissionId,
    file_type: `product-file:${a.fileKey}`,
    file_name: a.originalFileName,
    storage_path: a.storagePath,
    make: a.make ?? null,
    model: a.model ?? null,
    unit_number: a.unitNumber ?? null,
    notes: JSON.stringify({
      productKey: a.productKey,
      fileKey: a.fileKey,
      deviceInstanceId: a.deviceInstanceId ?? null,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      displayLabel: a.displayLabel,
      baseFormId: a.baseFormId ?? null,
    }),
    uploaded_by: a.uploadedByUserId ?? null,
  });
  if (error) throw error;
}

export { buildPpdJsonStoragePath };
