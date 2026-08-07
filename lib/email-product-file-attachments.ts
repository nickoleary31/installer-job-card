/**
 * Attach Product Files (e.g. PPD JSON) to outbound email so recipients are not
 * dependent on short-lived signed URLs persisted in the submission payload.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { JobCardSubmissionPayload } from "./job-card-submission";
import { PPD_JSON_FILE_KEY, readUploadedProductFiles, type UploadedProductFile } from "./product-files/types";

const PRODUCT_FILES_BUCKET = "customer-site-files";
/** Soft cap so oversized diagnostic dumps are skipped (still listed by filename in body). */
const MAX_PRODUCT_FILE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type ProductFileEmailAttachment = {
  content: Buffer;
  filename: string;
  contentType: string;
  storagePath: string;
  label: string;
};

export type BuildProductFileEmailAttachmentsResult = {
  attachments: ProductFileEmailAttachment[];
  attached: { fileKey: string; label: string; filename: string; storagePath: string }[];
  skipped: { fileKey: string; label: string; filename: string; storagePath: string; reason: string }[];
};

function serviceClient(existing?: SupabaseClient): SupabaseClient {
  if (existing) return existing;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for product file attachments.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function collectEmailableProductFiles(payload: JobCardSubmissionPayload): UploadedProductFile[] {
  const fromCanonical = readUploadedProductFiles(payload.productFiles).filter(
    (f) => f.includeInEmail !== false && f.storagePath?.trim() && f.originalFileName?.trim(),
  );
  if (fromCanonical.length > 0) return fromCanonical;

  const mirror = payload.ppd?.jsonConfigFile;
  if (mirror?.storagePath?.trim() && mirror.fileName?.trim()) {
    return [
      {
        fileKey: PPD_JSON_FILE_KEY,
        productKey: "PPD",
        originalFileName: mirror.fileName,
        storageBucket: PRODUCT_FILES_BUCKET,
        storagePath: mirror.storagePath,
        mimeType: "application/json",
        sizeBytes: 0,
        uploadedAt: mirror.uploadedAt || new Date().toISOString(),
        displayLabel: "JSON Configuration File",
        downloadUrl: mirror.publicUrl,
        includeInEmail: true,
        includeInReview: true,
      },
    ];
  }
  return [];
}

export async function buildProductFileEmailAttachments(
  payload: JobCardSubmissionPayload,
  options?: { supabase?: SupabaseClient },
): Promise<BuildProductFileEmailAttachmentsResult> {
  const supabase = serviceClient(options?.supabase);
  const files = collectEmailableProductFiles(payload);
  const attachments: ProductFileEmailAttachment[] = [];
  const attached: BuildProductFileEmailAttachmentsResult["attached"] = [];
  const skipped: BuildProductFileEmailAttachmentsResult["skipped"] = [];

  for (const file of files) {
    const label = file.displayLabel || "Product File";
    const filename = file.originalFileName;
    const storagePath = file.storagePath;
    try {
      const bucket = file.storageBucket?.trim() || PRODUCT_FILES_BUCKET;
      const { data, error } = await supabase.storage.from(bucket).download(storagePath);
      if (error || !data) {
        skipped.push({
          fileKey: file.fileKey,
          label,
          filename,
          storagePath,
          reason: error?.message || "download failed",
        });
        continue;
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      if (buffer.byteLength > MAX_PRODUCT_FILE_ATTACHMENT_BYTES) {
        skipped.push({
          fileKey: file.fileKey,
          label,
          filename,
          storagePath,
          reason: `file exceeds ${MAX_PRODUCT_FILE_ATTACHMENT_BYTES} byte attachment limit`,
        });
        continue;
      }
      attachments.push({
        content: buffer,
        filename,
        contentType: file.mimeType || "application/octet-stream",
        storagePath,
        label,
      });
      attached.push({ fileKey: file.fileKey, label, filename, storagePath });
    } catch (err: unknown) {
      skipped.push({
        fileKey: file.fileKey,
        label,
        filename,
        storagePath,
        reason: err instanceof Error ? err.message : "download failed",
      });
    }
  }

  return { attachments, attached, skipped };
}
