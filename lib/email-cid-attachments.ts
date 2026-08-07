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

/** Fetch+optimize is I/O and CPU heavy — run a bounded number concurrently instead of one-at-a-time, which turns a 20-photo job card into a minutes-long serial chain that times out before Resend is ever called. */
const DOWNLOAD_OPTIMIZE_CONCURRENCY = 5;

type RefOutcome =
  | { ref: PhotoRef; ok: true; contentId: string; filename: string; optimizedImage: Awaited<ReturnType<typeof optimizeImageForEmailAttachment>> }
  | { ref: PhotoRef; ok: false; reason: string; filename: string };

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
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

  // Phase 1 — fetch + optimize every ref concurrently (bounded). No shared mutable state here,
  // so this is safe to run out of order; results stay indexed to `refs` for deterministic phase 2.
  const batchStartedAt = Date.now();
  const outcomes = await mapWithConcurrency(refs, DOWNLOAD_OPTIMIZE_CONCURRENCY, async (ref): Promise<RefOutcome> => {
    const attachmentDisplayName = buildEmailAttachmentFilename({
      customer: ctx.customer,
      assetNumber: ctx.assetNumber,
      fieldLabel: ref.fieldLabel,
      sequenceInField: ref.sequenceInField,
      extension: "jpg",
    });
    const downloadStartedAt = Date.now();
    try {
      const { data, error } = await supabase.storage.from(JOB_CARD_PHOTOS_BUCKET).download(ref.storagePath);
      const downloadMs = Date.now() - downloadStartedAt;
      if (error || !data) {
        console.info("[email-photos] timing", { storagePath: ref.storagePath, downloadMs, ok: false, stage: "download" });
        return { ref, ok: false, reason: error?.message || "download failed", filename: attachmentDisplayName };
      }

      const raw = Buffer.from(await data.arrayBuffer());
      if (raw.byteLength === 0) {
        console.info("[email-photos] timing", { storagePath: ref.storagePath, downloadMs, ok: false, stage: "empty" });
        return { ref, ok: false, reason: "empty file", filename: attachmentDisplayName };
      }

      const optimizeStartedAt = Date.now();
      let optimizedImage;
      try {
        optimizedImage = await optimizeImageForEmailAttachment(raw, {
          targetBytes: TARGET_ATTACHMENT_BYTES,
          hardMaxBytes: HARD_MAX_ATTACHMENT_BYTES,
        });
      } catch (optErr) {
        const optimizeMs = Date.now() - optimizeStartedAt;
        console.info("[email-photos] timing", { storagePath: ref.storagePath, downloadMs, optimizeMs, ok: false, stage: "optimize" });
        const msg = optErr instanceof Error ? optErr.message : "optimization failed";
        return { ref, ok: false, reason: msg, filename: attachmentDisplayName };
      }
      const optimizeMs = Date.now() - optimizeStartedAt;
      console.info("[email-photos] timing", {
        storagePath: ref.storagePath,
        downloadMs,
        optimizeMs,
        totalMs: Date.now() - downloadStartedAt,
        originalKB: Math.round(raw.byteLength / 1024),
        ok: true,
      });

      const ext = optimizedImage.extension;
      const filename =
        ext === "jpg"
          ? attachmentDisplayName.replace(/\.[^.]+$/, ".jpg")
          : attachmentDisplayName.replace(/\.[^.]+$/, ".png");

      return { ref, ok: true, contentId: contentIdForStoragePath(ref.storagePath), filename, optimizedImage };
    } catch (e) {
      const downloadMs = Date.now() - downloadStartedAt;
      console.info("[email-photos] timing", { storagePath: ref.storagePath, downloadMs, ok: false, stage: "exception" });
      const message = e instanceof Error ? e.message : "unknown error";
      return { ref, ok: false, reason: message, filename: attachmentDisplayName };
    }
  });
  console.info("[email-photos] batch complete", { refCount: refs.length, totalBatchMs: Date.now() - batchStartedAt });

  // Phase 2 — apply the running total-size budget in the original, deterministic ref order.
  for (const outcome of outcomes) {
    const { ref } = outcome;
    const pushFailure = (reason: string, filename: string) => {
      skippedCount += 1;
      failures.push({ label: ref.fieldLabel, filename, storagePath: ref.storagePath, reason });
    };

    if (!outcome.ok) {
      pushFailure(outcome.reason, outcome.filename);
      continue;
    }

    const { contentId, filename, optimizedImage } = outcome;

    if (totalOptimizedBytes + optimizedImage.optimizedBytes > MAX_TOTAL_PHOTO_ATTACHMENT_BYTES) {
      pushFailure(
        `total attachment size would exceed ${Math.round(MAX_TOTAL_PHOTO_ATTACHMENT_BYTES / (1024 * 1024))}MB`,
        filename,
      );
      continue;
    }

    optimized.push({
      label: ref.fieldLabel,
      filename,
      storagePath: ref.storagePath,
      originalBytes: optimizedImage.originalBytes,
      optimizedBytes: optimizedImage.optimizedBytes,
      width: optimizedImage.width,
      height: optimizedImage.height,
    });

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
