/**
 * Thin bridge between deprecated ppd.jsonConfigFile fields and canonical productFiles.
 *
 * productFiles is the source of truth for new drafts/submissions.
 * ppd.jsonConfigFile / jsonFileName are mirrored only so existing review/email
 * code paths keep working until they read productFiles directly.
 */

import type { JobCardPpdJsonConfigFile, JobCardPpdPayload } from "../job-card-submission.ts";
import { PPD_JSON_FILE_KEY, PPD_PRODUCT_KEY } from "./types.ts";
import type { ProductFileUploadSlot, UploadedProductFile } from "./types.ts";
import { productFileSlotId } from "./types.ts";

/** Same bucket as lib/ppd-json-storage (avoid importing supabase client in node:test). */
const PPD_JSON_BUCKET = "customer-site-files";

export function uploadedProductFileFromPpdJsonConfig(args: {
  productKey: string;
  config: JobCardPpdJsonConfigFile;
  baseFormId?: string;
}): UploadedProductFile {
  return {
    fileKey: PPD_JSON_FILE_KEY,
    productKey: args.productKey,
    originalFileName: args.config.fileName,
    storageBucket: PPD_JSON_BUCKET,
    storagePath: args.config.storagePath,
    mimeType: "application/json",
    sizeBytes: 0,
    uploadedAt: args.config.uploadedAt,
    displayLabel: "JSON Configuration File",
    baseFormId: args.baseFormId || "ppd",
    downloadUrl: args.config.publicUrl,
    includeInReview: true,
    includeInEmail: true,
    make: args.config.make,
    model: args.config.model,
    unitNumber: args.config.unitNumber,
    notes: args.config.notes,
    companyId: args.config.companyId,
    projectId: args.config.projectId,
    customerId: args.config.customerId,
  };
}

export function ppdJsonConfigFromUploadedProductFile(
  file: UploadedProductFile,
): JobCardPpdJsonConfigFile {
  return {
    fileName: file.originalFileName,
    storagePath: file.storagePath,
    publicUrl: file.downloadUrl || "",
    customerId: file.customerId ?? null,
    projectId: file.projectId || "",
    companyId: file.companyId || "",
    make: file.make || "",
    model: file.model || "",
    unitNumber: file.unitNumber || "",
    notes: file.notes || "",
    uploadedAt: file.uploadedAt,
  };
}

/** Find ppd_json_config file for a product key from a flat list. */
export function findPpdJsonProductFile(
  files: readonly UploadedProductFile[] | null | undefined,
  productKey: string,
): UploadedProductFile | undefined {
  return (files ?? []).find(
    (a) => a.productKey === productKey && a.fileKey === PPD_JSON_FILE_KEY,
  );
}

/**
 * Hydrate upload slots from productFiles (canonical).
 * Optionally reads deprecated ppd.jsonConfigFile when productFiles omit the JSON file.
 */
export function hydrateProductFileSlotsFromPayload(args: {
  productKey: string;
  productFiles?: UploadedProductFile[] | null;
  ppd?: Pick<JobCardPpdPayload, "jsonConfigFile" | "jsonFileName"> | null;
  baseFormId?: string;
}): Record<string, ProductFileUploadSlot> {
  return hydrateAllProductFileSlotsFromPayload({
    productFiles: (args.productFiles ?? []).filter((a) => a.productKey === args.productKey),
    ppd: args.ppd,
    mirrorPpdProductKey: args.productKey,
    baseFormId: args.baseFormId,
  });
}

/**
 * Hydrate slots from canonical productFiles.
 * Cheap optional fill from deprecated ppd.jsonConfigFile for the shared PPD product key.
 */
export function hydrateAllProductFileSlotsFromPayload(args: {
  productFiles?: UploadedProductFile[] | null;
  /** @deprecated Read-only bridge for mirrored ppd.jsonConfigFile */
  ppd?: Pick<JobCardPpdPayload, "jsonConfigFile" | "jsonFileName"> | null;
  /** Product key that may own mirrored ppd.jsonConfigFile (normally PPD_PRODUCT_KEY). */
  mirrorPpdProductKey?: string;
  baseFormId?: string;
}): Record<string, ProductFileUploadSlot> {
  const slots: Record<string, ProductFileUploadSlot> = {};
  for (const uploaded of args.productFiles ?? []) {
    const id = productFileSlotId({
      productKey: uploaded.productKey,
      fileKey: uploaded.fileKey,
      deviceInstanceId: uploaded.deviceInstanceId,
    });
    const existing = slots[id] || {
      fileKey: uploaded.fileKey,
      productKey: uploaded.productKey,
      deviceInstanceId: uploaded.deviceInstanceId,
      localFiles: [],
      uploaded: [],
    };
    existing.uploaded = [...existing.uploaded, uploaded];
    slots[id] = existing;
  }

  const mirrorKey = (args.mirrorPpdProductKey || PPD_PRODUCT_KEY).trim();
  if (mirrorKey && args.ppd?.jsonConfigFile) {
    const ppdSlotId = productFileSlotId({
      productKey: mirrorKey,
      fileKey: PPD_JSON_FILE_KEY,
    });
    if (!slots[ppdSlotId]) {
      const uploaded = uploadedProductFileFromPpdJsonConfig({
        productKey: mirrorKey,
        config: args.ppd.jsonConfigFile,
        baseFormId: args.baseFormId,
      });
      slots[ppdSlotId] = {
        fileKey: PPD_JSON_FILE_KEY,
        productKey: mirrorKey,
        localFiles: [],
        uploaded: [uploaded],
      };
    }
  }

  return slots;
}

/**
 * Mirror shared PPD JSON file onto deprecated ppd.jsonConfigFile / jsonFileName for email/UI.
 */
export function syncPpdPayloadWithProductFiles(args: {
  ppd: JobCardPpdPayload;
  productKey: string;
  files: readonly UploadedProductFile[];
}): JobCardPpdPayload {
  const match = findPpdJsonProductFile(args.files, args.productKey);
  if (!match) return args.ppd;
  const jsonConfigFile = ppdJsonConfigFromUploadedProductFile(match);
  return {
    ...args.ppd,
    jsonFileName: jsonConfigFile.fileName || args.ppd.jsonFileName,
    jsonConfigFile,
  };
}

/**
 * If productFiles lack PPD JSON but deprecated ppd.jsonConfigFile is present, include it.
 */
export function mergeLegacyPpdIntoProductFiles(args: {
  productKey: string;
  productFiles: UploadedProductFile[];
  ppd?: Pick<JobCardPpdPayload, "jsonConfigFile"> | null;
  baseFormId?: string;
}): UploadedProductFile[] {
  const existing = findPpdJsonProductFile(args.productFiles, args.productKey);
  if (existing || !args.ppd?.jsonConfigFile) return [...args.productFiles];
  return [
    ...args.productFiles,
    uploadedProductFileFromPpdJsonConfig({
      productKey: args.productKey,
      config: args.ppd.jsonConfigFile,
      baseFormId: args.baseFormId,
    }),
  ];
}
