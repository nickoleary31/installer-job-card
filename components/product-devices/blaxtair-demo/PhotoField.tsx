"use client";

/**
 * One category photo field: capture/upload, preview, replace, remove, optional description.
 * Reused for every category in PhotoGallerySection AND could be reused for any future photo
 * field elsewhere — duplicate detection is wired via the shared workflow hook, not local logic.
 */
import { useRef, useState } from "react";
import type { BlaxtairJobCardPhoto } from "@/lib/prototype/blaxtair-job-card";
import { fingerprintSource } from "@/lib/prototype/photo-fingerprint";
import type { PhotoCategory } from "@/lib/prototype/photo-dedup-registry";

async function buildThumbnail(source: Blob): Promise<string> {
  const { loadImageBitmap, drawToCanvas } = await import("@/lib/prototype/label-scan/preprocess");
  const { canvasToThumbnailDataUrl } = await import("@/lib/prototype/label-scan/preprocess");
  const bitmap = await loadImageBitmap(source);
  const maxW = 1200;
  const scale = bitmap.width > maxW ? maxW / bitmap.width : 1;
  const canvas = drawToCanvas(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  bitmap.close();
  return canvasToThumbnailDataUrl(canvas);
}

export function PhotoField(props: {
  category: PhotoCategory;
  label: string;
  required?: boolean;
  photo: BlaxtairJobCardPhoto | null;
  onAdd: (photo: Omit<BlaxtairJobCardPhoto, "id">) => void;
  onReplace: (id: string, photo: Omit<BlaxtairJobCardPhoto, "id">) => void;
  onRemove: (id: string) => void;
  onDescriptionChange: (id: string, description: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setLocalError(null);
    try {
      const [fingerprint, thumbnail] = await Promise.all([fingerprintSource(file), buildThumbnail(file)]);
      const data: Omit<BlaxtairJobCardPhoto, "id"> = {
        category: props.category,
        label: props.label,
        description: props.photo?.description ?? "",
        localPreview: thumbnail,
        contentFingerprint: fingerprint,
        uploadedAt: new Date().toISOString(),
      };
      if (props.photo) props.onReplace(props.photo.id, data);
      else props.onAdd(data);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Could not process that photo — try again.");
    } finally {
      setBusy(false);
    }
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handleFile(file);
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 p-3">
      <p className="text-sm font-medium">
        {props.label}
        {props.required ? <span className="text-amber-400"> *</span> : null}
      </p>

      {props.photo ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={props.photo.localPreview} alt={props.label} className="max-h-48 rounded border border-slate-700" />
          <input
            className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm"
            placeholder="Description (optional)"
            value={props.photo.description}
            onChange={(e) => props.onDescriptionChange(props.photo!.id, e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border border-slate-500 px-3 py-2 text-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? "Processing…" : "Retake Photo"}
            </button>
            <button type="button" className="rounded-lg border border-slate-500 px-3 py-2 text-sm" onClick={() => uploadRef.current?.click()} disabled={busy}>
              Upload New Photo
            </button>
            <button type="button" className="rounded-lg border border-red-400 px-3 py-2 text-sm text-red-300" onClick={() => props.onRemove(props.photo!.id)}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "Processing…" : "Take Photo"}
          </button>
          <button type="button" className="rounded-lg border border-slate-500 px-3 py-2 text-sm" onClick={() => uploadRef.current?.click()} disabled={busy}>
            Upload Photo
          </button>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFilePicked} />
      <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={onFilePicked} />

      {localError ? <p className="text-xs text-red-300">{localError}</p> : null}
    </div>
  );
}
