/**
 * Server-side: fetch, optimize, and attach job-card photos as Resend CID inline attachments.
 */

import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildEmailAttachmentFilename } from "./email-attachment-filenames";
import type { EmailPhotoSection } from "./email-photo-sections";
import {
  HARD_MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_PHOTO_ATTACHMENT_BYTES,
  optimizeImageForEmailAttachment,
  TARGET_ATTACHMENT_BYTES,
} from "./email-photo-optimize";

export const JOB_CARD_PHOTOS_BUCKET = "job-card-photos";

export type ResendInlinePhotoAttachment = {
  content: Buffer;
  filename: string;
  contentId: string;
  contentType: string;
  originalBytes: number;
  optimizedBytes: number;
  storagePath: string;
  fieldLabel: string;
};

export type PhotoOptimizeDetail = {
  label: string;
  filename: string;
  storagePath: string;
  originalBytes: number;
  optimizedBytes: number;
  width?: number;
  height?: number;
};

export type PhotoAttachedDetail = {
  label: string;
  filename: string;
  storagePath: string;
  contentId: string;
  originalBytes: number;
  optimizedBytes: number;
};

export type PhotoFailureDetail = {
  label: string;
  filename: string;
  storagePath: string;
  reason: string;
};

export type PhotoCidAttachmentResult = {
  attachments: ResendInlinePhotoAttachment[];
  cidByStoragePath: Map<string, string>;
  /** Updated sections with attachmentDisplayName + byte stats */
  photoSections: EmailPhotoSection[];
  /** Successful optimize diagnostics (not for customer email). */
  optimized: PhotoOptimizeDetail[];
  /** Successfully attached photos with CID. */
  attached: PhotoAttachedDetail[];
  /** Soft warnings only — never successful optimizations. */
  warnings: string[];
  /** True attachment failures. */
  failures: PhotoFailureDetail[];
  attachedCount: number;
  expectedCount: number;
  skippedCount: number;
  totalOriginalBytes: number;
  totalOptimizedBytes: number;
  blocked: boolean;
};

export type BuildCidPhotoAttachmentsOptions = {
  supabase?: SupabaseClient;
  filenameContext?: { customer: string; assetNumber: string };
  allowPartialSend?: boolean;
};

function createServiceRoleStorageClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for photo attachments.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function contentIdForStoragePath(storagePath: string): string {
  const hash = createHash("sha256").update(storagePath).digest("hex").slice(0, 24);
  return `photo-${hash}`;
}

type PhotoRef = {
  storagePath: string;
  fieldLabel: string;
  sectionHeading: string;
  fieldName: string;
  sequenceInField: number;
};

export function collectPhotoRefs(sections: EmailPhotoSection[]): PhotoRef[] {
  const seen = new Set<string>();
  const refs: PhotoRef[] = [];
  for (const section of sections) {
    for (const field of section.fields) {
      let seq = 0;
      for (const photo of field.photos) {
        const path = (photo.storagePath || "").trim();
        if (!path || seen.has(path)) continue;
        seen.add(path);
        seq += 1;
        refs.push({
          storagePath: path,
          fieldLabel: field.label || photo.label,
          sectionHeading: section.heading,
          fieldName: field.fieldName,
          sequenceInField: seq,
        });
      }
    }
  }
  return refs;
}

function applyStatsToSections(
  sections: EmailPhotoSection[],
  statsByPath: Map<string, { attachmentDisplayName: string; originalBytes: number; optimizedBytes: number }>,
): EmailPhotoSection[] {
  return sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => ({
      ...field,
      photos: field.photos.map((photo) => {
        const stats = statsByPath.get(photo.storagePath);
        if (!stats) return photo;
        return {
          ...photo,
          attachmentDisplayName: stats.attachmentDisplayName,
          originalBytes: stats.originalBytes,
          optimizedBytes: stats.optimizedBytes,
        };
      }),
    })),
  }));
}

function emptyResult(sections: EmailPhotoSection[]): PhotoCidAttachmentResult {
  return {
    attachments: [],
    cidByStoragePath: new Map(),
    photoSections: sections,
    optimized: [],
    attached: [],
    warnings: [],
    failures: [],
    attachedCount: 0,
    expectedCount: 0,
    skippedCount: 0,
    totalOriginalBytes: 0,
    totalOptimizedBytes: 0,
    blocked: false,
  };
}

export async function buildCidPhotoAttachments(
  sections: EmailPhotoSection[],
  options: BuildCidPhotoAttachmentsOptions = {},
): Promise<PhotoCidAttachmentResult> {
  const refs = collectPhotoRefs(sections);
  const cidByStoragePath = new Map<string, string>();
  const attachments: ResendInlinePhotoAttachment[] = [];
  const optimized: PhotoOptimizeDetail[] = [];
  const attached: PhotoAttachedDetail[] = [];
  const warnings: string[] = [];
  const failures: PhotoFailureDetail[] = [];
  const statsByPath = new Map<
    string,
    { attachmentDisplayName: string; originalBytes: number; optimizedBytes: number }
  >();
  let totalOptimizedBytes = 0;
  let totalOriginalBytes = 0;
  let skippedCount = 0;

  const ctx = options.filenameContext ?? { customer: "Customer", assetNumber: "Unit" };

  if (refs.length === 0) {
    return emptyResult(sections);
  }

  const supabase = options.supabase ?? createServiceRoleStorageClient();

  for (const ref of refs) {
    const contentId = contentIdForStoragePath(ref.storagePath);
    const attachmentDisplayName = buildEmailAttachmentFilename({
      customer: ctx.customer,
      assetNumber: ctx.assetNumber,
      fieldLabel: ref.fieldLabel,
      sequenceInField: ref.sequenceInField,
      extension: "jpg",
    });

    const pushFailure = (reason: string, filename = attachmentDisplayName) => {
      skippedCount += 1;
      failures.push({
        label: ref.fieldLabel,
        filename,
        storagePath: ref.storagePath,
        reason,
      });
    };

    try {
      const { data, error } = await supabase.storage.from(JOB_CARD_PHOTOS_BUCKET).download(ref.storagePath);
      if (error || !data) {
        pushFailure(error?.message || "download failed");
        continue;
      }

      const raw = Buffer.from(await data.arrayBuffer());
      if (raw.byteLength === 0) {
        pushFailure("empty file");
        continue;
      }

      let optimizedImage;
      try {
        optimizedImage = await optimizeImageForEmailAttachment(raw, {
          targetBytes: TARGET_ATTACHMENT_BYTES,
          hardMaxBytes: HARD_MAX_ATTACHMENT_BYTES,
        });
      } catch (optErr) {
        const msg = optErr instanceof Error ? optErr.message : "optimization failed";
        pushFailure(msg);
        continue;
      }

      const ext = optimizedImage.extension;
      const filename =
        ext === "jpg"
          ? attachmentDisplayName.replace(/\.[^.]+$/, ".jpg")
          : attachmentDisplayName.replace(/\.[^.]+$/, ".png");

      if (totalOptimizedBytes + optimizedImage.optimizedBytes > MAX_TOTAL_PHOTO_ATTACHMENT_BYTES) {
        pushFailure(
          `total attachment size would exceed ${Math.round(MAX_TOTAL_PHOTO_ATTACHMENT_BYTES / (1024 * 1024))}MB`,
          filename,
        );
        continue;
      }

      const optimizeDetail: PhotoOptimizeDetail = {
        label: ref.fieldLabel,
        filename,
        storagePath: ref.storagePath,
        originalBytes: optimizedImage.originalBytes,
        optimizedBytes: optimizedImage.optimizedBytes,
        width: optimizedImage.width,
        height: optimizedImage.height,
      };
      optimized.push(optimizeDetail);

      attachments.push({
        content: optimizedImage.buffer,
        filename,
        contentId,
        contentType: optimizedImage.contentType,
        originalBytes: optimizedImage.originalBytes,
        optimizedBytes: optimizedImage.optimizedBytes,
        storagePath: ref.storagePath,
        fieldLabel: ref.fieldLabel,
      });
      cidByStoragePath.set(ref.storagePath, contentId);
      attached.push({
        label: ref.fieldLabel,
        filename,
        storagePath: ref.storagePath,
        contentId,
        originalBytes: optimizedImage.originalBytes,
        optimizedBytes: optimizedImage.optimizedBytes,
      });
      statsByPath.set(ref.storagePath, {
        attachmentDisplayName: filename,
        originalBytes: optimizedImage.originalBytes,
        optimizedBytes: optimizedImage.optimizedBytes,
      });
      totalOptimizedBytes += optimizedImage.optimizedBytes;
      totalOriginalBytes += optimizedImage.originalBytes;
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      pushFailure(message);
    }
  }

  const blocked = failures.length > 0 && !options.allowPartialSend;
  const photoSections = applyStatsToSections(sections, statsByPath);

  if (optimized.length > 0) {
    console.info(
      "[email-photos] optimized successfully",
      optimized.map((o) => ({
        label: o.label,
        filename: o.filename,
        originalMB: Number((o.originalBytes / (1024 * 1024)).toFixed(2)),
        optimizedKB: Math.round(o.optimizedBytes / 1024),
      })),
    );
  }
  if (failures.length > 0) {
    console.warn(
      "[email-photos] attachment failures",
      failures.map((f) => ({ label: f.label, filename: f.filename, reason: f.reason })),
    );
  }

  return {
    attachments,
    cidByStoragePath,
    photoSections,
    optimized,
    attached,
    warnings,
    failures,
    attachedCount: attachments.length,
    expectedCount: refs.length,
    skippedCount,
    totalOriginalBytes,
    totalOptimizedBytes,
    blocked,
  };
}

export function formatPhotoFailureMessage(failure: PhotoFailureDetail): string {
  return `${failure.label} (${failure.filename}): ${failure.reason}`;
}
