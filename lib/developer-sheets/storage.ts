/**
 * Storage helpers for Developer Sheets documentation photos. Private bucket, path convention
 * enforced by the Storage RLS policy in
 * supabase/migrations/20260915000001_developer_sheets_photos_storage_policies.sql:
 *   {projectId}/{cardId}/{entryId}/{generatedFilename}
 * Only storage_path is ever persisted — never a public_url. Reuses the same client-side
 * compression already used for job-card photos rather than a second image pipeline.
 */
import { supabase } from "@/lib/supabase/client";
import { compressPhotoForUpload } from "@/lib/client-photo-optimize";

export const DEVELOPER_SHEET_PHOTOS_BUCKET = "developer-sheet-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Same sanitization convention used for other uploads in this app (app/page.tsx receipt/photo paths). */
function safeFileName(name: string): string {
  const trimmed = name.trim() || "photo";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildDeveloperSheetPhotoPath(args: {
  projectId: string;
  cardId: string;
  entryId: string;
  fileName: string;
}): string {
  return `${args.projectId}/${args.cardId}/${args.entryId}/${Date.now()}-${safeFileName(args.fileName)}`;
}

/** Compress, upload to the private bucket, and return the storage_path to persist — never a URL. */
export async function uploadDeveloperSheetPhoto(args: {
  projectId: string;
  cardId: string;
  entryId: string;
  file: File;
}): Promise<{ storagePath: string; fileName: string }> {
  const compressed = await compressPhotoForUpload(args.file);
  const storagePath = buildDeveloperSheetPhotoPath({
    projectId: args.projectId,
    cardId: args.cardId,
    entryId: args.entryId,
    fileName: args.file.name,
  });
  const { error } = await supabase.storage
    .from(DEVELOPER_SHEET_PHOTOS_BUCKET)
    .upload(storagePath, compressed, { contentType: compressed.type || undefined });
  if (error) throw error;
  return { storagePath, fileName: args.file.name };
}

/** Short-lived signed URL for display — never persisted, regenerated whenever a photo is shown. */
export async function getDeveloperSheetPhotoSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(DEVELOPER_SHEET_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.warn("[developer-sheets] failed to sign photo URL", { storagePath, error });
    return null;
  }
  return data?.signedUrl || null;
}

export async function getDeveloperSheetPhotoSignedUrls(
  storagePaths: string[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    storagePaths.map(async (path) => [path, await getDeveloperSheetPhotoSignedUrl(path)] as const),
  );
  const result: Record<string, string> = {};
  for (const [path, url] of entries) {
    if (url) result[path] = url;
  }
  return result;
}
