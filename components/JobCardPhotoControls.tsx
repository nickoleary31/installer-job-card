"use client";

/**
 * Small, shared photo-field presentational pieces used by the job card form. Extracted so
 * product-specific sections (e.g. BlaxtairAhdEquipmentSection) can reuse the exact same visual
 * language as VAC4/PPD/CP4/LinxUp without importing from app/page.tsx, which would create a
 * circular import (page.tsx renders those sections).
 */
import { useEffect, useMemo } from "react";

export function RequiredMark() {
  return (
    <span className="text-red-600 font-bold" aria-hidden="true">
      *
    </span>
  );
}

export const PHOTO_UPLOAD_LABEL_SINGLE = "Take or upload photo";

function formatPhotoSelectionLine(count: number, names: string[]) {
  if (count < 1 && names.length < 1) return null;
  if (names.length === 0) return `${count} file${count === 1 ? "" : "s"} selected`;
  if (names.length === 1) return names[0];
  return `${names.length} photos: ${names.join(", ")}`;
}

export function PhotoUploadFeedback({ count, names }: { count: number; names: string[] }) {
  const line = formatPhotoSelectionLine(count, names);
  if (!line) return null;
  return <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{line}</p>;
}

export type RemoteThumb = { publicUrl: string; filename: string; storagePath?: string; uploadedAt?: string };

type CombinedPhotoPreview =
  | { kind: "remote"; key: string; remote: RemoteThumb }
  | { kind: "local"; key: string; file: File };

function normalizePhotoFilename(name: string): string {
  try {
    return name.normalize("NFC").trim().toLowerCase();
  } catch {
    return name.trim().toLowerCase();
  }
}

function normalizePublicUrlForDedupe(url: string): string {
  const u = url.trim();
  if (!u) return "";
  try {
    const parsed = new URL(u);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

function dedupeKeyForRemoteThumb(r: RemoteThumb): string {
  const sp = (r.storagePath || "").trim();
  if (sp) return `sp:${sp}`;
  const u = normalizePublicUrlForDedupe((r.publicUrl || "").trim());
  if (u) return `url:${u}`;
  return `fn:${normalizePhotoFilename(r.filename || "")}`;
}

function dedupeRemoteThumbsForDisplay(remotes: RemoteThumb[]): RemoteThumb[] {
  const withUrl = remotes.filter((r) => (r.publicUrl || "").trim());
  const pickNewer = (a: RemoteThumb, b: RemoteThumb): RemoteThumb => {
    const ta = Date.parse(a.uploadedAt || "") || 0;
    const tb = Date.parse(b.uploadedAt || "") || 0;
    if (tb !== ta) return tb >= ta ? b : a;
    const pa = (a.storagePath || "").length;
    const pb = (b.storagePath || "").length;
    return pb >= pa ? b : a;
  };

  const byStrictKey = new Map<string, RemoteThumb>();
  for (const r of withUrl) {
    const k = dedupeKeyForRemoteThumb(r);
    const prev = byStrictKey.get(k);
    byStrictKey.set(k, prev ? pickNewer(prev, r) : r);
  }
  const strict = [...byStrictKey.values()];

  const byFilename = new Map<string, RemoteThumb[]>();
  const noFilename: RemoteThumb[] = [];
  for (const r of strict) {
    const fn = normalizePhotoFilename(r.filename || "");
    if (!fn) {
      noFilename.push(r);
      continue;
    }
    const g = byFilename.get(fn) ?? [];
    g.push(r);
    byFilename.set(fn, g);
  }

  const collapsed: RemoteThumb[] = [...noFilename];
  for (const group of byFilename.values()) {
    if (group.length === 1) {
      collapsed.push(group[0]);
      continue;
    }
    const urls = new Set(group.map((g) => normalizePublicUrlForDedupe(g.publicUrl.trim())));
    if (urls.size === 1) {
      collapsed.push(group.reduce((a, b) => pickNewer(a, b)));
    } else {
      collapsed.push(...group);
    }
  }

  const out: RemoteThumb[] = [];
  const seen = new Set<string>();
  for (const r of collapsed) {
    const k = dedupeKeyForRemoteThumb(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function buildCombinedPhotoPreviews(files: File[], remotePhotos: RemoteThumb[]): CombinedPhotoPreview[] {
  const remotes = dedupeRemoteThumbsForDisplay(remotePhotos);
  const seen = new Set<string>();
  const entries: CombinedPhotoPreview[] = [];

  for (const r of remotes) {
    const url = (r.publicUrl || "").trim();
    if (!url) continue;
    const key = dedupeKeyForRemoteThumb(r);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ kind: "remote", key, remote: { ...r, publicUrl: url } });
  }

  const remoteFilenameNorm = new Set(
    remotes.filter((r) => (r.publicUrl || "").trim()).map((r) => normalizePhotoFilename(r.filename || "")),
  );

  let localIndex = 0;
  for (const file of files) {
    const fn = normalizePhotoFilename(file.name);
    if (fn && remoteFilenameNorm.has(fn)) continue;
    localIndex += 1;
    entries.push({ kind: "local", key: `local:${fn}:${file.size}:${file.lastModified}:${localIndex}`, file });
  }

  return entries;
}

export function PhotoThumbnailGrid({
  files,
  remotePhotos = [],
  onRemoveRemote,
  onRemoveLocal,
}: {
  files: File[];
  remotePhotos?: RemoteThumb[];
  onRemoveRemote?: (remote: RemoteThumb) => void;
  onRemoveLocal?: (file: File) => void;
}) {
  const entries = useMemo(() => buildCombinedPhotoPreviews(files, remotePhotos), [files, remotePhotos]);

  const localFiles = useMemo(
    () => entries.filter((e): e is Extract<CombinedPhotoPreview, { kind: "local" }> => e.kind === "local").map((e) => e.file),
    [entries],
  );

  const previewUrls = useMemo(() => localFiles.map((file) => URL.createObjectURL(file)), [localFiles]);

  useEffect(
    () => () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [previewUrls],
  );

  const localUrlByFile = useMemo(() => {
    const m = new Map<File, string>();
    localFiles.forEach((file, i) => {
      m.set(file, previewUrls[i] ?? "");
    });
    return m;
  }, [localFiles, previewUrls]);

  if (entries.length === 0) return null;

  return (
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {entries.map((e) =>
        e.kind === "remote" ? (
          <div key={e.key} className="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-600 dark:bg-gray-800">
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                onClick={() => onRemoveRemote?.(e.remote)}
              >
                Remove
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={e.remote.publicUrl} alt={e.remote.filename} className="h-20 w-full rounded-md object-cover" />
            <p className="mt-1 truncate text-xs text-gray-700 dark:text-gray-300" title={e.remote.filename}>
              {e.remote.filename}
            </p>
          </div>
        ) : (
          <div key={e.key} className="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-600 dark:bg-gray-800">
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                onClick={() => onRemoveLocal?.(e.file)}
              >
                Remove
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={localUrlByFile.get(e.file) || ""} alt={e.file.name} className="h-20 w-full rounded-md object-cover" />
            <p className="mt-1 truncate text-xs text-gray-700 dark:text-gray-300" title={e.file.name}>
              {e.file.name}
            </p>
          </div>
        ),
      )}
    </div>
  );
}

export function PhotoUploadedBadge({
  show,
  status,
}: {
  show: boolean;
  status?: "uploading" | "saved" | "failed" | null;
}) {
  if (status === "uploading") {
    return (
      <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-950 ring-1 ring-amber-300">
        Uploading
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-red-300">
        Failed
      </span>
    );
  }
  if (!show && status !== "saved") return null;
  return (
    <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
      <span aria-hidden>✓</span> Saved
    </span>
  );
}

export function PhotoFieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-1 text-sm font-medium text-red-600">{message}</p>;
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  const shown = value.trim() ? value : "Not Installed";
  const valueClass =
    shown === "Not Installed"
      ? "text-base font-semibold text-red-600 dark:text-red-400 sm:col-span-2"
      : "text-base text-gray-900 dark:text-gray-100 sm:col-span-2";
  return (
    <div className="grid gap-1 border-b border-gray-100 py-3 last:border-b-0 dark:border-gray-700 sm:grid-cols-3 sm:gap-4">
      <div className="text-sm font-semibold text-gray-600 dark:text-gray-300">{label}</div>
      <div className={valueClass}>{shown}</div>
    </div>
  );
}
