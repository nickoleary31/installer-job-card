"use client";

/**
 * Photo capture/upload/display for one Developer Sheets documentation entry. Reuses the existing
 * job-card photo presentational pieces (thumbnail grid, saved/uploading/failed badge) and the
 * shared client-side compression utility rather than a second photo system. Each file uploads
 * independently the moment it's selected — a failed upload only affects that one photo's badge
 * and never touches the entry's own notes/title/etc, which are saved separately.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { PhotoThumbnailGrid, PhotoUploadedBadge, PhotoFieldError, type RemoteThumb } from "@/components/JobCardPhotoControls";
import { uploadDeveloperSheetPhoto, getDeveloperSheetPhotoSignedUrls } from "@/lib/developer-sheets/storage";
import type { DeveloperSheetDocumentationPhoto } from "@/lib/developer-sheets/types";

type PhotoUploadStatus = "uploading" | "saved" | "failed";

export function DocumentationPhotos({
  projectId,
  cardId,
  entryId,
}: {
  projectId: string;
  cardId: string;
  entryId: string;
}) {
  const [photos, setPhotos] = useState<DeveloperSheetDocumentationPhoto[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<PhotoUploadStatus | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const takePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const uploadPhotoInputRef = useRef<HTMLInputElement | null>(null);

  const loadPhotos = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from("developer_sheet_documentation_photos")
        .select("id, entry_id, company_id, project_id, storage_path, file_name, is_active, archived_at, archived_by, uploaded_by, uploaded_at")
        .eq("entry_id", entryId)
        .eq("is_active", true)
        .order("uploaded_at", { ascending: true });
      if (error) throw error;
      const rows = (data as DeveloperSheetDocumentationPhoto[] | null) || [];
      setPhotos(rows);
      const urls = await getDeveloperSheetPhotoSignedUrls(rows.map((row) => row.storage_path));
      setSignedUrls(urls);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load photos.");
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadStatus("uploading");
    setUploadError(null);
    let anyFailed = false;
    for (const file of Array.from(files)) {
      try {
        const { storagePath, fileName } = await uploadDeveloperSheetPhoto({ projectId, cardId, entryId, file });
        const { error: insertError } = await supabase.from("developer_sheet_documentation_photos").insert({
          entry_id: entryId,
          storage_path: storagePath,
          file_name: fileName,
        });
        if (insertError) throw insertError;
      } catch (error) {
        anyFailed = true;
        setUploadError(error instanceof Error ? error.message : "Photo upload failed.");
      }
    }
    setUploadStatus(anyFailed ? "failed" : "saved");
    await loadPhotos();
    if (takePhotoInputRef.current) takePhotoInputRef.current.value = "";
    if (uploadPhotoInputRef.current) uploadPhotoInputRef.current.value = "";
  };

  const remoteThumbs: RemoteThumb[] = photos
    .filter((photo) => signedUrls[photo.storage_path])
    .map((photo) => ({
      publicUrl: signedUrls[photo.storage_path],
      filename: photo.file_name || "photo",
      storagePath: photo.storage_path,
      uploadedAt: photo.uploaded_at,
    }));

  return (
    <div className="mt-3">
      <input
        ref={takePhotoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(event) => void handleFilesSelected(event.target.files)}
      />
      <input
        ref={uploadPhotoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => void handleFilesSelected(event.target.files)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => takePhotoInputRef.current?.click()}
          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
        >
          Take Photo
        </button>
        <button
          type="button"
          onClick={() => uploadPhotoInputRef.current?.click()}
          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Upload Photo
        </button>
        <PhotoUploadedBadge show={uploadStatus === "saved"} status={uploadStatus} />
      </div>
      <PhotoFieldError message={uploadError} />

      {loading ? <p className="mt-2 text-xs text-gray-500">Loading photos…</p> : null}
      {loadError ? <p className="mt-2 text-xs font-semibold text-amber-700">{loadError}</p> : null}

      {remoteThumbs.length > 0 ? (
        <div
          className="cursor-zoom-in"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            const img = target.closest("img");
            if (img instanceof HTMLImageElement) setLightboxUrl(img.src);
          }}
        >
          <PhotoThumbnailGrid files={[]} remotePhotos={remoteThumbs} hideRemove />
        </div>
      ) : null}

      {lightboxUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="Full size" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      ) : null}
    </div>
  );
}
