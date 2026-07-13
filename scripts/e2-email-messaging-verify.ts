/**
 * Dry-run: optimize E2 photos and build outbound photo HTML; assert no false warnings.
 * Does not send email.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { optimizeImageForEmailAttachment } from "../lib/email-photo-optimize.ts";
import {
  buildEmailPhotoSections,
  renderPhotoSectionsHtml,
  renderPhotoSectionsText,
} from "../lib/email-photo-sections.ts";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return out;
}

function contentIdForStoragePath(storagePath: string): string {
  const hash = createHash("sha256").update(storagePath).digest("hex").slice(0, 24);
  return `photo-${hash}`;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const { data, error } = await sb
  .from("job_card_submissions")
  .select("submission_id,payload")
  .eq("submission_id", "d4c80e35-26e6-4650-a2d8-b38fb426e6e2")
  .single();

if (error || !data) {
  console.error(error || "submission not found");
  process.exit(1);
}

const payload = data.payload as Parameters<typeof buildEmailPhotoSections>[0];
const sections = buildEmailPhotoSections(payload);
const photos = (payload as { photoUploads?: Array<{ label?: string; storagePath?: string }> }).photoUploads || [];

const optimized: Array<{
  label: string;
  storagePath: string;
  originalBytes: number;
  optimizedBytes: number;
}> = [];
const failures: Array<{ label: string; reason: string }> = [];
const cidByStoragePath = new Map<string, string>();
let totalOptimizedBytes = 0;

for (const photo of photos) {
  const path = photo.storagePath?.trim();
  if (!path) continue;
  const label = photo.label || path;
  const { data: blob, error: dlErr } = await sb.storage.from("job-card-photos").download(path);
  if (dlErr || !blob) {
    failures.push({ label, reason: dlErr?.message || "download failed" });
    continue;
  }
  try {
    const raw = Buffer.from(await blob.arrayBuffer());
    const out = await optimizeImageForEmailAttachment(raw);
    optimized.push({
      label,
      storagePath: path,
      originalBytes: out.originalBytes,
      optimizedBytes: out.optimizedBytes,
    });
    totalOptimizedBytes += out.optimizedBytes;
    cidByStoragePath.set(path, contentIdForStoragePath(path));
  } catch (e) {
    failures.push({ label, reason: e instanceof Error ? e.message : String(e) });
  }
}

const failureMessages = failures.map((f) => `${f.label}: ${f.reason}`);
const html = renderPhotoSectionsHtml(sections, {
  mode: "cid",
  cidByStoragePath,
  attachmentFailures: failureMessages.length > 0 ? failureMessages : undefined,
});
const text = renderPhotoSectionsText(sections);

const checks = {
  photoCount: photos.length,
  optimizedCount: optimized.length,
  failuresCount: failures.length,
  htmlHasFailedBanner: /failed to attach|could not be attached/i.test(html),
  htmlHasOptimizedNote: /Optimized |4\.53MB|515KB|PHOTO ATTACHMENT/i.test(html),
  textHasOptimizedNote: /Optimized |PHOTO ATTACHMENT|could not be attached/i.test(text),
  cidCountInHtml: (html.match(/cid:photo-/g) || []).length,
  totalOptimizedMB: (totalOptimizedBytes / (1024 * 1024)).toFixed(2),
};

const ok =
  checks.photoCount === 8 &&
  checks.optimizedCount === 8 &&
  checks.failuresCount === 0 &&
  checks.htmlHasFailedBanner === false &&
  checks.htmlHasOptimizedNote === false &&
  checks.textHasOptimizedNote === false &&
  checks.cidCountInHtml === 8;

console.log(
  JSON.stringify(
    {
      ok,
      checks,
      optimizedDiagnostics: optimized.map((o) => ({
        label: o.label,
        originalMB: (o.originalBytes / (1024 * 1024)).toFixed(2),
        optimizedKB: Math.round(o.optimizedBytes / 1024),
      })),
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
