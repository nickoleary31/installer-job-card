"use client";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CoreJobFields,
  type Vac4DescriptionKey,
  type JobCardSubmissionPayload,
  type UploadedPhotoMetadata,
  type Vac4OrderedPhotoKey,
  type VacPhotoFileNames,
  DEFAULT_JOB_CARD_EMAIL_TO,
  VAC4_ORDERED_DESCRIPTION_FIELDS,
  VAC4_ORDERED_PHOTO_FIELDS,
  formatEmailBodyFromPayload,
  formatEmailSubject,
} from "@/lib/job-card-submission";
import { supabase } from "@/lib/supabase/client";

async function deleteJobCardPhotoObject(storagePath: string) {
  try {
    const { error } = await supabase.storage.from("job-card-photos").remove([storagePath]);
    if (error) console.error("Supabase storage delete failed:", error.message, storagePath);
  } catch (e) {
    console.error("Supabase storage delete failed:", e, storagePath);
  }
}

function dedupeUploadedPhotoMeta(items: UploadedPhotoMetadata[]): UploadedPhotoMetadata[] {
  const seen = new Set<string>();
  const out: UploadedPhotoMetadata[] = [];
  for (const item of items) {
    const id = (item.publicUrl || "").trim() || item.storagePath;
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

const MAX_PHOTOS_PER_FIELD = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const UPLOAD_ERR_MAX_COUNT = "Max 5 photos allowed";
const UPLOAD_ERR_FILE_SIZE = "File too large (10MB max)";
const UPLOAD_ERR_FILE_TYPE = "Only JPEG and PNG files are allowed";
const UPLOAD_ERR_UPLOAD_FAILED = "Upload failed";
const JOB_CARD_DRAFTS_STORAGE_KEY = "installer-job-card-drafts-v1";
const JOB_CARD_RESUME_DRAFT_ID_KEY = "installer-job-card-resume-draft-id-v1";
const JOB_CARD_RESUME_DRAFT_PAYLOAD_KEY = "installer-job-card-resume-draft-payload-v1";
const JOB_CARD_DRAFTS_MIGRATION_KEY = "installer-job-card-drafts-submission-id-migrated-v1";

function generateSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type StoredJobCardDraft = {
  submissionId: string;
  id?: string;
  customer: string;
  unitNumber: string;
  savedAt: string;
  data: {
    coreJob: CoreJobFields;
    hardwareSelection: { primary: string; hasAdditional: string; additional: string[] };
    vac4: Record<string, string | undefined>;
    photoUploads?: UploadedPhotoMetadata[];
    photoSummary: {
      vac4PhotoFileNames: VacPhotoFileNames;
      vac4PhotoUrls: VacPhotoFileNames;
      vac4PhotoCounts: Record<string, number>;
      vehiclePhotoFileNames: VehiclePictureFileNames;
      vehiclePhotoUrls: VehiclePictureFileNames;
      vehiclePhotoCounts: Record<string, number>;
      photoUploads?: UploadedPhotoMetadata[];
    };
  };
};

function readMigratedDraftsFromStorage(): StoredJobCardDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(JOB_CARD_DRAFTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredJobCardDraft[];
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.map((draft) => {
      const submissionId = draft.submissionId || draft.id || generateSubmissionId();
      return { ...draft, submissionId };
    });
    const migrationDone = window.localStorage.getItem(JOB_CARD_DRAFTS_MIGRATION_KEY) === "1";
    if (!migrationDone) {
      window.localStorage.setItem(JOB_CARD_DRAFTS_STORAGE_KEY, JSON.stringify(migrated));
      window.localStorage.setItem(JOB_CARD_DRAFTS_MIGRATION_KEY, "1");
    }
    return migrated;
  } catch {
    return [];
  }
}

const hardwareTypes = [
  "VAC4",
  "CP4",
  "PPD",
  "Speed Transmon",
  "Speed SSC",
  "FTxw",
];

const emptyVacPhotoFileNames = (): VacPhotoFileNames => ({
  vacMounting: [],
  wirePath: [],
  redWire: [],
  blackWire: [],
  blueWire: [],
  brownWire: [],
  sensorHubMounting: [],
  speedSense: [],
  loadSense: [],
  gps: [],
  externalIndicator: [],
  purpleWire: [],
  relayAccess: [],
  impactSensor: [],
});

type VacPhotoFilesState = { [K in keyof VacPhotoFileNames]: File[] };
type VacPhotoUrlsState = { [K in keyof VacPhotoFileNames]: string[] };

const emptyVacPhotoFiles = (): VacPhotoFilesState => ({
  vacMounting: [],
  wirePath: [],
  redWire: [],
  blackWire: [],
  blueWire: [],
  brownWire: [],
  sensorHubMounting: [],
  speedSense: [],
  loadSense: [],
  gps: [],
  externalIndicator: [],
  purpleWire: [],
  relayAccess: [],
  impactSensor: [],
});

const emptyVacPhotoUrls = (): VacPhotoUrlsState => ({
  vacMounting: [],
  wirePath: [],
  redWire: [],
  blackWire: [],
  blueWire: [],
  brownWire: [],
  sensorHubMounting: [],
  speedSense: [],
  loadSense: [],
  gps: [],
  externalIndicator: [],
  purpleWire: [],
  relayAccess: [],
  impactSensor: [],
});

type VacPhotoErrorsState = { [K in keyof VacPhotoFileNames]: string | null };

const emptyVacPhotoErrors = (): VacPhotoErrorsState => ({
  vacMounting: null,
  wirePath: null,
  redWire: null,
  blackWire: null,
  blueWire: null,
  brownWire: null,
  sensorHubMounting: null,
  speedSense: null,
  loadSense: null,
  gps: null,
  externalIndicator: null,
  purpleWire: null,
  relayAccess: null,
  impactSensor: null,
});

type VehiclePictureKey = "vehicleFront" | "vehicleSide" | "vehicleRear";
type VehiclePictureFileNames = { [K in VehiclePictureKey]: string[] };
type VehiclePictureFilesState = { [K in VehiclePictureKey]: File[] };
type VehiclePictureUrlsState = { [K in VehiclePictureKey]: string[] };
type VehiclePictureErrorsState = { [K in VehiclePictureKey]: string | null };
type UploadFieldName = keyof VacPhotoFileNames | VehiclePictureKey;
type PhotoMetadataByFieldState = { [K in UploadFieldName]: UploadedPhotoMetadata[] };

const emptyVehiclePictureFileNames = (): VehiclePictureFileNames => ({
  vehicleFront: [],
  vehicleSide: [],
  vehicleRear: [],
});

const emptyVehiclePictureFiles = (): VehiclePictureFilesState => ({
  vehicleFront: [],
  vehicleSide: [],
  vehicleRear: [],
});

const emptyVehiclePictureUrls = (): VehiclePictureUrlsState => ({
  vehicleFront: [],
  vehicleSide: [],
  vehicleRear: [],
});

const emptyVehiclePictureErrors = (): VehiclePictureErrorsState => ({
  vehicleFront: null,
  vehicleSide: null,
  vehicleRear: null,
});

const emptyPhotoMetadataByField = (): PhotoMetadataByFieldState => ({
  vacMounting: [],
  wirePath: [],
  redWire: [],
  blackWire: [],
  blueWire: [],
  brownWire: [],
  sensorHubMounting: [],
  speedSense: [],
  loadSense: [],
  gps: [],
  externalIndicator: [],
  purpleWire: [],
  relayAccess: [],
  impactSensor: [],
  vehicleFront: [],
  vehicleSide: [],
  vehicleRear: [],
});

const PHOTO_FIELD_LABELS: Record<UploadFieldName, string> = {
  vacMounting: "VAC mounting",
  wirePath: "Wire path",
  redWire: "Red wire",
  blackWire: "Black wire",
  blueWire: "Blue wire",
  brownWire: "Brown wire",
  sensorHubMounting: "Sensor hub mounting",
  speedSense: "Speed sense",
  loadSense: "Load sense",
  gps: "GPS",
  externalIndicator: "External indicator",
  purpleWire: "Purple wire",
  relayAccess: "Relay access control",
  impactSensor: "Impact sensor mounting",
  vehicleFront: "Vehicle front picture",
  vehicleSide: "Vehicle side picture",
  vehicleRear: "Vehicle rear picture",
};

const VAC_PHOTO_KEYS = Object.keys(emptyVacPhotoFileNames()) as (keyof VacPhotoFileNames)[];

function VAC4Section({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function RequiredMark() {
  return (
    <span className="text-red-600 font-bold" aria-hidden="true">
      *
    </span>
  );
}

function IconClipboard({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <path d="M9 2v4h6V2H9zM9 12h6M9 16h6" />
    </svg>
  );
}

function IconChip({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01" />
    </svg>
  );
}

function IconGear({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function IconDocument({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}

function IconFloppy({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  );
}

function IconSend({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

type SectionStepStatus = "Not Started" | "In Progress" | "Complete";

function sectionStatusBadgeClassName(status: SectionStepStatus) {
  switch (status) {
    case "Not Started":
      return "mt-1 inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold tracking-tight text-slate-700 ring-1 ring-inset ring-slate-200/80";
    case "Complete":
      return "mt-1 inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold tracking-tight text-emerald-900 ring-1 ring-inset ring-emerald-200/80";
    case "In Progress":
    default:
      return "mt-1 inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold tracking-tight text-amber-900 ring-1 ring-inset ring-amber-200/80";
  }
}

function SectionStatusCard({
  title,
  tone,
  icon: Icon,
  status,
}: {
  title: string;
  tone: "blue" | "green" | "purple";
  icon: typeof IconClipboard;
  status: SectionStepStatus;
}) {
  const ring = tone === "blue" ? "bg-blue-600" : tone === "green" ? "bg-emerald-600" : "bg-violet-600";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${ring} text-white`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <span className={sectionStatusBadgeClassName(status)}>{status}</span>
        </div>
      </div>
    </div>
  );
}

function FormSectionHeader({ title, tone }: { title: string; tone: "blue" | "green" | "purple" }) {
  const ring = tone === "blue" ? "bg-blue-600" : tone === "green" ? "bg-emerald-600" : "bg-violet-600";
  const Icon = tone === "blue" ? IconClipboard : tone === "green" ? IconChip : IconGear;
  return (
    <div className="mb-6 flex items-center gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ring} text-white`}>
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-gray-900">{title}</h2>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const shown = value.trim() ? value : "—";
  return (
    <div className="grid gap-1 border-b border-gray-100 py-3 sm:grid-cols-3 sm:gap-4 last:border-b-0">
      <div className="text-sm font-semibold text-gray-600">{label}</div>
      <div className="text-base text-gray-900 sm:col-span-2">{shown}</div>
    </div>
  );
}

function photoLabel(count: number) {
  return count >= 1 ? `${count} file${count === 1 ? "" : "s"}` : "None uploaded";
}

function reviewPhotoSummary(count: number, names: string[]) {
  if (count < 1) return "None uploaded";
  if (names.length > 0) return `${count} file${count === 1 ? "" : "s"}: ${names.join(", ")}`;
  return `${count} file${count === 1 ? "" : "s"} (names not available)`;
}

function countPhotoValue(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") return value.trim() ? 1 : 0;
  return 0;
}

function formatPhotoSelectionLine(count: number, names: string[]) {
  if (count < 1 && names.length < 1) return null;
  if (names.length === 0) return `${count} file${count === 1 ? "" : "s"} selected`;
  if (names.length === 1) return names[0];
  return `${names.length} photos: ${names.join(", ")}`;
}

function PhotoUploadFeedback({ count, names }: { count: number; names: string[] }) {
  const line = formatPhotoSelectionLine(count, names);
  if (!line) return null;
  return <p className="mt-2 text-sm text-gray-700">{line}</p>;
}

type RemoteThumb = { publicUrl: string; filename: string; storagePath?: string; uploadedAt?: string };

type CombinedPhotoPreview =
  | { kind: "remote"; key: string; remote: RemoteThumb }
  | { kind: "local"; key: string; file: File };

/** Stable comparison for matching user File.name to draft/server metadata filenames (handles Unicode normalization). */
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

/** One row per logical photo: strict path/URL dedupe, then collapse same-filename rows when they share one public URL. */
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

function localFileDedupeKey(file: File): string {
  return `${normalizePhotoFilename(file.name)}|${file.size}|${file.lastModified}`;
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

  const seenLocal = new Set<string>();
  for (const file of files) {
    const lk = localFileDedupeKey(file);
    if (seenLocal.has(lk)) continue;
    seenLocal.add(lk);

    const fnNorm = normalizePhotoFilename(file.name);
    if (fnNorm && remoteFilenameNorm.has(fnNorm)) continue;

    const fk = `local:${lk}`;
    if (seen.has(fk)) continue;
    seen.add(fk);
    entries.push({ kind: "local", key: fk, file });
  }

  return entries;
}

function PhotoThumbnailGrid({
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
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {entries.map((e) =>
        e.kind === "remote" ? (
          <div key={e.key} className="rounded-lg border border-gray-200 bg-white p-2">
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50"
                onClick={() => onRemoveRemote?.(e.remote)}
              >
                Remove
              </button>
            </div>
            <img src={e.remote.publicUrl} alt={e.remote.filename} className="h-20 w-full rounded-md object-cover" />
            <p className="mt-1 truncate text-xs text-gray-700" title={e.remote.filename}>
              {e.remote.filename}
            </p>
          </div>
        ) : (
          <div key={e.key} className="rounded-lg border border-gray-200 bg-white p-2">
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50"
                onClick={() => onRemoveLocal?.(e.file)}
              >
                Remove
              </button>
            </div>
            <img src={localUrlByFile.get(e.file) || ""} alt={e.file.name} className="h-20 w-full rounded-md object-cover" />
            <p className="mt-1 truncate text-xs text-gray-700" title={e.file.name}>
              {e.file.name}
            </p>
          </div>
        ),
      )}
    </div>
  );
}

function PhotoUploadedBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
      <span aria-hidden>✓</span> Uploaded
    </span>
  );
}

function PhotoFieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-1 text-sm font-medium text-red-600">{message}</p>;
}

export function NewSubmissionForm() {
  const router = useRouter();
  const [submissionId, setSubmissionId] = useState<string>(() => generateSubmissionId());
  const [step, setStep] = useState<"form" | "review">("form");
  const [coreJob, setCoreJob] = useState<CoreJobFields>({
    customer: "",
    location: "",
    workOrder: "",
    serviceAppointment: "",
    unitNumber: "",
    equipmentMake: "",
    equipmentModel: "",
    equipmentSerial: "",
    installerName: "",
  });
  const [submissionCompletedAt, setSubmissionCompletedAt] = useState<number | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<"Draft" | "Submitted">("Draft");
  const [submitSuccessMessage, setSubmitSuccessMessage] = useState<string | null>(null);
  const [emailSubmissionPreview, setEmailSubmissionPreview] = useState<{
    to: string;
    toLabel: string;
    subject: string;
    body: string;
  } | null>(null);
  const [pendingEmailPayload, setPendingEmailPayload] = useState<JobCardSubmissionPayload | null>(null);
  const [emailSendStatus, setEmailSendStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [emailSendErrorMessage, setEmailSendErrorMessage] = useState<string | null>(null);
  const configuredPreviewTo = process.env.NEXT_PUBLIC_JOB_CARD_EMAIL_TO?.trim() || "";

  const [primary, setPrimary] = useState("");
  const [hasAdditional, setHasAdditional] = useState("");
  const [additional, setAdditional] = useState<string[]>([]);
  const [vac4VehicleType, setVac4VehicleType] = useState("");
  const [vac4OtherVehicleType, setVac4OtherVehicleType] = useState("");
  const [vac4DriveType, setVac4DriveType] = useState("");
  const [vac4VehicleVoltage, setVac4VehicleVoltage] = useState("");
  const [vac4VehicleVoltageOther, setVac4VehicleVoltageOther] = useState("");
  const [vac4ClientApproval, setVac4ClientApproval] = useState("");
  const [vac4HourMeter, setVac4HourMeter] = useState("");
  const [sensorHubInstalled, setSensorHubInstalled] = useState("");
  const [liftSenseInstalled, setLiftSenseInstalled] = useState("");
  const [operatorPresenceInstalled, setOperatorPresenceInstalled] = useState("");
  const [speedSenseInstalled, setSpeedSenseInstalled] = useState("");
  const [loadSenseInstalled, setLoadSenseInstalled] = useState("");
  const [gpsInstalled, setGpsInstalled] = useState("");
  const [externalIndicatorInstalled, setExternalIndicatorInstalled] = useState("");
  const [speedSenseDescription, setSpeedSenseDescription] = useState("");
  const [speedSensePulseCount, setSpeedSensePulseCount] = useState("");
  const [loadSenseThresholds, setLoadSenseThresholds] = useState("");
  const [redWireDescription, setRedWireDescription] = useState("");
  const [blackWireDescription, setBlackWireDescription] = useState("");
  const [blueWireDescription, setBlueWireDescription] = useState("");
  const [brownWireDescription, setBrownWireDescription] = useState("");
  const [purpleWireDescription, setPurpleWireDescription] = useState("");
  const [relayAccessDescription, setRelayAccessDescription] = useState("");
  const [impactSensorDescription, setImpactSensorDescription] = useState("");
  const [vacPhotoFiles, setVacPhotoFiles] = useState<VacPhotoFilesState>(() => emptyVacPhotoFiles());
  const [vacPhotoUrls, setVacPhotoUrls] = useState<VacPhotoUrlsState>(() => emptyVacPhotoUrls());
  const [photoMetadataByField, setPhotoMetadataByField] = useState<PhotoMetadataByFieldState>(() =>
    emptyPhotoMetadataByField(),
  );

  const remoteThumbsForVacField = (key: keyof VacPhotoFileNames): RemoteThumb[] =>
    photoMetadataByField[key]
      .filter((p) => p.publicUrl?.trim())
      .map((p) => ({
        publicUrl: p.publicUrl.trim(),
        filename: p.filename,
        storagePath: p.storagePath,
        uploadedAt: p.uploadedAt,
      }));

  const remoteThumbsForVehicleField = (key: VehiclePictureKey): RemoteThumb[] =>
    photoMetadataByField[key]
      .filter((p) => p.publicUrl?.trim())
      .map((p) => ({
        publicUrl: p.publicUrl.trim(),
        filename: p.filename,
        storagePath: p.storagePath,
        uploadedAt: p.uploadedAt,
      }));

  const [vacPhotoErrors, setVacPhotoErrors] = useState<VacPhotoErrorsState>(() => emptyVacPhotoErrors());
  const [vehiclePictureFiles, setVehiclePictureFiles] = useState<VehiclePictureFilesState>(() => emptyVehiclePictureFiles());
  const [vehiclePictureUrls, setVehiclePictureUrls] = useState<VehiclePictureUrlsState>(() => emptyVehiclePictureUrls());
  const [vehiclePictureErrors, setVehiclePictureErrors] = useState<VehiclePictureErrorsState>(() => emptyVehiclePictureErrors());
  const vacPhotoUrlsRef = useRef<VacPhotoUrlsState>(emptyVacPhotoUrls());
  const vehiclePictureUrlsRef = useRef<VehiclePictureUrlsState>(emptyVehiclePictureUrls());
  const photoMetadataByFieldRef = useRef<PhotoMetadataByFieldState>(emptyPhotoMetadataByField());
  const [reviewHighlights, setReviewHighlights] = useState<Set<string>>(() => new Set());
  const [reviewBlockMessage, setReviewBlockMessage] = useState<string | null>(null);
  const [draftNoticeMessage, setDraftNoticeMessage] = useState<string | null>(null);

  const availableAdditional = hardwareTypes.filter((h) => h !== primary);
  const inputClassName =
    "w-full min-h-[52px] px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const selectClassName =
    "w-full min-h-[52px] px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const labelClassName = "block text-gray-900 font-semibold text-base mb-2";
  const photoPickClassName =
    "flex min-h-[52px] w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-center text-base font-semibold text-gray-900 active:bg-gray-100";
  const cardClassName =
    "rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6";
  const headerCardClassName =
    "rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:px-5 sm:py-4";
  const btnPrimaryClassName =
    "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 sm:min-w-[220px]";
  const btnSecondaryClassName =
    "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-blue-600 bg-white px-5 py-3.5 text-base font-semibold text-blue-600 shadow-sm hover:bg-blue-50 active:bg-blue-100 sm:min-w-[160px]";
  const checkboxRowClassName =
    "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl border-2 border-gray-100 bg-gray-50/80 px-4 py-3 text-base font-medium text-gray-900 active:bg-gray-100";
  const isCombustionDrive = vac4DriveType === "Internal Combustion";
  const blueWireHelperText =
    vac4DriveType === "Electric"
      ? "Motion"
      : isCombustionDrive
        ? "In-gear"
        : "Motion / In-gear";
  const brownWireHelperText =
    vac4DriveType === "Electric" && liftSenseInstalled === "Yes"
      ? "Lift"
      : isCombustionDrive
        ? "Engine-on"
        : "Lift / Engine-on";

  const toggleAdditional = (type: string) => {
    if (additional.includes(type)) {
      setAdditional(additional.filter((a) => a !== type));
    } else {
      setAdditional([...additional, type]);
    }
  };
  const selectedSections = [primary, ...additional].filter(Boolean);

  const vacPhotoFileNames = useMemo((): VacPhotoFileNames => {
    const out = emptyVacPhotoFileNames();
    for (const k of VAC_PHOTO_KEYS) {
      const fromFiles = vacPhotoFiles[k].map((f) => f.name);
      const fromMeta = photoMetadataByField[k].filter((p) => p.publicUrl?.trim()).map((p) => p.filename);
      out[k] = fromFiles.length > 0 ? fromFiles : fromMeta;
    }
    return out;
  }, [vacPhotoFiles, photoMetadataByField]);

  const pc = useMemo(
    () => ({
      vacMounting: Math.max(
        vacPhotoFiles.vacMounting.length,
        photoMetadataByField.vacMounting.filter((p) => p.publicUrl?.trim()).length,
      ),
      wirePath: Math.max(
        vacPhotoFiles.wirePath.length,
        photoMetadataByField.wirePath.filter((p) => p.publicUrl?.trim()).length,
      ),
      redWire: Math.max(
        vacPhotoFiles.redWire.length,
        photoMetadataByField.redWire.filter((p) => p.publicUrl?.trim()).length,
      ),
      blackWire: Math.max(
        vacPhotoFiles.blackWire.length,
        photoMetadataByField.blackWire.filter((p) => p.publicUrl?.trim()).length,
      ),
      blueWire: Math.max(
        vacPhotoFiles.blueWire.length,
        photoMetadataByField.blueWire.filter((p) => p.publicUrl?.trim()).length,
      ),
      brownWire: Math.max(
        vacPhotoFiles.brownWire.length,
        photoMetadataByField.brownWire.filter((p) => p.publicUrl?.trim()).length,
      ),
      sensorHubMounting: Math.max(
        vacPhotoFiles.sensorHubMounting.length,
        photoMetadataByField.sensorHubMounting.filter((p) => p.publicUrl?.trim()).length,
      ),
      speedSense: Math.max(
        vacPhotoFiles.speedSense.length,
        photoMetadataByField.speedSense.filter((p) => p.publicUrl?.trim()).length,
      ),
      loadSense: Math.max(
        vacPhotoFiles.loadSense.length,
        photoMetadataByField.loadSense.filter((p) => p.publicUrl?.trim()).length,
      ),
      gps: Math.max(vacPhotoFiles.gps.length, photoMetadataByField.gps.filter((p) => p.publicUrl?.trim()).length),
      externalIndicator: Math.max(
        vacPhotoFiles.externalIndicator.length,
        photoMetadataByField.externalIndicator.filter((p) => p.publicUrl?.trim()).length,
      ),
      purpleWire: Math.max(
        vacPhotoFiles.purpleWire.length,
        photoMetadataByField.purpleWire.filter((p) => p.publicUrl?.trim()).length,
      ),
      relayAccess: Math.max(
        vacPhotoFiles.relayAccess.length,
        photoMetadataByField.relayAccess.filter((p) => p.publicUrl?.trim()).length,
      ),
      impactSensor: Math.max(
        vacPhotoFiles.impactSensor.length,
        photoMetadataByField.impactSensor.filter((p) => p.publicUrl?.trim()).length,
      ),
    }),
    [vacPhotoFiles, photoMetadataByField],
  );
  const vehiclePictureFileNames = useMemo((): VehiclePictureFileNames => {
    const out = emptyVehiclePictureFileNames();
    const keys: VehiclePictureKey[] = ["vehicleFront", "vehicleSide", "vehicleRear"];
    for (const k of keys) {
      const fromFiles = vehiclePictureFiles[k].map((f) => f.name);
      const fromMeta = photoMetadataByField[k].filter((p) => p.publicUrl?.trim()).map((p) => p.filename);
      out[k] = fromFiles.length > 0 ? fromFiles : fromMeta;
    }
    return out;
  }, [vehiclePictureFiles, photoMetadataByField]);
  const vehiclePictureCounts = useMemo(
    () => ({
      vehicleFront: Math.max(
        vehiclePictureFiles.vehicleFront.length,
        photoMetadataByField.vehicleFront.filter((p) => p.publicUrl?.trim()).length,
      ),
      vehicleSide: Math.max(
        vehiclePictureFiles.vehicleSide.length,
        photoMetadataByField.vehicleSide.filter((p) => p.publicUrl?.trim()).length,
      ),
      vehicleRear: Math.max(
        vehiclePictureFiles.vehicleRear.length,
        photoMetadataByField.vehicleRear.filter((p) => p.publicUrl?.trim()).length,
      ),
    }),
    [vehiclePictureFiles, photoMetadataByField],
  );

  const setVacPhotoUrlsSafe = (updater: (current: VacPhotoUrlsState) => VacPhotoUrlsState) => {
    setVacPhotoUrls((current) => {
      const next = updater(current);
      vacPhotoUrlsRef.current = next;
      return next;
    });
  };

  const setVehiclePictureUrlsSafe = (updater: (current: VehiclePictureUrlsState) => VehiclePictureUrlsState) => {
    setVehiclePictureUrls((current) => {
      const next = updater(current);
      vehiclePictureUrlsRef.current = next;
      return next;
    });
  };

  const setPhotoMetadataByFieldSafe = (updater: (current: PhotoMetadataByFieldState) => PhotoMetadataByFieldState) => {
    setPhotoMetadataByField((current) => {
      const next = updater(current);
      photoMetadataByFieldRef.current = next;
      return next;
    });
  };

  const getPhotoPersistenceSnapshot = () => {
    const metadataByField = photoMetadataByFieldRef.current;
    const uploads = (Object.values(metadataByField) as UploadedPhotoMetadata[][]).flat();
    const nextVacUrls = emptyVacPhotoUrls();
    for (const key of VAC_PHOTO_KEYS) {
      nextVacUrls[key] = metadataByField[key].map((p) => p.publicUrl).filter(Boolean);
    }
    const nextVehicleUrls = emptyVehiclePictureUrls();
    nextVehicleUrls.vehicleFront = metadataByField.vehicleFront.map((p) => p.publicUrl).filter(Boolean);
    nextVehicleUrls.vehicleSide = metadataByField.vehicleSide.map((p) => p.publicUrl).filter(Boolean);
    nextVehicleUrls.vehicleRear = metadataByField.vehicleRear.map((p) => p.publicUrl).filter(Boolean);
    vacPhotoUrlsRef.current = nextVacUrls;
    vehiclePictureUrlsRef.current = nextVehicleUrls;
    setVacPhotoUrls(nextVacUrls);
    setVehiclePictureUrls(nextVehicleUrls);
    return { photoUploads: uploads, vacPhotoUrls: nextVacUrls, vehiclePhotoUrls: nextVehicleUrls };
  };

  const requiredCoreValues = [
    coreJob.customer,
    coreJob.location,
    coreJob.workOrder,
    coreJob.serviceAppointment,
    coreJob.installerName,
  ];
  const requiredCoreFilledCount = requiredCoreValues.filter((v) => v.trim()).length;
  const hasCoreOrVehicleInfo = [
    coreJob.customer,
    coreJob.location,
    coreJob.workOrder,
    coreJob.serviceAppointment,
    coreJob.installerName,
    coreJob.equipmentMake,
    coreJob.equipmentModel,
    coreJob.equipmentSerial,
    coreJob.unitNumber,
  ].some((v) => v.trim());
  const coreSectionStatus: SectionStepStatus =
    requiredCoreFilledCount === 0
      ? "Not Started"
      : requiredCoreFilledCount === 5
        ? "Complete"
        : "In Progress";

  const hardwareSectionStatus: SectionStepStatus =
    !primary ? "Not Started" : hasAdditional === "Yes" || hasAdditional === "No" ? "Complete" : "In Progress";
  const hasAnsweredAdditionalHardwareQuestion = hasAdditional === "Yes" || hasAdditional === "No";

  const hardwareStatusSections = [...new Set(selectedSections)];

  const collectReviewValidationIssues = (): string[] => {
    const issues: string[] = [];
    if (!coreJob.customer.trim()) issues.push("core-customer");
    if (!coreJob.location.trim()) issues.push("core-location");
    if (!coreJob.workOrder.trim()) issues.push("core-workOrder");
    if (!coreJob.serviceAppointment.trim()) issues.push("core-serviceAppointment");
    if (!coreJob.equipmentMake.trim()) issues.push("vehicle-equipmentMake");
    if (!coreJob.equipmentModel.trim()) issues.push("vehicle-equipmentModel");
    if (!coreJob.unitNumber.trim()) issues.push("vehicle-unitNumber");
    if (!coreJob.equipmentSerial.trim()) issues.push("vehicle-equipmentSerial");
    if (vehiclePictureCounts.vehicleFront < 1) issues.push("photo-vehicleFront");
    if (vehiclePictureCounts.vehicleSide < 1) issues.push("photo-vehicleSide");
    if (!coreJob.installerName.trim()) issues.push("core-installerName");
    if (!primary) issues.push("hw-primary");
    if (hasAdditional !== "Yes" && hasAdditional !== "No") issues.push("hw-hasAdditional");

    if (!selectedSections.includes("VAC4")) return issues;

    const isElectricDrive = vac4DriveType === "Electric";
    const isInternalCombustionDrive = vac4DriveType === "Internal Combustion";
    const isBlueWireRequired = true;
    const isBrownWireRequired = isInternalCombustionDrive || (isElectricDrive && liftSenseInstalled === "Yes");

    if (!vac4VehicleType) issues.push("vac4-vehicleType");
    if (vac4VehicleType === "Other" && !vac4OtherVehicleType.trim()) issues.push("vac4-otherVehicleType");
    if (!vac4DriveType) issues.push("vac4-driveType");
    if (isElectricDrive) {
      if (!vac4VehicleVoltage.trim()) issues.push("vac4-vehicleVoltage");
      if (vac4VehicleVoltage === "Other" && !vac4VehicleVoltageOther.trim()) issues.push("vac4-vehicleVoltageOther");
    }
    if (!vac4ClientApproval.trim()) issues.push("vac4-clientApproval");
    if (!vac4HourMeter.trim()) issues.push("vac4-hourMeter");
    if (isElectricDrive && !liftSenseInstalled) issues.push("vac4-liftSense");
    if (!operatorPresenceInstalled) issues.push("vac4-operatorPresence");

    if (sensorHubInstalled === "Yes") {
      if (pc.sensorHubMounting < 1) issues.push("photo-sensorHubMounting");
      if (speedSenseInstalled === "Yes") {
        if (pc.speedSense < 1) issues.push("photo-speedSense");
        if (!speedSenseDescription.trim()) issues.push("vac4-speedSenseDescription");
        if (!speedSensePulseCount.trim()) issues.push("vac4-speedSensePulseCount");
      }
      if (loadSenseInstalled === "Yes") {
        if (pc.loadSense < 1) issues.push("photo-loadSense");
        if (!loadSenseThresholds.trim()) issues.push("vac4-loadSenseThresholds");
      }
      if (gpsInstalled === "Yes" && pc.gps < 1) issues.push("photo-gps");
      if (externalIndicatorInstalled === "Yes" && pc.externalIndicator < 1) issues.push("photo-externalIndicator");
    }

    if (pc.vacMounting < 1) issues.push("photo-vacMounting");
    if (pc.wirePath < 1) issues.push("photo-wirePath");
    if (pc.redWire < 1) issues.push("photo-redWire");
    if (!redWireDescription.trim()) issues.push("vac4-redWireDescription");
    if (pc.blackWire < 1) issues.push("photo-blackWire");
    if (!blackWireDescription.trim()) issues.push("vac4-blackWireDescription");
    if (isBlueWireRequired) {
      if (pc.blueWire < 1) issues.push("photo-blueWire");
      if (!blueWireDescription.trim()) issues.push("vac4-blueWireDescription");
    }
    if (operatorPresenceInstalled === "Yes") {
      if (pc.purpleWire < 1) issues.push("photo-purpleWire");
      if (!purpleWireDescription.trim()) issues.push("vac4-purpleWireDescription");
    }
    if (isBrownWireRequired) {
      if (pc.brownWire < 1) issues.push("photo-brownWire");
      if (!brownWireDescription.trim()) issues.push("vac4-brownWireDescription");
    }

    return issues;
  };

  const setCoreField = (key: keyof CoreJobFields, value: string) => {
    setCoreJob((prev) => ({ ...prev, [key]: value }));
    setReviewHighlights((prev) => {
      if (!prev.has(`core-${key}`)) return prev;
      const n = new Set(prev);
      n.delete(`core-${key}`);
      if (n.size === 0) queueMicrotask(() => setReviewBlockMessage(null));
      return n;
    });
  };

  const clearFieldHighlight = (fieldKey: string) => {
    setReviewHighlights((prev) => {
      if (!prev.has(fieldKey)) return prev;
      const next = new Set(prev);
      next.delete(fieldKey);
      if (next.size === 0) queueMicrotask(() => setReviewBlockMessage(null));
      return next;
    });
  };

  const uploadPhotosToStorage = async (group: "vac4" | "vehicle", fieldName: UploadFieldName, files: File[]) => {
    const uploadedUrls: string[] = [];
    const uploadedPhotos: UploadedPhotoMetadata[] = [];
    let ok = true;
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const stampedName = `${Date.now()}-${safeName}`;
      const objectPath = `${submissionId}/${group}/${fieldName}/${stampedName}`;
      const { error: uploadError } = await supabase.storage.from("job-card-photos").upload(objectPath, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
      if (uploadError) {
        console.error("Supabase upload failed:", {
          error: uploadError.message,
          submissionId,
          group,
          fieldName,
          filename: file.name,
          path: objectPath,
        });
        ok = false;
        continue;
      }
      const { data } = supabase.storage.from("job-card-photos").getPublicUrl(objectPath);
      const publicUrl = data?.publicUrl || "";
      if (publicUrl) {
        uploadedUrls.push(publicUrl);
        uploadedPhotos.push({
          fieldName,
          group,
          label: PHOTO_FIELD_LABELS[fieldName],
          filename: file.name,
          storagePath: objectPath,
          publicUrl,
          uploadedAt: new Date().toISOString(),
        });
      }
    }
    return { ok, uploadedUrls, uploadedPhotos };
  };

  const isVacPhotoField = (key: UploadFieldName): key is keyof VacPhotoFileNames => VAC_PHOTO_KEYS.includes(key as keyof VacPhotoFileNames);

  const isPhotoFieldRequiredNow = (field: UploadFieldName): boolean => {
    if (field === "vehicleFront" || field === "vehicleSide") return true;
    if (field === "vehicleRear") return false;
    if (!selectedSections.includes("VAC4")) return false;

    const isElectricDrive = vac4DriveType === "Electric";
    const isInternalCombustionDrive = vac4DriveType === "Internal Combustion";
    const isBrownWireRequired = isInternalCombustionDrive || (isElectricDrive && liftSenseInstalled === "Yes");

    switch (field) {
      case "vacMounting":
      case "wirePath":
      case "redWire":
      case "blackWire":
      case "blueWire":
        return true;
      case "brownWire":
        return isBrownWireRequired;
      case "purpleWire":
        return operatorPresenceInstalled === "Yes";
      case "sensorHubMounting":
        return sensorHubInstalled === "Yes";
      case "speedSense":
        return sensorHubInstalled === "Yes" && speedSenseInstalled === "Yes";
      case "loadSense":
        return sensorHubInstalled === "Yes" && loadSenseInstalled === "Yes";
      case "gps":
        return sensorHubInstalled === "Yes" && gpsInstalled === "Yes";
      case "externalIndicator":
        return sensorHubInstalled === "Yes" && externalIndicatorInstalled === "Yes";
      default:
        return false;
    }
  };

  const updatePhotoFieldHighlight = (field: UploadFieldName, nextCount: number) => {
    const key = `photo-${field}`;
    if (nextCount < 1 && isPhotoFieldRequiredNow(field)) {
      setReviewHighlights((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      return;
    }
    setReviewHighlights((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      if (next.size === 0) queueMicrotask(() => setReviewBlockMessage(null));
      return next;
    });
  };

  const removeLocalPhotoFromField = (field: UploadFieldName, targetFile: File) => {
    const targetKey = localFileDedupeKey(targetFile);
    if (isVacPhotoField(field)) {
      const nextLocal = vacPhotoFiles[field].filter((f) => localFileDedupeKey(f) !== targetKey);
      setVacPhotoFiles((p) => ({ ...p, [field]: nextLocal }));
      const nextCount = Math.max(nextLocal.length, photoMetadataByFieldRef.current[field].filter((m) => m.publicUrl?.trim()).length);
      updatePhotoFieldHighlight(field, nextCount);
      return;
    }
    const nextLocal = vehiclePictureFiles[field].filter((f) => localFileDedupeKey(f) !== targetKey);
    setVehiclePictureFiles((p) => ({ ...p, [field]: nextLocal }));
    const nextCount = Math.max(nextLocal.length, photoMetadataByFieldRef.current[field].filter((m) => m.publicUrl?.trim()).length);
    updatePhotoFieldHighlight(field, nextCount);
  };

  const removeUploadedPhotoFromField = async (field: UploadFieldName, target: RemoteThumb) => {
    const targetStorage = (target.storagePath || "").trim();
    const targetUrl = normalizePublicUrlForDedupe(target.publicUrl || "");
    const targetName = normalizePhotoFilename(target.filename || "");

    const nextMeta = photoMetadataByFieldRef.current[field].filter((m) => {
      const metaStorage = (m.storagePath || "").trim();
      if (targetStorage) return metaStorage !== targetStorage;
      const metaUrl = normalizePublicUrlForDedupe(m.publicUrl || "");
      if (targetUrl) return metaUrl !== targetUrl;
      return normalizePhotoFilename(m.filename || "") !== targetName;
    });

    setPhotoMetadataByFieldSafe((p) => ({ ...p, [field]: nextMeta }));
    const nextUrls = nextMeta.map((m) => m.publicUrl).filter(Boolean);
    if (isVacPhotoField(field)) {
      setVacPhotoUrlsSafe((p) => ({ ...p, [field]: nextUrls }));
    } else {
      setVehiclePictureUrlsSafe((p) => ({ ...p, [field]: nextUrls }));
    }
    const localCount = isVacPhotoField(field) ? vacPhotoFiles[field].length : vehiclePictureFiles[field].length;
    updatePhotoFieldHighlight(field, Math.max(localCount, nextUrls.length));

    if (targetStorage) {
      void deleteJobCardPhotoObject(targetStorage);
    }
  };

  const applyVacPhotoUpload = async (key: keyof VacPhotoFileNames, e: ChangeEvent<HTMLInputElement>, mode: "single" | "multi") => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";

    const overSize = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (overSize) {
      setVacPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_SIZE }));
      return;
    }

    if (picked.length === 0) {
      setVacPhotoFiles((p) => ({ ...p, [key]: [] }));
      setVacPhotoUrlsSafe((p) => ({ ...p, [key]: [] }));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [key]: [] }));
      setVacPhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(`photo-${String(key)}`);
      return;
    }

    if (mode === "single") {
      const prevMeta = [...photoMetadataByFieldRef.current[key]];
      setVacPhotoFiles((p) => ({ ...p, [key]: [picked[0]] }));
      const uploadResult = await uploadPhotosToStorage("vac4", key, [picked[0]]);
      const nextMeta = dedupeUploadedPhotoMeta(uploadResult.uploadedPhotos);
      if (!uploadResult.ok || nextMeta.length === 0) {
        setVacPhotoUrlsSafe((p) => ({ ...p, [key]: prevMeta.map((m) => m.publicUrl).filter(Boolean) }));
        setPhotoMetadataByFieldSafe((p) => ({ ...p, [key]: prevMeta }));
        setVacPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_UPLOAD_FAILED }));
        clearFieldHighlight(`photo-${String(key)}`);
        return;
      }
      setVacPhotoUrlsSafe((p) => ({ ...p, [key]: nextMeta.map((m) => m.publicUrl).filter(Boolean) }));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [key]: nextMeta }));
      setVacPhotoFiles((p) => ({ ...p, [key]: [] }));
      for (const m of prevMeta) {
        if (m.storagePath && !nextMeta.some((n) => n.storagePath === m.storagePath)) {
          void deleteJobCardPhotoObject(m.storagePath);
        }
      }
      setVacPhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(`photo-${String(key)}`);
      return;
    }

    const currentCount = Math.max(
      vacPhotoFiles[key].length,
      photoMetadataByFieldRef.current[key].filter((p) => p.publicUrl?.trim()).length,
    );
    if (currentCount + picked.length > MAX_PHOTOS_PER_FIELD) {
      setVacPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_MAX_COUNT }));
      return;
    }

    const merged = [...vacPhotoFiles[key], ...picked];
    setVacPhotoFiles((p) => ({ ...p, [key]: merged }));
    const uploadResult = await uploadPhotosToStorage("vac4", key, picked);
    const nextMeta = dedupeUploadedPhotoMeta([...photoMetadataByFieldRef.current[key], ...uploadResult.uploadedPhotos]).slice(
      0,
      MAX_PHOTOS_PER_FIELD,
    );
    setVacPhotoUrlsSafe((p) => ({ ...p, [key]: nextMeta.map((m) => m.publicUrl).filter(Boolean) }));
    setPhotoMetadataByFieldSafe((p) => ({ ...p, [key]: nextMeta }));
    setVacPhotoErrors((er) => ({ ...er, [key]: uploadResult.ok ? null : UPLOAD_ERR_UPLOAD_FAILED }));
    if (uploadResult.ok) {
      setVacPhotoFiles((p) => ({ ...p, [key]: [] }));
    }
    clearFieldHighlight(`photo-${String(key)}`);
  };

  const applyVehiclePhotoUpload = async (key: VehiclePictureKey, e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";

    if (picked.length === 0) {
      setVehiclePictureFiles((p) => ({ ...p, [key]: [] }));
      setVehiclePictureUrlsSafe((p) => ({ ...p, [key]: [] }));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [key]: [] }));
      setVehiclePictureErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(`photo-${key}`);
      return;
    }

    const hasInvalidType = picked.some((f) => {
      const mime = f.type.toLowerCase();
      const name = f.name.toLowerCase();
      const allowedMime = mime === "image/jpeg" || mime === "image/png";
      const allowedExt = name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
      return !(allowedMime || allowedExt);
    });
    if (hasInvalidType) {
      setVehiclePictureErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_TYPE }));
      return;
    }

    const overSize = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (overSize) {
      setVehiclePictureErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_SIZE }));
      return;
    }

    if (picked.length > MAX_PHOTOS_PER_FIELD) {
      setVehiclePictureErrors((er) => ({ ...er, [key]: UPLOAD_ERR_MAX_COUNT }));
      return;
    }

    const prevMeta = [...photoMetadataByFieldRef.current[key]];
    setVehiclePictureFiles((p) => ({ ...p, [key]: picked }));
    const uploadResult = await uploadPhotosToStorage("vehicle", key, picked);
    const nextMeta = dedupeUploadedPhotoMeta(uploadResult.uploadedPhotos);
    if (!uploadResult.ok || nextMeta.length === 0) {
      setVehiclePictureUrlsSafe((p) => ({ ...p, [key]: prevMeta.map((m) => m.publicUrl).filter(Boolean) }));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [key]: prevMeta }));
      setVehiclePictureErrors((er) => ({ ...er, [key]: UPLOAD_ERR_UPLOAD_FAILED }));
      clearFieldHighlight(`photo-${key}`);
      return;
    }
    setVehiclePictureUrlsSafe((p) => ({ ...p, [key]: nextMeta.map((m) => m.publicUrl).filter(Boolean) }));
    setPhotoMetadataByFieldSafe((p) => ({ ...p, [key]: nextMeta }));
    setVehiclePictureFiles((p) => ({ ...p, [key]: [] }));
    for (const m of prevMeta) {
      if (m.storagePath && !nextMeta.some((n) => n.storagePath === m.storagePath)) {
        void deleteJobCardPhotoObject(m.storagePath);
      }
    }
    setVehiclePictureErrors((er) => ({ ...er, [key]: null }));
    clearFieldHighlight(`photo-${key}`);
  };

  const handleReviewClick = () => {
    setSubmitSuccessMessage(null);
    setEmailSubmissionPreview(null);
    const issues = collectReviewValidationIssues();
    if (issues.length > 0) {
      setReviewHighlights(new Set(issues));
      setReviewBlockMessage("Please complete the highlighted required fields and photos.");
      queueMicrotask(() => {
        document.getElementById(`field-${issues[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setReviewHighlights(new Set());
    setReviewBlockMessage(null);
    setStep("review");
  };

  const buildSubmissionPayload = (): JobCardSubmissionPayload => {
    const photoSnapshot = getPhotoPersistenceSnapshot();
    return {
      submissionId,
      submissionTimestamp: new Date().toISOString(),
      status: "Submitted",
      coreJobInfo: { ...coreJob },
      hardwareSelection: {
        primary,
        hasAdditional,
        additional: [...additional],
      },
      selectedSections: [...selectedSections],
      photoUploads: [...photoSnapshot.photoUploads],
      vac4: {
      vehicleType: vac4VehicleType,
      otherVehicleType: vac4OtherVehicleType,
      driveType: vac4DriveType,
      vehicleVoltage: vac4VehicleVoltage,
      vehicleVoltageOther: vac4VehicleVoltageOther,
      clientApproval: vac4ClientApproval,
      hourMeter: vac4HourMeter,
      sensorHubInstalled,
      liftSenseInstalled,
      operatorPresenceInstalled,
      speedSenseInstalled,
      loadSenseInstalled,
      gpsInstalled,
      externalIndicatorInstalled,
      speedSenseDescription,
      speedSensePulseCount,
      loadSenseThresholds,
      redWireDescription,
      blackWireDescription,
      blueWireDescription,
      brownWireDescription,
      purpleWireDescription,
      relayAccessDescription,
      impactSensorDescription,
      photoCounts: {
        vacMounting: pc.vacMounting,
        wirePath: pc.wirePath,
        redWire: pc.redWire,
        blackWire: pc.blackWire,
        blueWire: pc.blueWire,
        brownWire: pc.brownWire,
        sensorHubMounting: pc.sensorHubMounting,
        speedSense: pc.speedSense,
        loadSense: pc.loadSense,
        gps: pc.gps,
        externalIndicator: pc.externalIndicator,
      },
      photoFileNames: { ...vacPhotoFileNames },
      photoUrls: { ...photoSnapshot.vacPhotoUrls },
      },
    };
  };

  const handleFinalSubmit = () => {
    const payload = buildSubmissionPayload();
    console.log("[Job card submission]", payload);
    setSubmitSuccessMessage(null);
    setPendingEmailPayload(payload);
    setEmailSendStatus("idle");
    setEmailSendErrorMessage(null);
    const previewTo = configuredPreviewTo || DEFAULT_JOB_CARD_EMAIL_TO;
    setEmailSubmissionPreview({
      to: previewTo,
      toLabel: configuredPreviewTo ? "To:" : "To (preview fallback):",
      subject: formatEmailSubject(payload.coreJobInfo.customer, payload.coreJobInfo.unitNumber),
      body: formatEmailBodyFromPayload(payload),
    });
    setReviewHighlights(new Set());
    setReviewBlockMessage(null);
    setStep("form");
  };

  const handleConfirmSendEmail = async () => {
    if (!pendingEmailPayload) return;
    setEmailSendStatus("sending");
    setEmailSendErrorMessage(null);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: pendingEmailPayload }),
      });
      let data: { error?: string } = {};
      try {
        data = (await res.json()) as { error?: string };
      } catch {
        /* ignore non-JSON */
      }
      if (!res.ok) {
        setEmailSendStatus("error");
        setEmailSendErrorMessage(
          typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
        );
        return;
      }
      setEmailSendStatus("success");
      setSubmissionStatus("Submitted");
      setSubmissionCompletedAt(Date.now());
      setSubmitSuccessMessage("Job card submitted successfully.");
      const submittedPayload = pendingEmailPayload;
      try {
        const createdAt = new Date().toISOString();
        const { error: insertError } = await supabase.from("job_card_submissions").insert({
          submission_id: submittedPayload.submissionId,
          customer: submittedPayload.coreJobInfo.customer.trim() || "—",
          unit_number: submittedPayload.coreJobInfo.unitNumber.trim() || "—",
          payload: submittedPayload,
          created_at: createdAt,
        });
        if (insertError) throw insertError;
        const { error: deleteDraftError } = await supabase
          .from("job_card_drafts")
          .delete()
          .eq("submission_id", submittedPayload.submissionId);
        if (deleteDraftError) throw deleteDraftError;
      } catch (e) {
        console.error("Supabase post-submit sync failed:", e);
      }
      try {
        window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_ID_KEY);
        window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_PAYLOAD_KEY);
        const drafts = readMigratedDraftsFromStorage();
        const next = drafts.filter((d) => (d.submissionId || d.id) !== submissionId);
        window.localStorage.setItem(JOB_CARD_DRAFTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore localStorage cleanup errors
      }
    } catch (e) {
      setEmailSendStatus("error");
      setEmailSendErrorMessage(e instanceof Error ? e.message : "Network error");
    }
  };

  const handleBackToForm = () => {
    setReviewHighlights(new Set());
    setReviewBlockMessage(null);
    setStep("form");
  };

  const restoreFromDraftData = (draft: StoredJobCardDraft["data"], restoredSubmissionId: string) => {
    setSubmissionId(restoredSubmissionId);
    setCoreJob((prev) => ({ ...prev, ...draft.coreJob }));
    setPrimary(draft.hardwareSelection?.primary || "");
    setHasAdditional(draft.hardwareSelection?.hasAdditional || "");
    setAdditional(Array.isArray(draft.hardwareSelection?.additional) ? draft.hardwareSelection.additional : []);
    setVac4VehicleType(String(draft.vac4?.vehicleType || ""));
    setVac4OtherVehicleType(String(draft.vac4?.otherVehicleType || ""));
    setVac4DriveType(String(draft.vac4?.driveType || ""));
    setVac4VehicleVoltage(String(draft.vac4?.vehicleVoltage || ""));
    setVac4VehicleVoltageOther(String(draft.vac4?.vehicleVoltageOther || ""));
    setVac4ClientApproval(String(draft.vac4?.clientApproval || ""));
    setVac4HourMeter(String(draft.vac4?.hourMeter || ""));
    setSensorHubInstalled(String(draft.vac4?.sensorHubInstalled || ""));
    setLiftSenseInstalled(String(draft.vac4?.liftSenseInstalled || ""));
    setOperatorPresenceInstalled(String(draft.vac4?.operatorPresenceInstalled || ""));
    setSpeedSenseInstalled(String(draft.vac4?.speedSenseInstalled || ""));
    setLoadSenseInstalled(String(draft.vac4?.loadSenseInstalled || ""));
    setGpsInstalled(String(draft.vac4?.gpsInstalled || ""));
    setExternalIndicatorInstalled(String(draft.vac4?.externalIndicatorInstalled || ""));
    setSpeedSenseDescription(String(draft.vac4?.speedSenseDescription || ""));
    setSpeedSensePulseCount(String(draft.vac4?.speedSensePulseCount || ""));
    setLoadSenseThresholds(String(draft.vac4?.loadSenseThresholds || ""));
    setRedWireDescription(String(draft.vac4?.redWireDescription || ""));
    setBlackWireDescription(String(draft.vac4?.blackWireDescription || ""));
    setBlueWireDescription(String(draft.vac4?.blueWireDescription || ""));
    setBrownWireDescription(String(draft.vac4?.brownWireDescription || ""));
    setPurpleWireDescription(String(draft.vac4?.purpleWireDescription || ""));
    setRelayAccessDescription(String(draft.vac4?.relayAccessDescription || ""));
    setImpactSensorDescription(String(draft.vac4?.impactSensorDescription || ""));
    // Files cannot be restored from localStorage; rebuild photo state from saved metadata.
    setVacPhotoFiles(emptyVacPhotoFiles());
    const restoredUploads = draft.photoUploads || draft.photoSummary?.photoUploads || [];
    const restoredMetadataByField = emptyPhotoMetadataByField();
    for (const photo of restoredUploads) {
      const key = photo.fieldName as UploadFieldName;
      if (key in restoredMetadataByField) {
        restoredMetadataByField[key].push(photo);
      }
    }
    const allPhotoFieldKeys: UploadFieldName[] = [
      ...VAC_PHOTO_KEYS,
      "vehicleFront",
      "vehicleSide",
      "vehicleRear",
    ];
    for (const k of allPhotoFieldKeys) {
      restoredMetadataByField[k] = dedupeUploadedPhotoMeta(restoredMetadataByField[k]);
    }
    photoMetadataByFieldRef.current = restoredMetadataByField;
    setPhotoMetadataByField(restoredMetadataByField);

    const nextVacPhotoUrls = emptyVacPhotoUrls();
    for (const k of VAC_PHOTO_KEYS) {
      nextVacPhotoUrls[k] = restoredMetadataByField[k].map((m) => m.publicUrl).filter(Boolean);
    }
    vacPhotoUrlsRef.current = nextVacPhotoUrls;
    setVacPhotoUrls(nextVacPhotoUrls);

    const nextVehiclePhotoUrls = emptyVehiclePictureUrls();
    nextVehiclePhotoUrls.vehicleFront = restoredMetadataByField.vehicleFront.map((m) => m.publicUrl).filter(Boolean);
    nextVehiclePhotoUrls.vehicleSide = restoredMetadataByField.vehicleSide.map((m) => m.publicUrl).filter(Boolean);
    nextVehiclePhotoUrls.vehicleRear = restoredMetadataByField.vehicleRear.map((m) => m.publicUrl).filter(Boolean);
    vehiclePictureUrlsRef.current = nextVehiclePhotoUrls;
    setVehiclePictureUrls(nextVehiclePhotoUrls);

    setVacPhotoErrors(emptyVacPhotoErrors());
    setVehiclePictureFiles(emptyVehiclePictureFiles());
    setVehiclePictureErrors(emptyVehiclePictureErrors());
    setReviewHighlights(new Set());
    setReviewBlockMessage(null);
    setStep("form");
    setDraftNoticeMessage(
      restoredUploads.length > 0 ? "Draft restored." : "Draft restored. Please re-upload photos before submitting.",
    );
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const resumePayloadRaw = window.localStorage.getItem(JOB_CARD_RESUME_DRAFT_PAYLOAD_KEY);
    if (resumePayloadRaw) {
      try {
        const parsed = JSON.parse(resumePayloadRaw) as {
          submissionId?: string;
          data?: StoredJobCardDraft["data"];
        };
        const resumePayload = parsed?.data;
        if (resumePayload) {
          const restoredId = parsed.submissionId || generateSubmissionId();
          setTimeout(() => restoreFromDraftData(resumePayload, restoredId), 0);
        }
      } catch {
        // ignore parse errors and continue with legacy resume id path
      }
      window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_PAYLOAD_KEY);
      window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_ID_KEY);
      return;
    }

    const resumeDraftId = window.localStorage.getItem(JOB_CARD_RESUME_DRAFT_ID_KEY);
    if (!resumeDraftId) return;
    try {
      const drafts = readMigratedDraftsFromStorage();
      const match = drafts.find((d) => (d.submissionId || d.id) === resumeDraftId);
      if (match) {
        const restoredId = match.submissionId || match.id || generateSubmissionId();
        setTimeout(() => restoreFromDraftData(match.data, restoredId), 0);
      }
      window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_ID_KEY);
    } catch {
      window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_ID_KEY);
    }
  }, []);

  const saveDraftLocally = (nextDraft: StoredJobCardDraft) => {
    const currentDrafts = readMigratedDraftsFromStorage();
    const existingIndex = currentDrafts.findIndex((d) => (d.submissionId || d.id) === submissionId);
    const nextDrafts =
      existingIndex >= 0
        ? currentDrafts.map((d, idx) => (idx === existingIndex ? nextDraft : d))
        : [nextDraft, ...currentDrafts];
    window.localStorage.setItem(JOB_CARD_DRAFTS_STORAGE_KEY, JSON.stringify(nextDrafts));
  };

  const handleSaveDraft = async () => {
    const photoSnapshot = getPhotoPersistenceSnapshot();
    const draftData: StoredJobCardDraft["data"] = {
      coreJob,
      hardwareSelection: { primary, hasAdditional, additional },
      vac4: {
        vehicleType: vac4VehicleType,
        otherVehicleType: vac4OtherVehicleType,
        driveType: vac4DriveType,
        vehicleVoltage: vac4VehicleVoltage,
        vehicleVoltageOther: vac4VehicleVoltageOther,
        clientApproval: vac4ClientApproval,
        hourMeter: vac4HourMeter,
        sensorHubInstalled,
        liftSenseInstalled,
        operatorPresenceInstalled,
        speedSenseInstalled,
        loadSenseInstalled,
        gpsInstalled,
        externalIndicatorInstalled,
        speedSenseDescription,
        speedSensePulseCount,
        loadSenseThresholds,
        redWireDescription,
        blackWireDescription,
        blueWireDescription,
        brownWireDescription,
        purpleWireDescription,
        relayAccessDescription,
        impactSensorDescription,
      },
      photoUploads: photoSnapshot.photoUploads,
      photoSummary: {
        vac4PhotoFileNames: vacPhotoFileNames,
        vac4PhotoUrls: photoSnapshot.vacPhotoUrls,
        vac4PhotoCounts: pc,
        vehiclePhotoFileNames: vehiclePictureFileNames,
        vehiclePhotoUrls: photoSnapshot.vehiclePhotoUrls,
        vehiclePhotoCounts: vehiclePictureCounts,
        photoUploads: photoSnapshot.photoUploads,
      },
    };
    const updatedAt = new Date().toISOString();
    const nextDraft: StoredJobCardDraft = {
      submissionId,
      customer: coreJob.customer.trim() || "—",
      unitNumber: coreJob.unitNumber.trim() || "—",
      savedAt: updatedAt,
      data: draftData,
    };

    try {
      const { error } = await supabase.from("job_card_drafts").upsert(
        {
          submission_id: submissionId,
          customer: nextDraft.customer,
          unit_number: nextDraft.unitNumber,
          payload: draftData,
          updated_at: updatedAt,
        },
        { onConflict: "submission_id" },
      );
      if (error) throw error;
      try {
        saveDraftLocally(nextDraft);
      } catch {
        // ignore local cache sync errors when cloud save succeeds
      }
      setDraftNoticeMessage("Draft saved to cloud.");
    } catch {
      try {
        saveDraftLocally(nextDraft);
        setDraftNoticeMessage("Draft saved locally.");
      } catch {
        setDraftNoticeMessage("Unable to save draft locally.");
      }
    }
  };

  const handleExitToHome = () => {
    router.push("/");
  };

  const handleSaveDraftAndExit = async () => {
    if (hasCoreOrVehicleInfo) {
      await handleSaveDraft();
    }
    router.push("/");
  };

  const hl = (key: string) => reviewHighlights.has(key);
  const fieldInputClass = (key: string) =>
    `${inputClassName}${hl(key) ? " border-red-500 ring-2 ring-red-100" : ""}`;
  const fieldSelectClass = (key: string) =>
    `${selectClassName}${hl(key) ? " border-red-500 ring-2 ring-red-100" : ""}`;
  const fieldLabelClass = (key: string) => `${labelClassName}${hl(key) ? " text-red-600" : ""}`;
  const requiredHint = (key: string) =>
    hl(key) ? <p className="mt-1 text-sm font-medium text-red-600">Required</p> : null;

  const photoPickClass = (photoKey: string, required: boolean, complete: boolean) => {
    let extra = "";
    if (hl(photoKey)) extra = " border-red-500 border-dashed ring-2 ring-red-100";
    else if (required && complete) extra = " border-emerald-500 border-dashed";
    return `${photoPickClassName}${extra}`;
  };
  const isJobCardSubmitted = submissionStatus === "Submitted" && emailSendStatus === "success";

  return (
    <div className="min-h-screen bg-slate-50 pb-32 sm:pb-36 md:pb-10">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:space-y-6 sm:px-5 sm:py-6">
        <header className={headerCardClassName}>
          <div className="flex flex-col items-start gap-1.5">
            <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Installer Job Card</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-blue-700 ring-1 ring-inset ring-blue-200/80 sm:px-3 sm:py-1">
                <IconDocument className="h-3.5 w-3.5 shrink-0" />
                DRAFT
              </span>
            </div>
            <p className="text-base font-medium leading-tight text-gray-600">Complete one job card per unit.</p>
          </div>
        </header>

        {draftNoticeMessage && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900" role="status">
            {draftNoticeMessage}
          </div>
        )}

        {submitSuccessMessage && (
          <div
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm"
            role="status"
          >
            <p className="text-sm font-semibold text-emerald-950 sm:text-base">{submitSuccessMessage}</p>
          </div>
        )}

        {emailSubmissionPreview && (
          <section className={cardClassName} aria-labelledby="email-preview-heading">
            <h2 id="email-preview-heading" className="mb-1 text-lg font-bold text-gray-900">
              Email preview
            </h2>
            <p className="mb-4 text-sm text-gray-600">
              Review the message below. Confirm & Send Email posts this job card to the server; delivery requires SMTP
              environment variables on the server.
            </p>
            <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-900 shadow-inner">
              <div>
                <span className="font-semibold text-gray-600">{emailSubmissionPreview.toLabel}</span>{" "}
                <span className="break-all font-mono">{emailSubmissionPreview.to}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-600">Subject:</span>{" "}
                <span className="break-words font-medium">{emailSubmissionPreview.subject}</span>
              </div>
              <div>
                <p className="mb-2 font-semibold text-gray-600">Body</p>
                <pre className="max-h-[min(70vh,28rem)] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-white p-4 font-sans text-sm leading-relaxed text-gray-800">
                  {emailSubmissionPreview.body}
                </pre>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {!isJobCardSubmitted && (
                <button
                  type="button"
                  className={btnPrimaryClassName}
                  disabled={emailSendStatus === "sending" || !pendingEmailPayload}
                  onClick={handleConfirmSendEmail}
                >
                  {emailSendStatus === "sending" ? "Sending…" : "Confirm & Send Email"}
                </button>
              )}
              {emailSendStatus === "success" && (
                <p className="text-sm font-semibold text-emerald-800" role="status">
                  Email sent successfully.
                </p>
              )}
              {emailSendStatus === "error" && emailSendErrorMessage && (
                <p className="text-sm font-semibold text-red-700" role="alert">
                  {emailSendErrorMessage}
                </p>
              )}
              {isJobCardSubmitted && (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    <p className="font-semibold">Submission status: Submitted</p>
                    <p className="mt-1">
                      Submitted at:{" "}
                      {submissionCompletedAt ? new Date(submissionCompletedAt).toLocaleString() : "Just now"}
                    </p>
                  </div>
                  <div className="mt-2 flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <Link
                      href="/"
                      className={`${btnSecondaryClassName} w-full flex-1 text-center sm:min-w-[160px]`}
                    >
                      Return to Home
                    </Link>
                    <button
                      type="button"
                      className={`${btnSecondaryClassName} w-full flex-1 sm:min-w-[160px]`}
                      onClick={() => window.location.assign("/new-submission")}
                    >
                      Start New Job Card
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {!isJobCardSubmitted && !emailSubmissionPreview && (step === "form" ? (
        <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <SectionStatusCard title="Core Job Info" tone="blue" icon={IconClipboard} status={coreSectionStatus} />
          <SectionStatusCard title="Hardware Selection" tone="green" icon={IconChip} status={hardwareSectionStatus} />
          {hardwareStatusSections.map((section) => (
            <SectionStatusCard
              key={section}
              title={`${section} Section`}
              tone={section === "VAC4" ? "purple" : "green"}
              icon={section === "VAC4" ? IconGear : IconChip}
              status="In Progress"
            />
          ))}
        </div>

        {reviewBlockMessage && (
          <div
            className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 text-base font-semibold text-red-900 shadow-sm"
            role="alert"
          >
            {reviewBlockMessage}
          </div>
        )}

        {/* Core Info */}
        <section className={cardClassName}>
          <FormSectionHeader title="Core Job Info" tone="blue" />

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-x-6 md:gap-y-5">
            <div id="field-core-customer">
              <label className={fieldLabelClass("core-customer")}>
                Customer
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-customer")}
                placeholder="exp: Acme Logistics"
                value={coreJob.customer}
                onChange={(e) => setCoreField("customer", e.target.value)}
              />
              {requiredHint("core-customer")}
            </div>

            <div id="field-core-location">
              <label className={fieldLabelClass("core-location")}>
                Location
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-location")}
                placeholder="exp: Atlanta, GA"
                value={coreJob.location}
                onChange={(e) => setCoreField("location", e.target.value)}
              />
              {requiredHint("core-location")}
            </div>

            <div id="field-core-workOrder">
              <label className={fieldLabelClass("core-workOrder")}>
                Work Order #
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-workOrder")}
                placeholder="exp: WO-12345"
                value={coreJob.workOrder}
                onChange={(e) => setCoreField("workOrder", e.target.value)}
              />
              {requiredHint("core-workOrder")}
            </div>

            <div id="field-core-serviceAppointment">
              <label className={fieldLabelClass("core-serviceAppointment")}>
                Service Appointment #
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-serviceAppointment")}
                placeholder="exp: SA-98765"
                value={coreJob.serviceAppointment}
                onChange={(e) => setCoreField("serviceAppointment", e.target.value)}
              />
              {requiredHint("core-serviceAppointment")}
            </div>

            <div id="field-core-installerName">
              <label className={fieldLabelClass("core-installerName")}>
                Installer Name
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-installerName")}
                placeholder="exp: John Smith"
                value={coreJob.installerName}
                onChange={(e) => setCoreField("installerName", e.target.value)}
              />
              {requiredHint("core-installerName")}
            </div>
          </div>
        </section>

        {/* Vehicle Information */}
        <section className={cardClassName}>
          <FormSectionHeader title="Vehicle Information" tone="purple" />

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-x-6 md:gap-y-5">
            <div id="field-vehicle-equipmentMake">
              <label className={fieldLabelClass("vehicle-equipmentMake")}>
                Make
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("vehicle-equipmentMake")}
                placeholder="exp: Toyota"
                value={coreJob.equipmentMake}
                onChange={(e) => setCoreField("equipmentMake", e.target.value)}
              />
              {requiredHint("vehicle-equipmentMake")}
            </div>

            <div id="field-vehicle-equipmentModel">
              <label className={fieldLabelClass("vehicle-equipmentModel")}>
                Model
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("vehicle-equipmentModel")}
                placeholder="exp: 8FBE20U"
                value={coreJob.equipmentModel}
                onChange={(e) => setCoreField("equipmentModel", e.target.value)}
              />
              {requiredHint("vehicle-equipmentModel")}
            </div>

            <div id="field-vehicle-serialNumber">
              <label className={fieldLabelClass("vehicle-equipmentSerial")}>
                Serial #
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("vehicle-equipmentSerial")}
                placeholder="exp: SN123456"
                value={coreJob.equipmentSerial}
                onChange={(e) => setCoreField("equipmentSerial", e.target.value)}
              />
              {requiredHint("vehicle-equipmentSerial")}
            </div>

            <div id="field-vehicle-unitNumber">
              <label className={fieldLabelClass("vehicle-unitNumber")}>
                Unit #
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("vehicle-unitNumber")}
                placeholder="exp: UNIT-42"
                value={coreJob.unitNumber}
                onChange={(e) => setCoreField("unitNumber", e.target.value)}
              />
              {requiredHint("vehicle-unitNumber")}
            </div>

            <div id="field-vac4-vehicleType">
              <label className={fieldLabelClass("vac4-vehicleType")}>
                Vehicle Type
                <RequiredMark />
              </label>
              <select
                className={fieldSelectClass("vac4-vehicleType")}
                value={vac4VehicleType}
                onChange={(e) => {
                  setVac4VehicleType(e.target.value);
                  clearFieldHighlight("vac4-vehicleType");
                }}
              >
                <option value="" className="text-gray-400">
                  Select vehicle type
                </option>
                <option>Forklift Rider</option>
                <option>Forklift Stand-up</option>
                <option>Man Lift</option>
                <option>Order Picker</option>
                <option>Pallet Jack Rider</option>
                <option>Pallet Jack Walkie</option>
                <option>Reach Truck</option>
                <option>Stacker Rider</option>
                <option>Stacker Walkie</option>
                <option>Sweeper/Scrubber</option>
                <option>Tugger/Tow Tractor</option>
                <option>Turret Truck</option>
                <option>Other</option>
              </select>
              {requiredHint("vac4-vehicleType")}
            </div>

            <div id="field-vac4-driveType">
              <label className={fieldLabelClass("vac4-driveType")}>
                Drive Type
                <RequiredMark />
              </label>
              <select
                className={fieldSelectClass("vac4-driveType")}
                value={vac4DriveType}
                onChange={(e) => {
                  const v = e.target.value;
                  setVac4DriveType(v);
                  clearFieldHighlight("vac4-driveType");
                  if (v !== "Electric") {
                    setVac4VehicleVoltage("");
                    setVac4VehicleVoltageOther("");
                  }
                }}
              >
                <option value="" className="text-gray-400">
                  Select drive type
                </option>
                <option>Electric</option>
                <option>Internal Combustion</option>
                <option>Other</option>
              </select>
              {requiredHint("vac4-driveType")}
            </div>

            {vac4DriveType === "Electric" && (
              <div className="space-y-5 md:col-span-2">
                <div id="field-vac4-vehicleVoltage">
                  <label className={fieldLabelClass("vac4-vehicleVoltage")}>
                    Voltage
                    <RequiredMark />
                  </label>
                  <select
                    className={fieldSelectClass("vac4-vehicleVoltage")}
                    value={vac4VehicleVoltage}
                    onChange={(e) => {
                      setVac4VehicleVoltage(e.target.value);
                      clearFieldHighlight("vac4-vehicleVoltage");
                      if (e.target.value !== "Other") {
                        setVac4VehicleVoltageOther("");
                      }
                    }}
                  >
                    <option value="" className="text-gray-400">
                      Select voltage
                    </option>
                    <option value="12">12</option>
                    <option value="24">24</option>
                    <option value="36">36</option>
                    <option value="48">48</option>
                    <option value="60">60</option>
                    <option value="80">80</option>
                    <option value="Other">Other</option>
                  </select>
                  {requiredHint("vac4-vehicleVoltage")}
                </div>
                {vac4VehicleVoltage === "Other" && (
                  <div id="field-vac4-vehicleVoltageOther">
                    <label className={fieldLabelClass("vac4-vehicleVoltageOther")}>
                      Other Voltage
                      <RequiredMark />
                    </label>
                    <input
                      className={fieldInputClass("vac4-vehicleVoltageOther")}
                      placeholder="exp: 72"
                      value={vac4VehicleVoltageOther}
                      onChange={(e) => {
                        setVac4VehicleVoltageOther(e.target.value);
                        clearFieldHighlight("vac4-vehicleVoltageOther");
                      }}
                    />
                    {requiredHint("vac4-vehicleVoltageOther")}
                  </div>
                )}
              </div>
            )}

            {vac4VehicleType === "Other" && (
              <div id="field-vac4-otherVehicleType" className="md:col-span-2">
                <label className={fieldLabelClass("vac4-otherVehicleType")}>
                  Other Vehicle Type
                  <RequiredMark />
                </label>
                <input
                  className={fieldInputClass("vac4-otherVehicleType")}
                  placeholder="exp: Burden Carrier"
                  value={vac4OtherVehicleType}
                  onChange={(e) => {
                    setVac4OtherVehicleType(e.target.value);
                    clearFieldHighlight("vac4-otherVehicleType");
                  }}
                />
                {requiredHint("vac4-otherVehicleType")}
              </div>
            )}
          </div>
        </section>

        {/* Vehicle Pictures */}
        <section className={cardClassName}>
          <FormSectionHeader title="Vehicle Pictures" tone="purple" />

          <div className="space-y-5">
            <div id="field-photo-vehicleFront">
              <label className={fieldLabelClass("photo-vehicleFront")}>
                Vehicle Front Picture
                <RequiredMark />
              </label>
              <input
                id="vehicleFrontPictures"
                type="file"
                className="hidden"
                accept="image/*"
                multiple
                onChange={(e) => applyVehiclePhotoUpload("vehicleFront", e)}
              />
              <label
                htmlFor="vehicleFrontPictures"
                className={photoPickClass("photo-vehicleFront", true, vehiclePictureCounts.vehicleFront >= 1)}
              >
                Select Front Photo(s)
              </label>
              <PhotoUploadFeedback count={vehiclePictureCounts.vehicleFront} names={vehiclePictureFileNames.vehicleFront} />
              <PhotoThumbnailGrid
                files={vehiclePictureFiles.vehicleFront}
                remotePhotos={remoteThumbsForVehicleField("vehicleFront")}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField("vehicleFront", remote)}
                onRemoveLocal={(file) => removeLocalPhotoFromField("vehicleFront", file)}
              />
              <PhotoUploadedBadge show={vehiclePictureCounts.vehicleFront >= 1} />
              <PhotoFieldError message={vehiclePictureErrors.vehicleFront} />
              {requiredHint("photo-vehicleFront")}
            </div>

            <div id="field-photo-vehicleSide">
              <label className={fieldLabelClass("photo-vehicleSide")}>
                Vehicle Side Picture
                <RequiredMark />
              </label>
              <input
                id="vehicleSidePictures"
                type="file"
                className="hidden"
                accept="image/*"
                multiple
                onChange={(e) => applyVehiclePhotoUpload("vehicleSide", e)}
              />
              <label
                htmlFor="vehicleSidePictures"
                className={photoPickClass("photo-vehicleSide", true, vehiclePictureCounts.vehicleSide >= 1)}
              >
                Select Side Photo(s)
              </label>
              <PhotoUploadFeedback count={vehiclePictureCounts.vehicleSide} names={vehiclePictureFileNames.vehicleSide} />
              <PhotoThumbnailGrid
                files={vehiclePictureFiles.vehicleSide}
                remotePhotos={remoteThumbsForVehicleField("vehicleSide")}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField("vehicleSide", remote)}
                onRemoveLocal={(file) => removeLocalPhotoFromField("vehicleSide", file)}
              />
              <PhotoUploadedBadge show={vehiclePictureCounts.vehicleSide >= 1} />
              <PhotoFieldError message={vehiclePictureErrors.vehicleSide} />
              {requiredHint("photo-vehicleSide")}
            </div>

            <div id="field-photo-vehicleRear">
              <label className={labelClassName}>Vehicle Rear Picture (Optional)</label>
              <input
                id="vehicleRearPictures"
                type="file"
                className="hidden"
                accept="image/*"
                multiple
                onChange={(e) => applyVehiclePhotoUpload("vehicleRear", e)}
              />
              <label
                htmlFor="vehicleRearPictures"
                className={photoPickClass("photo-vehicleRear", false, vehiclePictureCounts.vehicleRear >= 1)}
              >
                Select Rear Photo(s)
              </label>
              <PhotoUploadFeedback count={vehiclePictureCounts.vehicleRear} names={vehiclePictureFileNames.vehicleRear} />
              <PhotoThumbnailGrid
                files={vehiclePictureFiles.vehicleRear}
                remotePhotos={remoteThumbsForVehicleField("vehicleRear")}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField("vehicleRear", remote)}
                onRemoveLocal={(file) => removeLocalPhotoFromField("vehicleRear", file)}
              />
              <PhotoUploadedBadge show={vehiclePictureCounts.vehicleRear >= 1} />
              <PhotoFieldError message={vehiclePictureErrors.vehicleRear} />
            </div>
          </div>
        </section>

        {/* Hardware Selection */}
        <section className={cardClassName}>
          <FormSectionHeader title="Hardware Selection" tone="green" />

          <div className="space-y-5">
            <div id="field-hw-primary">
              <label className={fieldLabelClass("hw-primary")}>
                Primary Hardware / Install Type
                <RequiredMark />
              </label>
              <select
                className={fieldSelectClass("hw-primary")}
                value={primary}
                onChange={(e) => {
                  setPrimary(e.target.value);
                  clearFieldHighlight("hw-primary");
                }}
              >
                <option value="" className="text-gray-400">
                  Select Primary Hardware
                </option>
                <option value="VAC4">VAC4</option>
                <option value="CP4">CP4</option>
                <option value="PPD">PPD</option>
                <option value="Speed Transmon">Speed Transmon</option>
                <option value="Speed SSC">Speed SSC</option>
                <option value="FTxw">FTxw</option>
              </select>
              {requiredHint("hw-primary")}
            </div>

            <div id="field-hw-hasAdditional">
              <label className={fieldLabelClass("hw-hasAdditional")}>
                Is any additional hardware being installed?
                <RequiredMark />
              </label>
              <select
                className={fieldSelectClass("hw-hasAdditional")}
                value={hasAdditional}
                onChange={(e) => {
                  const value = e.target.value;
                  setHasAdditional(value);
                  if (value === "No") {
                    setAdditional([]);
                  }
                  clearFieldHighlight("hw-hasAdditional");
                }}
              >
                <option value="" className="text-gray-400">
                  Any additional hardware?
                </option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
              {requiredHint("hw-hasAdditional")}
            </div>

            {hasAdditional === "Yes" && primary && (
              <div className="space-y-3 pt-1">
                {availableAdditional.map((type) => (
                  <label key={type} className={checkboxRowClassName}>
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 rounded border-2 border-gray-400 text-blue-600 focus:ring-blue-500"
                      checked={additional.includes(type)}
                      onChange={() => toggleAdditional(type)}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>

        {primary && !hasAnsweredAdditionalHardwareQuestion && (
          <section className={cardClassName}>
            <p className="text-sm font-semibold text-amber-800">
              Please answer &quot;Is any additional hardware being installed?&quot; to continue.
            </p>
          </section>
        )}

        {hasAnsweredAdditionalHardwareQuestion && primary === "VAC4" && (
          <VAC4Section>
            <section className={`${cardClassName} space-y-5`}>
              <FormSectionHeader title="VAC4 Section" tone="purple" />

                <div id="field-vac4-clientApproval">
                  <label className={fieldLabelClass("vac4-clientApproval")}>
                    Client Representative Approval Details
                    <RequiredMark />
                  </label>
                  <input
                    className={fieldInputClass("vac4-clientApproval")}
                    placeholder="exp: Jane Doe, approved 4/25 10:30 AM"
                    value={vac4ClientApproval}
                    onChange={(e) => {
                      setVac4ClientApproval(e.target.value);
                      clearFieldHighlight("vac4-clientApproval");
                    }}
                  />
                  {requiredHint("vac4-clientApproval")}
                </div>

                {vac4DriveType === "Electric" && (
                  <div id="field-vac4-liftSense">
                    <label className={fieldLabelClass("vac4-liftSense")}>
                      Lift Sense Installed?
                      <RequiredMark />
                    </label>
                    <select
                      className={fieldSelectClass("vac4-liftSense")}
                      value={liftSenseInstalled}
                      onChange={(e) => {
                        setLiftSenseInstalled(e.target.value);
                        clearFieldHighlight("vac4-liftSense");
                      }}
                    >
                      <option value="" className="text-gray-400">
                        Select Yes or No
                      </option>
                      <option>Yes</option>
                      <option>No</option>
                    </select>
                    {requiredHint("vac4-liftSense")}
                  </div>
                )}

                <div id="field-vac4-operatorPresence">
                  <label className={fieldLabelClass("vac4-operatorPresence")}>
                    Is Operator Presence Installed?
                    <RequiredMark />
                  </label>
                  <select
                    className={fieldSelectClass("vac4-operatorPresence")}
                    value={operatorPresenceInstalled}
                    onChange={(e) => {
                      const value = e.target.value;
                      setOperatorPresenceInstalled(value);
                      clearFieldHighlight("vac4-operatorPresence");
                      if (value === "No") {
                        setPurpleWireDescription("");
                        setVacPhotoFiles((p) => ({ ...p, purpleWire: [] }));
                        setVacPhotoUrlsSafe((p) => ({ ...p, purpleWire: [] }));
                        setPhotoMetadataByFieldSafe((p) => ({ ...p, purpleWire: [] }));
                        setVacPhotoErrors((er) => ({ ...er, purpleWire: null }));
                        clearFieldHighlight("photo-purpleWire");
                        clearFieldHighlight("vac4-purpleWireDescription");
                      }
                    }}
                  >
                    <option value="" className="text-gray-400">
                      Select Yes or No
                    </option>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                  {requiredHint("vac4-operatorPresence")}
                </div>

                <div className="space-y-5 rounded-2xl border-2 border-gray-200 bg-gray-50/90 p-4 sm:p-5">
                  <h3 className="text-lg font-bold text-gray-900">VAC4 Required Photos</h3>

                  <div id="field-photo-vacMounting">
                    <label className={fieldLabelClass("photo-vacMounting")}>
                      VAC Mounting Location Photo
                      <RequiredMark />
                    </label>
                    <input
                      id="vacMountingPhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => applyVacPhotoUpload("vacMounting", e, "single")}
                    />
                    <label
                      htmlFor="vacMountingPhoto"
                      className={photoPickClass("photo-vacMounting", true, pc.vacMounting >= 1)}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.vacMounting} names={vacPhotoFileNames.vacMounting} />
                    <PhotoThumbnailGrid
                      files={vacPhotoFiles.vacMounting}
                      remotePhotos={remoteThumbsForVacField("vacMounting")}
                      onRemoveRemote={(remote) => void removeUploadedPhotoFromField("vacMounting", remote)}
                      onRemoveLocal={(file) => removeLocalPhotoFromField("vacMounting", file)}
                    />
                    <PhotoUploadedBadge show={pc.vacMounting >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.vacMounting} />
                    {requiredHint("photo-vacMounting")}
                  </div>
                  <div id="field-photo-wirePath">
                    <label className={fieldLabelClass("photo-wirePath")}>
                      Wire Path Photos
                      <RequiredMark />
                    </label>
                    <input
                      id="wirePathPhotos"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      multiple
                      onChange={(e) => applyVacPhotoUpload("wirePath", e, "multi")}
                    />
                    <label
                      htmlFor="wirePathPhotos"
                      className={photoPickClass("photo-wirePath", true, pc.wirePath >= 1)}
                    >
                      📷 Take / Upload Photos
                    </label>
                    <PhotoUploadFeedback count={pc.wirePath} names={vacPhotoFileNames.wirePath} />
                    <PhotoThumbnailGrid
                      files={vacPhotoFiles.wirePath}
                      remotePhotos={remoteThumbsForVacField("wirePath")}
                      onRemoveRemote={(remote) => void removeUploadedPhotoFromField("wirePath", remote)}
                      onRemoveLocal={(file) => removeLocalPhotoFromField("wirePath", file)}
                    />
                    <PhotoUploadedBadge show={pc.wirePath >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.wirePath} />
                    {requiredHint("photo-wirePath")}
                    <p className="mt-2 text-base leading-relaxed text-gray-600">
                      Upload multiple photos showing the full wire route from device to connection points.
                    </p>
                  </div>

                  <div id="field-photo-redWire">
                    <label className={fieldLabelClass("photo-redWire")}>
                      Red Wire Connection Photo
                      <RequiredMark />
                    </label>
                    <p className="text-base text-gray-600">Battery positive</p>
                    <input
                      id="redWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => applyVacPhotoUpload("redWire", e, "single")}
                    />
                    <label
                      htmlFor="redWirePhoto"
                      className={`${photoPickClass("photo-redWire", true, pc.redWire >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.redWire} names={vacPhotoFileNames.redWire} />
                    <PhotoThumbnailGrid
                      files={vacPhotoFiles.redWire}
                      remotePhotos={remoteThumbsForVacField("redWire")}
                      onRemoveRemote={(remote) => void removeUploadedPhotoFromField("redWire", remote)}
                      onRemoveLocal={(file) => removeLocalPhotoFromField("redWire", file)}
                    />
                    <PhotoUploadedBadge show={pc.redWire >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.redWire} />
                    {requiredHint("photo-redWire")}
                    <div id="field-vac4-redWireDescription" className="mt-2">
                      <label className={fieldLabelClass("vac4-redWireDescription")}>
                        Red wire connection description
                        <RequiredMark />
                      </label>
                      <input
                        className={fieldInputClass("vac4-redWireDescription")}
                        placeholder="exp: Battery + terminal post"
                        value={redWireDescription}
                        onChange={(e) => {
                          setRedWireDescription(e.target.value);
                          clearFieldHighlight("vac4-redWireDescription");
                        }}
                      />
                      {requiredHint("vac4-redWireDescription")}
                    </div>
                  </div>
                  <div id="field-photo-blackWire">
                    <label className={fieldLabelClass("photo-blackWire")}>
                      Black Wire Connection Photo
                      <RequiredMark />
                    </label>
                    <p className="text-base text-gray-600">Battery negative</p>
                    <input
                      id="blackWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => applyVacPhotoUpload("blackWire", e, "single")}
                    />
                    <label
                      htmlFor="blackWirePhoto"
                      className={`${photoPickClass("photo-blackWire", true, pc.blackWire >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.blackWire} names={vacPhotoFileNames.blackWire} />
                    <PhotoThumbnailGrid
                      files={vacPhotoFiles.blackWire}
                      remotePhotos={remoteThumbsForVacField("blackWire")}
                      onRemoveRemote={(remote) => void removeUploadedPhotoFromField("blackWire", remote)}
                      onRemoveLocal={(file) => removeLocalPhotoFromField("blackWire", file)}
                    />
                    <PhotoUploadedBadge show={pc.blackWire >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.blackWire} />
                    {requiredHint("photo-blackWire")}
                    <div id="field-vac4-blackWireDescription" className="mt-2">
                      <label className={fieldLabelClass("vac4-blackWireDescription")}>
                        Black wire connection description
                        <RequiredMark />
                      </label>
                      <input
                        className={fieldInputClass("vac4-blackWireDescription")}
                        placeholder="exp: Frame ground stud"
                        value={blackWireDescription}
                        onChange={(e) => {
                          setBlackWireDescription(e.target.value);
                          clearFieldHighlight("vac4-blackWireDescription");
                        }}
                      />
                      {requiredHint("vac4-blackWireDescription")}
                    </div>
                  </div>
                  <div id="field-photo-blueWire">
                    <label className={fieldLabelClass("photo-blueWire")}>
                      Blue Wire Connection Photo
                      <RequiredMark />
                    </label>
                    <p className="text-base text-gray-600">{blueWireHelperText}</p>
                    <input
                      id="blueWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => applyVacPhotoUpload("blueWire", e, "single")}
                    />
                    <label
                      htmlFor="blueWirePhoto"
                      className={`${photoPickClass("photo-blueWire", true, pc.blueWire >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.blueWire} names={vacPhotoFileNames.blueWire} />
                    <PhotoThumbnailGrid
                      files={vacPhotoFiles.blueWire}
                      remotePhotos={remoteThumbsForVacField("blueWire")}
                      onRemoveRemote={(remote) => void removeUploadedPhotoFromField("blueWire", remote)}
                      onRemoveLocal={(file) => removeLocalPhotoFromField("blueWire", file)}
                    />
                    <PhotoUploadedBadge show={pc.blueWire >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.blueWire} />
                    {requiredHint("photo-blueWire")}
                    <div id="field-vac4-blueWireDescription" className="mt-2">
                      <label className={fieldLabelClass("vac4-blueWireDescription")}>
                        Blue wire connection description
                        <RequiredMark />
                      </label>
                      <input
                        className={fieldInputClass("vac4-blueWireDescription")}
                        placeholder="exp: In-gear signal at controller"
                        value={blueWireDescription}
                        onChange={(e) => {
                          setBlueWireDescription(e.target.value);
                          clearFieldHighlight("vac4-blueWireDescription");
                        }}
                      />
                      {requiredHint("vac4-blueWireDescription")}
                    </div>
                  </div>
                  {operatorPresenceInstalled === "Yes" && (
                    <div id="field-photo-purpleWire">
                      <label className={fieldLabelClass("photo-purpleWire")}>
                      Purple Wire Connection Photo
                        <RequiredMark />
                      </label>
                    <p className="text-base text-gray-600">Operator presence</p>
                    <input
                      id="purpleWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => applyVacPhotoUpload("purpleWire", e, "single")}
                    />
                    <label
                      htmlFor="purpleWirePhoto"
                        className={`${photoPickClass("photo-purpleWire", true, pc.purpleWire >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.purpleWire} names={vacPhotoFileNames.purpleWire} />
                    <PhotoThumbnailGrid
                      files={vacPhotoFiles.purpleWire}
                      remotePhotos={remoteThumbsForVacField("purpleWire")}
                      onRemoveRemote={(remote) => void removeUploadedPhotoFromField("purpleWire", remote)}
                      onRemoveLocal={(file) => removeLocalPhotoFromField("purpleWire", file)}
                    />
                    <PhotoUploadedBadge show={pc.purpleWire >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.purpleWire} />
                      {requiredHint("photo-purpleWire")}
                      <div id="field-vac4-purpleWireDescription">
                        <label className={fieldLabelClass("vac4-purpleWireDescription")}>
                      Purple wire connection description
                          <RequiredMark />
                        </label>
                        <input
                          className={fieldInputClass("vac4-purpleWireDescription")}
                          placeholder="exp: Seat switch output"
                          value={purpleWireDescription}
                          onChange={(e) => {
                            setPurpleWireDescription(e.target.value);
                            clearFieldHighlight("vac4-purpleWireDescription");
                          }}
                        />
                        {requiredHint("vac4-purpleWireDescription")}
                      </div>
                    </div>
                  )}
                  {(["Gas", "Diesel", "LPG", "Internal Combustion"].includes(vac4DriveType) ||
                    (vac4DriveType === "Electric" && liftSenseInstalled === "Yes")) && (
                    <div id="field-photo-brownWire">
                      <label className={fieldLabelClass("photo-brownWire")}>
                        Brown Wire Connection Photo
                        <RequiredMark />
                      </label>
                      <p className="text-base text-gray-600">{brownWireHelperText}</p>
                      <input
                        id="brownWirePhoto"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => applyVacPhotoUpload("brownWire", e, "single")}
                      />
                      <label
                        htmlFor="brownWirePhoto"
                        className={`${photoPickClass("photo-brownWire", true, pc.brownWire >= 1)} mb-2`}
                      >
                        📷 Take / Upload Photo
                      </label>
                      <PhotoUploadFeedback count={pc.brownWire} names={vacPhotoFileNames.brownWire} />
                      <PhotoThumbnailGrid
                        files={vacPhotoFiles.brownWire}
                        remotePhotos={remoteThumbsForVacField("brownWire")}
                        onRemoveRemote={(remote) => void removeUploadedPhotoFromField("brownWire", remote)}
                        onRemoveLocal={(file) => removeLocalPhotoFromField("brownWire", file)}
                      />
                      <PhotoUploadedBadge show={pc.brownWire >= 1} />
                      <PhotoFieldError message={vacPhotoErrors.brownWire} />
                      {requiredHint("photo-brownWire")}
                      <div id="field-vac4-brownWireDescription" className="mt-2">
                        <label className={fieldLabelClass("vac4-brownWireDescription")}>
                          Brown wire connection description
                          <RequiredMark />
                        </label>
                        <input
                          className={fieldInputClass("vac4-brownWireDescription")}
                          placeholder="exp: Ignition-on signal"
                          value={brownWireDescription}
                          onChange={(e) => {
                            setBrownWireDescription(e.target.value);
                            clearFieldHighlight("vac4-brownWireDescription");
                          }}
                        />
                        {requiredHint("vac4-brownWireDescription")}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className={labelClassName}>
                      Relay Access Control Connection(s) Photo
                      <RequiredMark />
                    </label>
                    <input
                      id="relayAccessControlPhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      required
                      onChange={(e) => applyVacPhotoUpload("relayAccess", e, "single")}
                    />
                    <label
                      htmlFor="relayAccessControlPhoto"
                      className={`${photoPickClass("photo-relayAccess", false, pc.relayAccess >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.relayAccess} names={vacPhotoFileNames.relayAccess} />
                    <PhotoThumbnailGrid
                      files={vacPhotoFiles.relayAccess}
                      remotePhotos={remoteThumbsForVacField("relayAccess")}
                      onRemoveRemote={(remote) => void removeUploadedPhotoFromField("relayAccess", remote)}
                      onRemoveLocal={(file) => removeLocalPhotoFromField("relayAccess", file)}
                    />
                    <PhotoUploadedBadge show={pc.relayAccess >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.relayAccess} />
                    <label className={`${labelClassName} mt-2`}>
                      Relay access control connection description
                      <RequiredMark />
                    </label>
                    <input
                      className={inputClassName}
                      placeholder="exp: Starter interlock relay"
                      value={relayAccessDescription}
                      onChange={(e) => setRelayAccessDescription(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>
                      Impact Sensor Mounting Photo
                      <RequiredMark />
                    </label>
                    <input
                      id="impactSensorMountingPhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      required
                      onChange={(e) => applyVacPhotoUpload("impactSensor", e, "single")}
                    />
                    <label
                      htmlFor="impactSensorMountingPhoto"
                      className={`${photoPickClass("photo-impactSensor", false, pc.impactSensor >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.impactSensor} names={vacPhotoFileNames.impactSensor} />
                    <PhotoThumbnailGrid
                      files={vacPhotoFiles.impactSensor}
                      remotePhotos={remoteThumbsForVacField("impactSensor")}
                      onRemoveRemote={(remote) => void removeUploadedPhotoFromField("impactSensor", remote)}
                      onRemoveLocal={(file) => removeLocalPhotoFromField("impactSensor", file)}
                    />
                    <PhotoUploadedBadge show={pc.impactSensor >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.impactSensor} />
                    <label className={`${labelClassName} mt-2`}>
                      Impact sensor mounting description
                      <RequiredMark />
                    </label>
                    <input
                      className={inputClassName}
                      placeholder="exp: Chassis center line, right side"
                      value={impactSensorDescription}
                      onChange={(e) => setImpactSensorDescription(e.target.value)}
                    />
                  </div>
                </div>

                <div id="field-vac4-hourMeter">
                  <label className={fieldLabelClass("vac4-hourMeter")}>
                    Hour Meter Entered During Configuration
                    <RequiredMark />
                  </label>
                  <input
                    className={fieldInputClass("vac4-hourMeter")}
                    placeholder="exp: 1532.6"
                    value={vac4HourMeter}
                    onChange={(e) => {
                      setVac4HourMeter(e.target.value);
                      clearFieldHighlight("vac4-hourMeter");
                    }}
                  />
                  {requiredHint("vac4-hourMeter")}
                </div>

                <div>
                  <label className={labelClassName}>Sensor Hub Installed?</label>
                  <select
                    className={selectClassName}
                    value={sensorHubInstalled}
                    onChange={(e) => setSensorHubInstalled(e.target.value)}
                  >
                    <option value="" className="text-gray-400">
                      Select Yes or No
                    </option>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                </div>

                {sensorHubInstalled === "Yes" && (
                  <div className="space-y-5 rounded-2xl border-2 border-gray-200 bg-gray-50/90 p-4 sm:p-5">
                    <div>
                      <label className={labelClassName}>Sensor Hub Mounting Location</label>
                      <input className={inputClassName} placeholder="exp: Under dash panel" />
                    </div>
                    <div id="field-photo-sensorHubMounting">
                      <label className={fieldLabelClass("photo-sensorHubMounting")}>
                        Sensor Hub Mounting Location Photo
                        <RequiredMark />
                      </label>
                      <input
                        id="sensorHubMountingPhoto"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => applyVacPhotoUpload("sensorHubMounting", e, "single")}
                      />
                      <label
                        htmlFor="sensorHubMountingPhoto"
                        className={photoPickClass("photo-sensorHubMounting", true, pc.sensorHubMounting >= 1)}
                      >
                        📷 Take / Upload Photo
                      </label>
                      <PhotoUploadFeedback count={pc.sensorHubMounting} names={vacPhotoFileNames.sensorHubMounting} />
                      <PhotoThumbnailGrid
                        files={vacPhotoFiles.sensorHubMounting}
                        remotePhotos={remoteThumbsForVacField("sensorHubMounting")}
                        onRemoveRemote={(remote) => void removeUploadedPhotoFromField("sensorHubMounting", remote)}
                        onRemoveLocal={(file) => removeLocalPhotoFromField("sensorHubMounting", file)}
                      />
                      <PhotoUploadedBadge show={pc.sensorHubMounting >= 1} />
                      <PhotoFieldError message={vacPhotoErrors.sensorHubMounting} />
                      {requiredHint("photo-sensorHubMounting")}
                    </div>

                    <div>
                      <label className={labelClassName}>Speed Sense Installed?</label>
                      <select
                        className={selectClassName}
                        value={speedSenseInstalled}
                        onChange={(e) => setSpeedSenseInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClassName}>Load Sense Installed?</label>
                      <select
                        className={selectClassName}
                        value={loadSenseInstalled}
                        onChange={(e) => setLoadSenseInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClassName}>GPS Installed?</label>
                      <select
                        className={selectClassName}
                        value={gpsInstalled}
                        onChange={(e) => setGpsInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClassName}>External Indicator Installed?</label>
                      <select
                        className={selectClassName}
                        value={externalIndicatorInstalled}
                        onChange={(e) => setExternalIndicatorInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    {speedSenseInstalled === "Yes" && (
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900">Speed Sense Details</h3>
                        <div id="field-photo-speedSense">
                          <label className={fieldLabelClass("photo-speedSense")}>
                            Speed Sense Photo
                            <RequiredMark />
                          </label>
                          <input
                            id="speedSensePhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => applyVacPhotoUpload("speedSense", e, "single")}
                          />
                          <label
                            htmlFor="speedSensePhoto"
                            className={photoPickClass("photo-speedSense", true, pc.speedSense >= 1)}
                          >
                            📷 Take / Upload Photo
                          </label>
                          <PhotoUploadFeedback count={pc.speedSense} names={vacPhotoFileNames.speedSense} />
                          <PhotoThumbnailGrid
                            files={vacPhotoFiles.speedSense}
                            remotePhotos={remoteThumbsForVacField("speedSense")}
                            onRemoveRemote={(remote) => void removeUploadedPhotoFromField("speedSense", remote)}
                            onRemoveLocal={(file) => removeLocalPhotoFromField("speedSense", file)}
                          />
                          <PhotoUploadedBadge show={pc.speedSense >= 1} />
                          <PhotoFieldError message={vacPhotoErrors.speedSense} />
                          {requiredHint("photo-speedSense")}
                        </div>
                        <div id="field-vac4-speedSenseDescription">
                          <label className={fieldLabelClass("vac4-speedSenseDescription")}>
                            Speed Sense Description
                            <RequiredMark />
                          </label>
                          <input
                            className={fieldInputClass("vac4-speedSenseDescription")}
                            placeholder="exp: Magnet mounted on drive wheel"
                            value={speedSenseDescription}
                            onChange={(e) => {
                              setSpeedSenseDescription(e.target.value);
                              clearFieldHighlight("vac4-speedSenseDescription");
                            }}
                          />
                          {requiredHint("vac4-speedSenseDescription")}
                        </div>
                        <div id="field-vac4-speedSensePulseCount">
                          <label className={fieldLabelClass("vac4-speedSensePulseCount")}>
                            Speed Sense Pulse Count
                            <RequiredMark />
                          </label>
                          <input
                            className={fieldInputClass("vac4-speedSensePulseCount")}
                            placeholder="exp: 16"
                            value={speedSensePulseCount}
                            onChange={(e) => {
                              setSpeedSensePulseCount(e.target.value);
                              clearFieldHighlight("vac4-speedSensePulseCount");
                            }}
                          />
                          {requiredHint("vac4-speedSensePulseCount")}
                        </div>
                      </div>
                    )}

                    {loadSenseInstalled === "Yes" && (
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900">Load Sense Details</h3>
                        <div id="field-photo-loadSense">
                          <label className={fieldLabelClass("photo-loadSense")}>
                            Load Sense Photo
                            <RequiredMark />
                          </label>
                          <input
                            id="loadSensePhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => applyVacPhotoUpload("loadSense", e, "single")}
                          />
                          <label
                            htmlFor="loadSensePhoto"
                            className={photoPickClass("photo-loadSense", true, pc.loadSense >= 1)}
                          >
                            📷 Take / Upload Photo
                          </label>
                          <PhotoUploadFeedback count={pc.loadSense} names={vacPhotoFileNames.loadSense} />
                          <PhotoThumbnailGrid
                            files={vacPhotoFiles.loadSense}
                            remotePhotos={remoteThumbsForVacField("loadSense")}
                            onRemoveRemote={(remote) => void removeUploadedPhotoFromField("loadSense", remote)}
                            onRemoveLocal={(file) => removeLocalPhotoFromField("loadSense", file)}
                          />
                          <PhotoUploadedBadge show={pc.loadSense >= 1} />
                          <PhotoFieldError message={vacPhotoErrors.loadSense} />
                          {requiredHint("photo-loadSense")}
                        </div>
                        <div id="field-vac4-loadSenseThresholds">
                          <label className={fieldLabelClass("vac4-loadSenseThresholds")}>
                            Load Sense VAC Thresholds
                            <RequiredMark />
                          </label>
                          <input
                            className={fieldInputClass("vac4-loadSenseThresholds")}
                            placeholder="exp: 2.5V empty / 4.2V loaded"
                            value={loadSenseThresholds}
                            onChange={(e) => {
                              setLoadSenseThresholds(e.target.value);
                              clearFieldHighlight("vac4-loadSenseThresholds");
                            }}
                          />
                          {requiredHint("vac4-loadSenseThresholds")}
                        </div>
                      </div>
                    )}

                    {gpsInstalled === "Yes" && (
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900">GPS Details</h3>
                        <div id="field-photo-gps">
                          <label className={fieldLabelClass("photo-gps")}>
                            GPS Mounting Location Photo
                            <RequiredMark />
                          </label>
                          <input
                            id="gpsMountingPhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => applyVacPhotoUpload("gps", e, "single")}
                          />
                          <label
                            htmlFor="gpsMountingPhoto"
                            className={photoPickClass("photo-gps", true, pc.gps >= 1)}
                          >
                            📷 Take / Upload Photo
                          </label>
                          <PhotoUploadFeedback count={pc.gps} names={vacPhotoFileNames.gps} />
                          <PhotoThumbnailGrid
                            files={vacPhotoFiles.gps}
                            remotePhotos={remoteThumbsForVacField("gps")}
                            onRemoveRemote={(remote) => void removeUploadedPhotoFromField("gps", remote)}
                            onRemoveLocal={(file) => removeLocalPhotoFromField("gps", file)}
                          />
                          <PhotoUploadedBadge show={pc.gps >= 1} />
                          <PhotoFieldError message={vacPhotoErrors.gps} />
                          {requiredHint("photo-gps")}
                        </div>
                      </div>
                    )}

                    {externalIndicatorInstalled === "Yes" && (
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900">External Indicator Details</h3>
                        <div id="field-photo-externalIndicator">
                          <label className={fieldLabelClass("photo-externalIndicator")}>
                            External Indicator Mounting Location Photo
                            <RequiredMark />
                          </label>
                          <input
                            id="externalIndicatorPhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => applyVacPhotoUpload("externalIndicator", e, "single")}
                          />
                          <label
                            htmlFor="externalIndicatorPhoto"
                            className={photoPickClass("photo-externalIndicator", true, pc.externalIndicator >= 1)}
                          >
                            📷 Take / Upload Photo
                          </label>
                          <PhotoUploadFeedback count={pc.externalIndicator} names={vacPhotoFileNames.externalIndicator} />
                          <PhotoThumbnailGrid
                            files={vacPhotoFiles.externalIndicator}
                            remotePhotos={remoteThumbsForVacField("externalIndicator")}
                            onRemoveRemote={(remote) => void removeUploadedPhotoFromField("externalIndicator", remote)}
                            onRemoveLocal={(file) => removeLocalPhotoFromField("externalIndicator", file)}
                          />
                          <PhotoUploadedBadge show={pc.externalIndicator >= 1} />
                          <PhotoFieldError message={vacPhotoErrors.externalIndicator} />
                          {requiredHint("photo-externalIndicator")}
                        </div>
                      </div>
                    )}
                  </div>
                )}
            </section>
          </VAC4Section>
        )}

        {/* Dynamic Sections */}
        {hasAnsweredAdditionalHardwareQuestion &&
          selectedSections
            .filter((section) => section !== "VAC4")
            .map((section) => (
              <section key={section} className={cardClassName}>
                <FormSectionHeader title={`${section} Section`} tone="green" />

                <div className="space-y-5">
                  <div>
                    <label className={labelClassName}>Drive Type</label>
                    <select className={selectClassName}>
                      <option>Drive Type</option>
                      <option>Electric</option>
                      <option>Internal Combustion</option>
                      <option>Other</option>
                    </select>
                  </div>

                  <div>
                    <label className={labelClassName}>Notes / Details</label>
                    <input className={inputClassName} placeholder="exp: Customer requested wire loom" />
                  </div>

                  <div>
                    <label className={labelClassName}>Attachments</label>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="min-h-[52px] w-full rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-base file:mr-4 file:rounded-xl file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                    />
                  </div>
                </div>
              </section>
            ))}

        <div className="hidden md:flex md:flex-row md:justify-end md:gap-3 md:pt-2">
          <button
            type="button"
            className={btnSecondaryClassName}
            onClick={hasCoreOrVehicleInfo ? handleSaveDraftAndExit : handleExitToHome}
          >
              <IconFloppy className="h-5 w-5" />
            {hasCoreOrVehicleInfo ? "Save Draft and Exit" : "Exit"}
          </button>
          {hasAnsweredAdditionalHardwareQuestion && (
            <button type="button" className={btnPrimaryClassName} onClick={handleReviewClick}>
              <IconSend className="h-5 w-5" />
              Review & Submit Job Card
            </button>
          )}
        </div>
        </>
        ) : (
        <>
        <section className={cardClassName}>
          <div className="mb-3 flex items-center gap-2">
            <IconSend className="h-6 w-6 shrink-0 text-blue-600" />
            <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Review before submit</h2>
          </div>
          <p className="text-base leading-relaxed text-gray-600">
            Everything below is grouped by section. Confirm it matches the install, then confirm and submit. Photo rows list
            file names when your browser exposes them (captured on upload).
          </p>
        </section>

        <section className={cardClassName}>
          <FormSectionHeader title="Core Job Info" tone="blue" />
          <div>
            <SummaryRow label="Customer" value={coreJob.customer} />
            <SummaryRow label="Location" value={coreJob.location} />
            <SummaryRow label="Work order #" value={coreJob.workOrder} />
            <SummaryRow label="Service appointment #" value={coreJob.serviceAppointment} />
            <SummaryRow label="Installer name" value={coreJob.installerName} />
          </div>
        </section>

        <section className={cardClassName}>
          <FormSectionHeader title="Vehicle Information" tone="purple" />
          <div>
            <SummaryRow label="Make" value={coreJob.equipmentMake} />
            <SummaryRow label="Model" value={coreJob.equipmentModel} />
            <SummaryRow label="Serial #" value={coreJob.equipmentSerial} />
            <SummaryRow label="Unit #" value={coreJob.unitNumber} />
            <SummaryRow
              label="Vehicle type"
              value={
                vac4VehicleType === "Other"
                  ? `${vac4VehicleType}${vac4OtherVehicleType.trim() ? ` (${vac4OtherVehicleType})` : ""}`
                  : vac4VehicleType
              }
            />
            <SummaryRow label="Drive type" value={vac4DriveType} />
            {vac4DriveType === "Electric" && (
              <SummaryRow
                label="Voltage"
                value={
                  vac4VehicleVoltage === "Other"
                    ? vac4VehicleVoltageOther.trim()
                      ? `Other (${vac4VehicleVoltageOther})`
                      : "Other"
                    : vac4VehicleVoltage
                }
              />
            )}
          </div>
        </section>

        <section className={cardClassName}>
          <FormSectionHeader title="Vehicle Pictures" tone="purple" />
          <div>
            <SummaryRow
              label="Vehicle front picture(s)"
              value={reviewPhotoSummary(vehiclePictureCounts.vehicleFront, vehiclePictureFileNames.vehicleFront)}
            />
            <SummaryRow
              label="Vehicle side picture(s)"
              value={reviewPhotoSummary(vehiclePictureCounts.vehicleSide, vehiclePictureFileNames.vehicleSide)}
            />
            <SummaryRow
              label="Vehicle rear picture(s)"
              value={reviewPhotoSummary(vehiclePictureCounts.vehicleRear, vehiclePictureFileNames.vehicleRear)}
            />
          </div>
        </section>

        <section className={cardClassName}>
          <FormSectionHeader title="Hardware Selection" tone="green" />
          <div>
            <SummaryRow label="Primary hardware / install type" value={primary} />
            <SummaryRow label="Additional hardware being installed?" value={hasAdditional} />
            <SummaryRow label="Additional hardware types" value={additional.join(", ")} />
            <SummaryRow label="Hardware units on this card" value={selectedSections.length ? selectedSections.join(", ") : "—"} />
          </div>
        </section>

        {selectedSections
          .filter((s) => s !== "VAC4")
          .map((section) => (
            <section key={`review-hw-${section}`} className={cardClassName}>
              <FormSectionHeader title={`${section} Section`} tone="green" />
              <p className="text-sm leading-relaxed text-gray-600">
                This hardware is selected for the job card. Detailed fields for this section are filled on the form; they are
                not yet mirrored here.
              </p>
            </section>
          ))}

        {selectedSections.includes("VAC4") && (
          <section className={cardClassName}>
            <FormSectionHeader title="VAC4 details" tone="purple" />
            <div>
              <SummaryRow
                label="Vehicle type"
                value={
                  vac4VehicleType === "Other"
                    ? `${vac4VehicleType}${vac4OtherVehicleType.trim() ? ` (${vac4OtherVehicleType})` : ""}`
                    : vac4VehicleType
                }
              />
              <SummaryRow label="Drive type" value={vac4DriveType} />
              {vac4DriveType === "Electric" && <SummaryRow label="Lift sense installed?" value={liftSenseInstalled} />}
              <SummaryRow label="Operator presence installed?" value={operatorPresenceInstalled} />
              <SummaryRow label="Client representative approval" value={vac4ClientApproval} />
              <SummaryRow label="Hour meter (configuration)" value={vac4HourMeter} />
              <SummaryRow label="Sensor hub installed?" value={sensorHubInstalled} />
              {sensorHubInstalled === "Yes" && (
                <>
                  <SummaryRow label="Speed sense installed?" value={speedSenseInstalled} />
                  <SummaryRow label="Load sense installed?" value={loadSenseInstalled} />
                  <SummaryRow label="GPS installed?" value={gpsInstalled} />
                  <SummaryRow label="External indicator installed?" value={externalIndicatorInstalled} />
                  {speedSenseInstalled === "Yes" && (
                    <>
                      <SummaryRow label="Speed sense description" value={speedSenseDescription} />
                      <SummaryRow label="Speed sense pulse count" value={speedSensePulseCount} />
                    </>
                  )}
                  {loadSenseInstalled === "Yes" && <SummaryRow label="Load sense VAC thresholds" value={loadSenseThresholds} />}
                </>
              )}
              {(() => {
                const descriptionValues: Record<Vac4DescriptionKey, string> = {
                  redWireDescription,
                  blackWireDescription,
                  blueWireDescription,
                  purpleWireDescription,
                  brownWireDescription,
                  relayAccessDescription,
                  impactSensorDescription,
                };
                return VAC4_ORDERED_DESCRIPTION_FIELDS.map(({ key, label }) => (
                  <SummaryRow key={`vac4-desc-${key}`} label={label} value={descriptionValues[key]} />
                ));
              })()}
              <div className="border-t border-gray-100 pt-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">VAC4 photos</p>
                {VAC4_ORDERED_PHOTO_FIELDS.map(({ key, label }) => {
                  const namesValue = vacPhotoFileNames[key as Vac4OrderedPhotoKey];
                  const names = Array.isArray(namesValue) ? namesValue : [];
                  const count = countPhotoValue(namesValue);
                  return (
                    <SummaryRow
                      key={`vac4-review-photo-${key}`}
                      label={`${label} photo`}
                      value={reviewPhotoSummary(count, names)}
                    />
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <div className="hidden md:flex md:flex-row md:justify-end md:gap-3 md:pt-2">
          <button type="button" className={btnSecondaryClassName} onClick={handleBackToForm}>
            Back to Edit
          </button>
          <button type="button" className={btnPrimaryClassName} onClick={handleFinalSubmit}>
            <IconSend className="h-5 w-5" />
            Confirm & Submit
          </button>
        </div>
        </>
        ))}
      </div>

      {!isJobCardSubmitted && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 px-4 pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur-md md:hidden"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
          role="region"
          aria-label="Job card actions"
        >
          <div className="mx-auto flex max-w-4xl gap-3">
            {step === "form" ? (
              <>
                <button
                  type="button"
                  className={`${btnSecondaryClassName} min-w-0 flex-1 text-sm sm:text-base`}
                  onClick={hasCoreOrVehicleInfo ? handleSaveDraftAndExit : handleExitToHome}
                >
                  <IconFloppy className="h-5 w-5 shrink-0" />
                  <span className="truncate">{hasCoreOrVehicleInfo ? "Save Draft and Exit" : "Exit"}</span>
                </button>
                <button
                  type="button"
                  className={`${btnPrimaryClassName} min-w-0 flex-1 text-sm sm:text-base`}
                  onClick={handleReviewClick}
                  disabled={!hasAnsweredAdditionalHardwareQuestion}
                >
                  <IconSend className="h-5 w-5 shrink-0" />
                  <span className="line-clamp-2 text-left leading-tight">Review & Submit Job Card</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" className={`${btnSecondaryClassName} min-w-0 flex-1 text-sm sm:text-base`} onClick={handleBackToForm}>
                  <span className="truncate">Back to Edit</span>
                </button>
                <button type="button" className={`${btnPrimaryClassName} min-w-0 flex-1 text-sm sm:text-base`} onClick={handleFinalSubmit}>
                  <IconSend className="h-5 w-5 shrink-0" />
                  <span className="line-clamp-2 text-left leading-tight">Confirm & Submit</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const cardClassName =
    "rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6";

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-5 sm:py-2">
        <header className={cardClassName}>
          <div className="flex flex-col items-start gap-1.5">
            <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
            <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Installer Job Card</h1>
            <p className="text-base font-medium leading-tight text-gray-600">Select an option to begin</p>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/new-submission"
            className="rounded-2xl border border-blue-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-blue-300 hover:bg-blue-50/50 sm:p-6"
          >
            <h2 className="text-lg font-bold text-gray-900">New Submission</h2>
            <p className="mt-1 text-sm text-gray-600">Start a new installer job card.</p>
          </Link>

          <Link
            href="/drafts"
            className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-emerald-300 hover:bg-emerald-50/50 sm:p-6"
          >
            <h2 className="text-lg font-bold text-gray-900">Saved Drafts</h2>
            <p className="mt-1 text-sm text-gray-600">Resume or manage unfinished job cards.</p>
          </Link>

          <Link
            href="/submitted"
            className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-indigo-300 hover:bg-indigo-50/50 sm:p-6"
          >
            <h2 className="text-lg font-bold text-gray-900">Submitted Job Cards</h2>
            <p className="mt-1 text-sm text-gray-600">View completed submissions.</p>
          </Link>
        </section>
      </div>
    </main>
  );
}
