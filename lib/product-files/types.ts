/**
 * Product Files — installer-uploaded install files (config/calibration/diagnostic/etc.).
 * Not related to package.json / app configuration.
 */

export type ProductFileCategory =
  | "configuration"
  | "calibration"
  | "commissioning"
  | "diagnostic"
  | "document"
  | "other";

/** Stable installer-facing file requirement on a product definition. */
export type ProductFileDefinition = {
  /** Stable file identity (never rename after create). */
  key: string;
  label: string;
  description?: string;
  category: ProductFileCategory;
  required: boolean;
  multiple: boolean;
  acceptedExtensions: string[];
  acceptedMimeTypes: string[];
  maxFileSizeBytes?: number;
  includeInReview: boolean;
  includeInEmail: boolean;
  /** When true, uploads are keyed by productKey (not only base form / section). */
  productScoped: boolean;
  displayOrder: number;
  active: boolean;
};

/**
 * One uploaded file instance associated with a product + file definition.
 * File bytes live in Storage — this is metadata only.
 */
export type UploadedProductFile = {
  fileKey: string;
  productKey: string;
  deviceInstanceId?: string | null;
  originalFileName: string;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByUserId?: string | null;
  displayLabel: string;
  baseFormId?: string;
  /** Signed or public URL when available (email/review). */
  downloadUrl?: string;
  /** Copied from definition at upload time for review/email without re-resolving config. */
  includeInReview?: boolean;
  includeInEmail?: boolean;
  /** Optional unit/context metadata (legacy PPD JSON form fields). */
  make?: string;
  model?: string;
  unitNumber?: string;
  notes?: string;
  companyId?: string;
  projectId?: string;
  customerId?: string | null;
};

/** In-progress / draft slot before or after Storage upload. */
export type ProductFileUploadSlot = {
  fileKey: string;
  productKey: string;
  deviceInstanceId?: string | null;
  /** Local files not yet uploaded (or offline). */
  localFiles: File[];
  /** Uploaded metadata (one entry when multiple=false). */
  uploaded: UploadedProductFile[];
};

/** Stable key for the shared PPD JSON configuration file definition. */
export const PPD_JSON_FILE_KEY = "ppd_json_config";

/**
 * Stable registry product key / sectionKey for the exact shared PPD form
 * (Matrix + Powerfleet assignments of form.id "ppd").
 */
export const PPD_PRODUCT_KEY = "PPD";

export function productFileSlotId(args: {
  productKey: string;
  fileKey: string;
  deviceInstanceId?: string | null;
}): string {
  const device = (args.deviceInstanceId || "").trim() || "_";
  return `${args.productKey.trim()}::${args.fileKey.trim()}::${device}`;
}

/**
 * Read canonical `productFiles` metadata and the uncommitted predecessor
 * `productArtifacts` shape (`artifactKey` → `fileKey`).
 */
export function readUploadedProductFiles(raw: unknown): UploadedProductFile[] {
  if (!Array.isArray(raw)) return [];
  const files: UploadedProductFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const value = item as Record<string, unknown>;
    const fileKey = String(value.fileKey || value.artifactKey || "").trim();
    const productKey = String(value.productKey || "").trim();
    const originalFileName = String(value.originalFileName || "").trim();
    const storageBucket = String(value.storageBucket || "").trim();
    const storagePath = String(value.storagePath || "").trim();
    const uploadedAt = String(value.uploadedAt || "").trim();
    if (!fileKey || !productKey || !originalFileName || !storageBucket || !storagePath || !uploadedAt) {
      continue;
    }
    files.push({
      ...(value as Omit<UploadedProductFile, "fileKey">),
      fileKey,
      productKey,
      originalFileName,
      storageBucket,
      storagePath,
      mimeType: String(value.mimeType || "application/octet-stream"),
      sizeBytes:
        typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes)
          ? value.sizeBytes
          : 0,
      uploadedAt,
      displayLabel: String(value.displayLabel || originalFileName),
    });
  }
  return files;
}

function productFileIdentity(file: UploadedProductFile): string {
  return `${file.productKey}::${file.fileKey}::${file.storagePath}`;
}

/**
 * Merge cloud draft Product Files with in-memory uploads.
 *
 * - Intentional clear (memory empty + allowClear): keep empty.
 * - Thin/stale memory (empty while cloud has files, no clear): keep cloud.
 * - Otherwise memory is authoritative (supports replace/remove).
 */
export function mergeDurableProductFiles(args: {
  cloudFiles: UploadedProductFile[];
  memoryFiles: UploadedProductFile[];
  /** True when UI intentionally cleared Product Files (and deprecated PPD mirror). */
  allowClear?: boolean;
}): { merged: UploadedProductFile[]; thinPayloadProtected: boolean } {
  const cloud = args.cloudFiles || [];
  const memory = args.memoryFiles || [];
  if (memory.length === 0 && cloud.length > 0 && !args.allowClear) {
    return { merged: [...cloud], thinPayloadProtected: true };
  }
  if (args.allowClear && memory.length === 0) {
    return { merged: [], thinPayloadProtected: false };
  }
  // Memory is authoritative; still union any cloud-only identities only when memory is thinner.
  if (memory.length > 0 && memory.length < cloud.length) {
    const byId = new Map<string, UploadedProductFile>();
    for (const file of cloud) byId.set(productFileIdentity(file), file);
    for (const file of memory) byId.set(productFileIdentity(file), file);
    return { merged: [...byId.values()], thinPayloadProtected: true };
  }
  return { merged: [...memory], thinPayloadProtected: false };
}

export function extractProductFilesFromPayload(payload: unknown): UploadedProductFile[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  const files = readUploadedProductFiles(record.productFiles ?? record.productArtifacts);
  if (files.length > 0) return files;
  const ppd = record.ppd;
  if (!ppd || typeof ppd !== "object" || Array.isArray(ppd)) return [];
  const jsonConfigFile = (ppd as Record<string, unknown>).jsonConfigFile;
  if (!jsonConfigFile || typeof jsonConfigFile !== "object" || Array.isArray(jsonConfigFile)) return [];
  const cfg = jsonConfigFile as Record<string, unknown>;
  const storagePath = String(cfg.storagePath || "").trim();
  const fileName = String(cfg.fileName || "").trim();
  if (!storagePath || !fileName) return [];
  return [
    {
      fileKey: PPD_JSON_FILE_KEY,
      productKey: PPD_PRODUCT_KEY,
      originalFileName: fileName,
      storageBucket: String(cfg.storageBucket || "customer-site-files"),
      storagePath,
      mimeType: "application/json",
      sizeBytes: 0,
      uploadedAt: String(cfg.uploadedAt || new Date().toISOString()),
      displayLabel: "JSON Configuration File",
      downloadUrl: String(cfg.publicUrl || ""),
      includeInEmail: true,
      includeInReview: true,
      make: String(cfg.make || ""),
      model: String(cfg.model || ""),
      unitNumber: String(cfg.unitNumber || ""),
      notes: String(cfg.notes || ""),
      companyId: String(cfg.companyId || ""),
      projectId: String(cfg.projectId || ""),
      customerId: cfg.customerId == null ? null : String(cfg.customerId),
    },
  ];
}
