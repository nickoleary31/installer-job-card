"use client";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MutableRefObject,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { urlLooksLikeInviteAuthCallback } from "@/lib/auth/onboarding";
import {
  type CoreJobFields,
  type Vac4DescriptionKey,
  type JobCardCp4Payload,
  type JobCardSscSpeedPayload,
  type JobCardPpdPayload,
  type JobCardPpdJsonConfigFile,
  type JobCardPpdJsonConfigForm,
  type JobCardSubmissionPayload,
  type UploadedPhotoMetadata,
  type Vac4OrderedPhotoKey,
  type VacPhotoFileNames,
  VAC4_ORDERED_DESCRIPTION_FIELDS,
  VAC4_ORDERED_PHOTO_FIELDS,
} from "@/lib/job-card-submission";
import { buildEmailViewModel, type EmailViewModel } from "@/lib/email-view-model";
import { EmailPreviewBody } from "@/components/EmailPreviewBody";
import { EmailSendConfirmModal } from "@/components/EmailSendConfirmModal";
import type { EmailSendMode } from "@/lib/email-recipients";
import {
  applyMergedPhotoUploadsToPayload,
  draftSaveStageLabel,
  extractPhotoUploadsFromPayload,
  logDraftPhotoSaveDiagnostic,
  mergeDurablePhotoUploads,
  type DraftPhotoSaveStage,
  verifyMergedStoragePathsPresent,
} from "@/lib/draft-photo-persistence";
import { supabase } from "@/lib/supabase/client";
import {
  LINXUP_ASSET_TRACKER_FORM_ID,
  LINXUP_LINXCAM_FORM_ID,
  LINXUP_VEHICLE_TRACKER_FORM_ID,
  LINXUP_VEHICLE_TYPE_OPTIONS,
  buildLinxUpPayload,
  isLinxUpAssetTrackerFormId,
  isLinxUpLinxCamFormId,
  isLinxUpSectionKey,
  isLinxUpVehicleTrackerFormId,
} from "@/lib/linxup";
import {
  buildFormScopedAutosaveKey,
  getFormDefinitionBySectionKey,
  type FormDefinition,
} from "@/lib/form-registry";
import {
  areAdditionalProductsAllowed,
  buildProductLookupMaps,
  getAllowedAdditionalProducts,
  getAllowedPrimaryProducts,
  getProductLabelWithLookup,
  resolveEffectiveSectionKeyWithLookup,
  selectedSectionsIncludeEffectiveWithLookup,
  toFormDefinitionFromProduct,
  toProductDisplayContext,
  type NormalizedProductDefinition,
} from "@/lib/product-config";
import { useCompanyProducts } from "@/lib/product-config/use-company-products";
import {
  deleteOfflineJobCardDraft,
  getOfflineJobCardDraftById,
  INSTALLER_OFFLINE_DRAFT_ID_KEY,
  saveOfflineJobCardDraft,
  type OfflineJobCardDraftRecord,
} from "@/lib/offline-job-card-drafts";
import { getBestStarterSnapshotForOffline } from "@/lib/starter-data-cache";
import {
  formatServiceAppointment,
  formatUpper,
  formatWorkOrder,
  sanitizeServiceAppointmentInput,
  sanitizeWorkOrderInput,
} from "@/lib/format";
import { SerialInput } from "@/components/SerialInput";
import { ProductFileUpload } from "@/components/ProductFileUpload";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { insertCustomerSiteFileRow, uploadPpdJsonFileToStorage } from "@/lib/ppd-json-storage";
import {
  PPD_JSON_FILE_KEY,
  PPD_PRODUCT_KEY,
  productFileSlotId,
  readUploadedProductFiles,
  mergeDurableProductFiles,
  extractProductFilesFromPayload,
  collectRequiredProductFileIssues,
  flattenUploadedProductFiles,
  hydrateAllProductFileSlotsFromPayload,
  mergeLegacyPpdIntoProductFiles,
  ppdJsonConfigFromUploadedProductFile,
  syncPpdPayloadWithProductFiles,
  uploadProductFile,
  insertProductFileSiteRowTyped,
  type ProductFileDefinition,
  type ProductFileUploadSlot,
  type UploadedProductFile,
} from "@/lib/product-files";
import {
  BlaxtairAhdEquipmentSection,
  BlaxtairAhdReviewSummary,
  type BlaxtairPhotoSlot,
  type BlaxtairPhotoSlotKey,
} from "@/components/product-devices/BlaxtairAhdEquipmentSection";
import {
  BlaxtairSscSpeedSection,
  type SscPhotoSlotKey,
  type SscSpeedFieldState,
} from "@/components/product-devices/BlaxtairSscSpeedSection";
import type { InstalledProductSystem } from "@/lib/product-devices";

const PHOTO_BUCKET = "job-card-photos";

async function deleteJobCardPhotoObject(storagePath: string) {
  try {
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
    if (error) {
      console.warn("Supabase storage cleanup warning:", {
        message: String((error as { message?: unknown }).message ?? ""),
        name: String((error as { name?: unknown }).name ?? ""),
        statusCode: String((error as { statusCode?: unknown }).statusCode ?? ""),
        error: String((error as { error?: unknown }).error ?? ""),
        json: (() => {
          try {
            return JSON.stringify(error);
          } catch {
            return "";
          }
        })(),
        storagePath,
        bucket: PHOTO_BUCKET,
      });
    }
  } catch (e) {
    console.warn("Supabase storage cleanup warning:", {
      message: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : "",
      json: (() => {
        try {
          return JSON.stringify(e);
        } catch {
          return "";
        }
      })(),
      storagePath,
      bucket: PHOTO_BUCKET,
    });
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
const JOB_CARD_AUTOSAVE_KEY = "jobCard_autosave";
const JOB_CARD_DRAFTS_MIGRATION_KEY = "installer-job-card-drafts-submission-id-migrated-v1";
const DEFAULT_COMPANY_NAME = "Powerfleet";
const DEFAULT_PROJECT_NAME = "Default Project";
const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";
const generateId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function generateSubmissionId(): string {
  return generateId();
}

/** PPD text fields persisted on job card drafts (JSON). PPD photos use `photoUploads` like VAC. */
type StoredPpdDraftPayload = {
  hubSerial: string;
  cameraLocations: string[];
  cameraSerialsByLocation: Record<string, string>;
  monitorInstalled: string;
  customBracketsNeeded: string;
  customBracketNotes: string;
  clientApproval: string;
  jsonFileName: string;
  jsonConfigFile?: JobCardPpdJsonConfigFile;
  relaysUsedForSpeedControl: string;
  redWireDescription: string;
  blackWireDescription: string;
  yellowWireDescription: string;
  greyWireDescription: string;
  blueWireDescription: string;
  powerConverterDescription: string;
  redAlarmOutDescription: string;
  yellowAlarmOutDescription: string;
  blackAlarmGroundDescription: string;
};

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
    /** Present on drafts saved after PPD draft persistence; omit on older drafts. */
    ppd?: StoredPpdDraftPayload;
    /** CP4 text/select fields only (local photos are not in draft JSON). Omit when CP4 not selected or on older drafts. */
    cp4?: StoredCp4DraftPayload;
    /** Blaxtair SSC Speed text fields (photos/config file travel via photoUploads/productFiles). */
    sscSpeed?: JobCardSscSpeedPayload;
    /** Registry form id when known. */
    formId?: string;
    /** Registry submission type. */
    submissionType?: string;
    /** Shared LinxUp profile fields (product identity is formId/submissionType). */
    linxup?: {
      vehicleType: string;
      hoursMiles: string;
      year?: string;
      powerConnectionDescription?: string;
      groundConnectionDescription?: string;
      ignitionConnectionDescription?: string;
      vehicleTracker?: {
        obdPortConnected: string;
        installationNotes: string;
        powerConnectionDescription?: string;
        groundConnectionDescription?: string;
        ignitionConnectionDescription?: string;
      };
      linxCam?: {
        obdPortConnected: string;
        installationNotes?: string;
        powerConnectionDescription?: string;
        groundConnectionDescription?: string;
        ignitionConnectionDescription?: string;
      };
    };
    photoUploads?: UploadedPhotoMetadata[];
    /** Canonical product-file metadata; bytes remain in Storage. */
    productFiles?: UploadedProductFile[];
    /** Blaxtair AHD equipment (camera(s) + monitor) — see BlaxtairAhdEquipmentSection. */
    installedProductSystems?: InstalledProductSystem[];
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

type JobCardAutosavePayload = {
  submissionId: string;
  savedAt: string;
  selectedSections: string[];
  data: StoredJobCardDraft["data"];
  companyId?: string;
  projectId?: string;
  companyName?: string;
  projectName?: string;
  customer?: string;
  location?: string;
};

type OfflinePpdJsonFileAttachment = {
  name: string;
  type: string;
  lastModified: number;
  data: Blob;
};

type OfflineJobCardDraftPayload = OfflineJobCardDraftRecord<StoredJobCardDraft["data"]> & {
  attachments?: {
    ppdJsonFile?: OfflinePpdJsonFileAttachment;
  };
};

function getAutosaveKey(companyId: string, projectId: string, formId?: string): string {
  const c = companyId.trim();
  const p = projectId.trim();
  const f = (formId || "").trim();
  if (c && p && f) return buildFormScopedAutosaveKey({ companyId: c, projectId: p, formId: f });
  if (c && p) return `${JOB_CARD_AUTOSAVE_KEY}:${c}:${p}`;
  return JOB_CARD_AUTOSAVE_KEY;
}

function parseJobCardAutosavePayload(raw: string | null): JobCardAutosavePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as JobCardAutosavePayload;
    return parsed?.data && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function autosavePayloadMatchesSelectedContext(
  payload: JobCardAutosavePayload,
  selectedCompanyId: string,
  selectedProjectId: string,
): boolean {
  const sc = selectedCompanyId.trim();
  const sp = selectedProjectId.trim();
  const pc = (payload.companyId ?? "").trim();
  const pp = (payload.projectId ?? "").trim();
  if (sc && sp) return pc === sc && pp === sp;
  if (!sc && !sp) return !pc && !pp;
  if (sc && !sp) return pc === sc && !pp;
  if (!sc && sp) return pp === sp && !pc;
  return false;
}

function readMatchingAutosave(
  selectedCompanyId: string,
  selectedProjectId: string,
  formId?: string,
): JobCardAutosavePayload | null {
  if (typeof window === "undefined") return null;
  const sc = selectedCompanyId.trim();
  const sp = selectedProjectId.trim();
  const f = (formId || "").trim();

  if (f) {
    const scoped = parseJobCardAutosavePayload(window.localStorage.getItem(getAutosaveKey(sc, sp, f)));
    if (scoped && autosavePayloadMatchesSelectedContext(scoped, sc, sp)) return scoped;
  }

  // Legacy company+project key (pre form-scoped drafts) — restore for Powerfleet/Matrix compatibility.
  const legacy = parseJobCardAutosavePayload(window.localStorage.getItem(getAutosaveKey(sc, sp)));
  if (legacy && autosavePayloadMatchesSelectedContext(legacy, sc, sp)) {
    if (!f) return legacy;
    const legacyFormId =
      (legacy.data?.formId || "").trim() ||
      getFormDefinitionBySectionKey(legacy.data?.hardwareSelection?.primary)?.id ||
      "";
    if (!legacyFormId || legacyFormId === f) return legacy;
  }

  // Do not scan arbitrary form-scoped keys when formId is unknown — that can restore a
  // Vehicle Tracker draft into a LinxCam session (or vice versa).

  return null;
}

function clearMatchingAutosave(
  selectedCompanyId: string,
  selectedProjectId: string,
  formId?: string,
): void {
  if (typeof window === "undefined") return;
  const sc = selectedCompanyId.trim();
  const sp = selectedProjectId.trim();
  const f = (formId || "").trim();
  try {
    if (f) {
      window.localStorage.removeItem(getAutosaveKey(sc, sp, f));
    }
    window.localStorage.removeItem(getAutosaveKey(sc, sp));
    if (!f && sc && sp) {
      const prefix = `${JOB_CARD_AUTOSAVE_KEY}:${sc}:${sp}:`;
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(prefix)) toRemove.push(key);
      }
      for (const key of toRemove) window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

function clearRestoredAutosaveAfterPersist(
  targetRef: MutableRefObject<{ companyId: string; projectId: string } | null>,
  reason: string,
  options?: { log?: boolean },
): void {
  const t = targetRef.current;
  if (!t) return;
  clearMatchingAutosave(t.companyId, t.projectId);
  targetRef.current = null;
  if (options?.log !== false) {
    console.log("[autosave] cleared after save", reason);
  }
}

type DefaultContextIds = {
  companyId: string;
  projectId: string;
};

type ProjectAutofillRow = {
  customer_id: string | null;
  customer_name: string | null;
  location: string | null;
};

type CustomerLookupRow = {
  customer_name: string | null;
  full_address: string | null;
  site_contact_name?: string | null;
  contact_number?: string | null;
  contact_email?: string | null;
};

type ProjectContextPayload = {
  companyId: string;
  projectId: string;
  projectName: string;
  projectRecipientEmails: string[];
};

type ProjectRecipientsRow = {
  id: string;
  company_id: string | null;
  project_name: string | null;
  external_recipient_emails: unknown;
};

function dedupeEmailStrings(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

const UPPERCASE_CORE_KEYS: ReadonlyArray<keyof CoreJobFields> = ["equipmentModel", "equipmentSerial", "unitNumber"];

function normalizeUppercaseCoreJob(core: CoreJobFields): CoreJobFields {
  return {
    ...core,
    workOrder: sanitizeWorkOrderInput(core.workOrder),
    serviceAppointment: sanitizeServiceAppointmentInput(core.serviceAppointment),
    equipmentModel: formatUpper(core.equipmentModel),
    equipmentSerial: formatUpper(core.equipmentSerial),
    unitNumber: formatUpper(core.unitNumber),
    primaryContact: core.primaryContact ?? "",
    contactNumber: core.contactNumber ?? "",
    contactEmail: core.contactEmail ?? "",
  };
}

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

/** PPD local-only photo slots (no Supabase upload in this phase). */
const PPD_PHOTO_KEYS = [
  "monitorInstalled",
  "cameraHubMounting",
  "wirePath",
  "redBattery",
  "blackBattery",
  "yellowIgnition",
  "greyMotion",
  "blueDirection",
  "powerConverter",
  "redAlarmOut",
  "yellowAlarmOut",
  "blackAlarmGround",
  // Blaxtair AHD label photos — single-photo "replace" slots, reusing the PPD upload plumbing
  // (Storage bucket, photoUploads[], draft persistence, email photo attachments) unchanged.
  "blaxtairCamera1",
  "blaxtairCamera2",
  "blaxtairCamera3",
  "blaxtairCamera4",
  "blaxtairMonitor",
  "blaxtairMonitorMounting",
  // Blaxtair AHD camera "mounted" confirmation photos (distinct from the label photo).
  "blaxtairCamera1Mounting",
  "blaxtairCamera2Mounting",
  "blaxtairCamera3Mounting",
  "blaxtairCamera4Mounting",
  // Blaxtair AHD camera wire leads — Black/Ground, Red/Out1, Yellow/Out2, Green/Out3, White/In1.
  "blaxtairCamera1WireGround",
  "blaxtairCamera1WireOut1",
  "blaxtairCamera1WireOut2",
  "blaxtairCamera1WireOut3",
  "blaxtairCamera1WireIn1",
  "blaxtairCamera2WireGround",
  "blaxtairCamera2WireOut1",
  "blaxtairCamera2WireOut2",
  "blaxtairCamera2WireOut3",
  "blaxtairCamera2WireIn1",
  "blaxtairCamera3WireGround",
  "blaxtairCamera3WireOut1",
  "blaxtairCamera3WireOut2",
  "blaxtairCamera3WireOut3",
  "blaxtairCamera3WireIn1",
  "blaxtairCamera4WireGround",
  "blaxtairCamera4WireOut1",
  "blaxtairCamera4WireOut2",
  "blaxtairCamera4WireOut3",
  "blaxtairCamera4WireIn1",
  // Blaxtair AHD monitor wire leads — Black/Ground, Red/ConstantPower, Orange/Ignition required;
  // White/Trigger1..Yellow/Trigger5 optional.
  "blaxtairMonitorWireGround",
  "blaxtairMonitorWirePower",
  "blaxtairMonitorWireIgnition",
  "blaxtairMonitorWireTrigger1",
  "blaxtairMonitorWireTrigger2",
  "blaxtairMonitorWireTrigger3",
  "blaxtairMonitorWireTrigger4",
  "blaxtairMonitorWireTrigger5",
  // Blaxtair AHD external pedestrian-alarm mounting photo (system-level, not per-camera).
  "blaxtairAlarmMounting",
  // Blaxtair AHD wire path — system-level, multi-photo (mirrors legacy PPD/CP4/VAC4 wire path).
  "blaxtairWirePath",
  // Blaxtair SSC Speed (secondary product, simple photo+manual-entry fields).
  "sscLabel",
  "sscPower",
  "sscGround",
  "sscIgnition",
  "sscCanConnection",
  "sscSpeedSignal",
  "sscDirection",
  "sscMounting",
  "sscWirePath",
] as const;
type PpdPhotoKey = (typeof PPD_PHOTO_KEYS)[number];

const PPD_WIRE_PATH_MIN_PHOTOS = 3;

/** CP4 photo slots (uploaded to Supabase Storage like VAC; metadata in `photoMetadataByField`). */
const CP4_PHOTO_KEYS = [
  "cameraMounting",
  "wirePath",
  "hubMounting",
  "microphoneMounting",
  "remoteControlMounting",
  "gpsSensorMounting",
  "redBattery",
  "blackBattery",
  "whiteIgnition",
  "monitorMounting",
  "powerConverter",
  "alarmIn1",
  "alarmIn2",
] as const;
type Cp4PhotoKey = (typeof CP4_PHOTO_KEYS)[number];

/** LinxUp Asset Tracker photo slots (uploaded like CP4; metadata in `photoMetadataByField`). */
const LINXUP_AT_PHOTO_KEYS = [
  "assetTrackerTag",
  "powerConnection",
  "groundConnection",
  "ignitionConnection",
  "finalInstall",
] as const;
type LinxupAtPhotoKey = (typeof LINXUP_AT_PHOTO_KEYS)[number];

/** LinxUp Vehicle Tracker photo slots. */
const LINXUP_VT_PHOTO_KEYS = [
  "vehicleTrackerTag",
  "greenActivityLight",
  "installation",
  "finalInstall",
  "powerConnection",
  "groundConnection",
  "ignitionConnection",
] as const;
type LinxupVtPhotoKey = (typeof LINXUP_VT_PHOTO_KEYS)[number];

/** LinxUp LinxCam photo slots. */
const LINXUP_LC_PHOTO_KEYS = [
  "linxCamTag",
  "greenActivityLight",
  "installation",
  "finalInstall",
  "powerConnection",
  "groundConnection",
  "ignitionConnection",
] as const;
type LinxupLcPhotoKey = (typeof LINXUP_LC_PHOTO_KEYS)[number];

/** Namespaced Supabase `fieldName` / metadata keys for PPD job-card photos (draft + submission). */
type PpdUploadFieldName = { [K in PpdPhotoKey]: `ppd_${K}` }[PpdPhotoKey];
/** Namespaced Supabase `fieldName` / metadata keys for CP4 job-card photos (draft + submission). */
type Cp4UploadFieldName = { [K in Cp4PhotoKey]: `cp4_${K}` }[Cp4PhotoKey];
/** Namespaced Supabase `fieldName` / metadata keys for LinxUp Asset Tracker photos. */
type LinxupAtUploadFieldName = { [K in LinxupAtPhotoKey]: `linxup_at_${K}` }[LinxupAtPhotoKey];
/** Namespaced Supabase `fieldName` / metadata keys for LinxUp Vehicle Tracker photos. */
type LinxupVtUploadFieldName = { [K in LinxupVtPhotoKey]: `linxup_vt_${K}` }[LinxupVtPhotoKey];
/** Namespaced Supabase `fieldName` / metadata keys for LinxUp LinxCam photos. */
type LinxupLcUploadFieldName = { [K in LinxupLcPhotoKey]: `linxup_lc_${K}` }[LinxupLcPhotoKey];

function ppdUploadFieldFor(key: PpdPhotoKey): PpdUploadFieldName {
  return `ppd_${key}` as PpdUploadFieldName;
}
function cp4UploadFieldFor(key: Cp4PhotoKey): Cp4UploadFieldName {
  return `cp4_${key}` as Cp4UploadFieldName;
}
function linxupAtUploadFieldFor(key: LinxupAtPhotoKey): LinxupAtUploadFieldName {
  return `linxup_at_${key}` as LinxupAtUploadFieldName;
}
function linxupVtUploadFieldFor(key: LinxupVtPhotoKey): LinxupVtUploadFieldName {
  return `linxup_vt_${key}` as LinxupVtUploadFieldName;
}
function linxupLcUploadFieldFor(key: LinxupLcPhotoKey): LinxupLcUploadFieldName {
  return `linxup_lc_${key}` as LinxupLcUploadFieldName;
}
function ppdKeyFromUploadField(field: PpdUploadFieldName): PpdPhotoKey {
  return field.slice(4) as PpdPhotoKey;
}
function cp4KeyFromUploadField(field: Cp4UploadFieldName): Cp4PhotoKey {
  return field.slice(4) as Cp4PhotoKey;
}
function linxupAtKeyFromUploadField(field: LinxupAtUploadFieldName): LinxupAtPhotoKey {
  return field.slice("linxup_at_".length) as LinxupAtPhotoKey;
}
function linxupVtKeyFromUploadField(field: LinxupVtUploadFieldName): LinxupVtPhotoKey {
  return field.slice("linxup_vt_".length) as LinxupVtPhotoKey;
}
function linxupLcKeyFromUploadField(field: LinxupLcUploadFieldName): LinxupLcPhotoKey {
  return field.slice("linxup_lc_".length) as LinxupLcPhotoKey;
}

/** CP4 text/select fields persisted on job card drafts (JSON). CP4 photos use `photoUploads` like VAC. */
type StoredCp4DraftPayload = {
  drid: string;
  serial: string;
  cameraQuantity: string;
  monitorInstalled: string;
  clientApproval: string;
  customBracketsNeeded: string;
  customBracketNotes: string;
  alarmIn1RelayInstalled: string;
  alarmIn1Description: string;
  alarmIn2RelayInstalled: string;
  alarmIn2Description: string;
  hubMountingDescription: string;
  microphoneMountingDescription: string;
  remoteControlMountingDescription: string;
  gpsSensorMountingDescription: string;
  redWireDescription: string;
  blackWireDescription: string;
  whiteWireDescription: string;
  monitorMountingDescription: string;
  powerConverterDescription: string;
};

function emptyPpdPhotoFiles(): Record<PpdPhotoKey, File[]> {
  const out = {} as Record<PpdPhotoKey, File[]>;
  for (const k of PPD_PHOTO_KEYS) out[k] = [];
  return out;
}

function emptyPpdPhotoErrors(): Record<PpdPhotoKey, string | null> {
  const out = {} as Record<PpdPhotoKey, string | null>;
  for (const k of PPD_PHOTO_KEYS) out[k] = null;
  return out;
}

function emptyCp4PhotoFiles(): Record<Cp4PhotoKey, File[]> {
  const out = {} as Record<Cp4PhotoKey, File[]>;
  for (const k of CP4_PHOTO_KEYS) out[k] = [];
  return out;
}

function emptyCp4PhotoErrors(): Record<Cp4PhotoKey, string | null> {
  const out = {} as Record<Cp4PhotoKey, string | null>;
  for (const k of CP4_PHOTO_KEYS) out[k] = null;
  return out;
}

function emptyLinxupAtPhotoFiles(): Record<LinxupAtPhotoKey, File[]> {
  const out = {} as Record<LinxupAtPhotoKey, File[]>;
  for (const k of LINXUP_AT_PHOTO_KEYS) out[k] = [];
  return out;
}

function emptyLinxupAtPhotoErrors(): Record<LinxupAtPhotoKey, string | null> {
  const out = {} as Record<LinxupAtPhotoKey, string | null>;
  for (const k of LINXUP_AT_PHOTO_KEYS) out[k] = null;
  return out;
}

function emptyLinxupVtPhotoFiles(): Record<LinxupVtPhotoKey, File[]> {
  const out = {} as Record<LinxupVtPhotoKey, File[]>;
  for (const k of LINXUP_VT_PHOTO_KEYS) out[k] = [];
  return out;
}

function emptyLinxupVtPhotoErrors(): Record<LinxupVtPhotoKey, string | null> {
  const out = {} as Record<LinxupVtPhotoKey, string | null>;
  for (const k of LINXUP_VT_PHOTO_KEYS) out[k] = null;
  return out;
}

function emptyLinxupLcPhotoFiles(): Record<LinxupLcPhotoKey, File[]> {
  const out = {} as Record<LinxupLcPhotoKey, File[]>;
  for (const k of LINXUP_LC_PHOTO_KEYS) out[k] = [];
  return out;
}

function emptyLinxupLcPhotoErrors(): Record<LinxupLcPhotoKey, string | null> {
  const out = {} as Record<LinxupLcPhotoKey, string | null>;
  for (const k of LINXUP_LC_PHOTO_KEYS) out[k] = null;
  return out;
}

function parseVehicleVoltageVolts(driveType: string, voltageSelect: string, voltageOther: string): number | null {
  if (driveType !== "Electric") return null;
  if (!voltageSelect.trim()) return null;
  if (voltageSelect === "Other") {
    const cleaned = voltageOther.replace(/,/g, ".").replace(/[^0-9.]/gi, "").trim();
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = parseFloat(voltageSelect);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hardwareSectionTriggersPpdAlarmOut(
  sectionLabel: string,
  resolveEffective: (key: string) => string,
): boolean {
  const effective = resolveEffective(sectionLabel);
  if (effective === "VAC4" || effective === "Speed Transmon" || effective === "Speed SSC") return true;
  const label = sectionLabel.trim().toLowerCase();
  if (!label) return false;
  if (label.includes("vac4")) return true;
  if (label.includes("speed")) return true;
  if (label.includes("transmon")) return true;
  if (label.includes("ssc")) return true;
  return false;
}

/** PPD "relays for speed control" — only when Speed-family hardware is checked as *additional*, not primary-only. */
function isSpeedControlAdditionalHardwareLabel(
  sectionLabel: string,
  resolveEffective: (key: string) => string,
): boolean {
  const t = sectionLabel.trim();
  if (!t) return false;
  const effective = resolveEffective(t);
  if (effective === "VAC4") return false;
  if (effective === "Speed Transmon" || effective === "Speed SSC") return true;
  const lower = t.toLowerCase();
  if (lower.includes("speed")) return true;
  if (lower.includes("transmon")) return true;
  if (lower.includes("ssc")) return true;
  return false;
}

type PpdCameraLocationKey = "front" | "rear" | "rightSide" | "leftSide";

const PPD_CAMERA_LOCATION_OPTIONS: { key: PpdCameraLocationKey; label: string; serialLabel: string }[] = [
  { key: "front", label: "Front", serialLabel: "Front Camera Serial Number" },
  { key: "rear", label: "Rear", serialLabel: "Rear Camera Serial Number" },
  { key: "rightSide", label: "Right Side", serialLabel: "Right Side Camera Serial Number" },
  { key: "leftSide", label: "Left Side", serialLabel: "Left Side Camera Serial Number" },
];

const emptyPpdCameraSerialsByLocation = (): Record<PpdCameraLocationKey, string> => ({
  front: "",
  rear: "",
  rightSide: "",
  leftSide: "",
});

function sanitizePpdCameraLocationsFromDraft(raw: unknown): PpdCameraLocationKey[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<PpdCameraLocationKey>(PPD_CAMERA_LOCATION_OPTIONS.map((o) => o.key));
  const out: PpdCameraLocationKey[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    if (!allowed.has(x as PpdCameraLocationKey)) continue;
    const key = x as PpdCameraLocationKey;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** PPD hub + per-camera serial fields: letters uppercase in real time; numbers/symbols unchanged. */
function normalizePpdSerialInput(value: string): string {
  return value.toUpperCase();
}

function mergePpdCameraSerialsFromDraft(raw: unknown): Record<PpdCameraLocationKey, string> {
  const base = emptyPpdCameraSerialsByLocation();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  for (const { key } of PPD_CAMERA_LOCATION_OPTIONS) {
    const v = o[key];
    if (typeof v === "string") base[key] = normalizePpdSerialInput(v);
  }
  return base;
}

function draftString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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
type UploadFieldName =
  | keyof VacPhotoFileNames
  | VehiclePictureKey
  | PpdUploadFieldName
  | Cp4UploadFieldName
  | LinxupAtUploadFieldName
  | LinxupVtUploadFieldName
  | LinxupLcUploadFieldName;
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

const emptyPhotoMetadataByField = (): PhotoMetadataByFieldState => {
  const o = {} as Record<string, UploadedPhotoMetadata[]>;
  for (const k of Object.keys(emptyVacPhotoFileNames()) as (keyof VacPhotoFileNames)[]) o[k as string] = [];
  o.vehicleFront = [];
  o.vehicleSide = [];
  o.vehicleRear = [];
  for (const k of PPD_PHOTO_KEYS) o[ppdUploadFieldFor(k)] = [];
  for (const k of CP4_PHOTO_KEYS) o[cp4UploadFieldFor(k)] = [];
  for (const k of LINXUP_AT_PHOTO_KEYS) o[linxupAtUploadFieldFor(k)] = [];
  for (const k of LINXUP_VT_PHOTO_KEYS) o[linxupVtUploadFieldFor(k)] = [];
  for (const k of LINXUP_LC_PHOTO_KEYS) o[linxupLcUploadFieldFor(k)] = [];
  return o as PhotoMetadataByFieldState;
};

const PHOTO_FIELD_LABELS_BASE: Record<keyof VacPhotoFileNames | VehiclePictureKey, string> = {
  vacMounting: "VAC4 mounting",
  wirePath: "Wire path",
  redWire: "Red (+) battery",
  blackWire: "Black (−) battery",
  blueWire: "Blue wire",
  brownWire: "Brown wire",
  sensorHubMounting: "Sensor hub",
  speedSense: "Speed sense",
  loadSense: "Load sense",
  gps: "GPS",
  externalIndicator: "External indicator",
  purpleWire: "Purple wire",
  relayAccess: "Relay access",
  impactSensor: "Impact sensor",
  vehicleFront: "Vehicle front",
  vehicleSide: "Vehicle side",
  vehicleRear: "Vehicle rear",
};

const PPD_PHOTO_LABELS: Record<PpdPhotoKey, string> = {
  monitorInstalled: "PPD — monitor install",
  cameraHubMounting: "PPD — camera & hub",
  wirePath: "PPD — wire path",
  redBattery: "PPD — red (+) battery",
  blackBattery: "PPD — black (−) battery",
  yellowIgnition: "PPD — yellow ignition",
  greyMotion: "PPD — grey motion",
  blueDirection: "PPD — blue direction",
  powerConverter: "PPD — power converter",
  redAlarmOut: "PPD — red alarm out",
  yellowAlarmOut: "PPD — yellow alarm out",
  blackAlarmGround: "PPD — black alarm ground",
  blaxtairCamera1: "Blaxtair — camera 1 label",
  blaxtairCamera2: "Blaxtair — camera 2 label",
  blaxtairCamera3: "Blaxtair — camera 3 label",
  blaxtairCamera4: "Blaxtair — camera 4 label",
  blaxtairMonitor: "Blaxtair — monitor label",
  blaxtairMonitorMounting: "Blaxtair — monitor mounting photo",
  blaxtairCamera1Mounting: "Blaxtair — camera 1 mounted",
  blaxtairCamera2Mounting: "Blaxtair — camera 2 mounted",
  blaxtairCamera3Mounting: "Blaxtair — camera 3 mounted",
  blaxtairCamera4Mounting: "Blaxtair — camera 4 mounted",
  blaxtairCamera1WireGround: "Blaxtair — camera 1 wire: Black (Ground)",
  blaxtairCamera1WireOut1: "Blaxtair — camera 1 wire: Red (Out 1)",
  blaxtairCamera1WireOut2: "Blaxtair — camera 1 wire: Yellow (Out 2)",
  blaxtairCamera1WireOut3: "Blaxtair — camera 1 wire: Green (Out 3)",
  blaxtairCamera1WireIn1: "Blaxtair — camera 1 wire: White (In 1)",
  blaxtairCamera2WireGround: "Blaxtair — camera 2 wire: Black (Ground)",
  blaxtairCamera2WireOut1: "Blaxtair — camera 2 wire: Red (Out 1)",
  blaxtairCamera2WireOut2: "Blaxtair — camera 2 wire: Yellow (Out 2)",
  blaxtairCamera2WireOut3: "Blaxtair — camera 2 wire: Green (Out 3)",
  blaxtairCamera2WireIn1: "Blaxtair — camera 2 wire: White (In 1)",
  blaxtairCamera3WireGround: "Blaxtair — camera 3 wire: Black (Ground)",
  blaxtairCamera3WireOut1: "Blaxtair — camera 3 wire: Red (Out 1)",
  blaxtairCamera3WireOut2: "Blaxtair — camera 3 wire: Yellow (Out 2)",
  blaxtairCamera3WireOut3: "Blaxtair — camera 3 wire: Green (Out 3)",
  blaxtairCamera3WireIn1: "Blaxtair — camera 3 wire: White (In 1)",
  blaxtairCamera4WireGround: "Blaxtair — camera 4 wire: Black (Ground)",
  blaxtairCamera4WireOut1: "Blaxtair — camera 4 wire: Red (Out 1)",
  blaxtairCamera4WireOut2: "Blaxtair — camera 4 wire: Yellow (Out 2)",
  blaxtairCamera4WireOut3: "Blaxtair — camera 4 wire: Green (Out 3)",
  blaxtairCamera4WireIn1: "Blaxtair — camera 4 wire: White (In 1)",
  blaxtairMonitorWireGround: "Blaxtair — monitor wire: Black (Ground)",
  blaxtairMonitorWirePower: "Blaxtair — monitor wire: Red (Constant Power)",
  blaxtairMonitorWireIgnition: "Blaxtair — monitor wire: Orange (Ignition)",
  blaxtairMonitorWireTrigger1: "Blaxtair — monitor wire: White (Trigger 1)",
  blaxtairMonitorWireTrigger2: "Blaxtair — monitor wire: Blue (Trigger 2)",
  blaxtairMonitorWireTrigger3: "Blaxtair — monitor wire: Green (Trigger 3)",
  blaxtairMonitorWireTrigger4: "Blaxtair — monitor wire: Brown (Trigger 4)",
  blaxtairMonitorWireTrigger5: "Blaxtair — monitor wire: Yellow (Trigger 5)",
  blaxtairAlarmMounting: "Blaxtair — external alarm mounting",
  blaxtairWirePath: "Blaxtair — wire path",
  sscLabel: "SSC Speed — label photo",
  sscPower: "SSC Speed — power connection",
  sscGround: "SSC Speed — ground connection",
  sscIgnition: "SSC Speed — ignition connection",
  sscCanConnection: "SSC Speed — CAN connection",
  sscSpeedSignal: "SSC Speed — speed signal connection",
  sscDirection: "SSC Speed — direction signal connection",
  sscMounting: "SSC Speed — mounting",
  sscWirePath: "SSC Speed — wire path",
};

const CP4_PHOTO_LABELS: Record<Cp4PhotoKey, string> = {
  cameraMounting: "CP4 — camera mount",
  wirePath: "CP4 — wire path",
  hubMounting: "CP4 — DVR mount",
  microphoneMounting: "CP4 — microphone",
  remoteControlMounting: "CP4 — remote control",
  gpsSensorMounting: "CP4 — GPS sensor",
  redBattery: "CP4 — red (+) battery",
  blackBattery: "CP4 — black (−) battery",
  whiteIgnition: "CP4 — white ignition",
  monitorMounting: "CP4 — monitor",
  powerConverter: "CP4 — power converter",
  alarmIn1: "CP4 — alarm IN 1",
  alarmIn2: "CP4 — alarm IN 2",
};

const LINXUP_AT_PHOTO_LABELS: Record<LinxupAtPhotoKey, string> = {
  assetTrackerTag: "Asset Tracker — tag",
  powerConnection: "Asset Tracker — power connection",
  groundConnection: "Asset Tracker — ground connection",
  ignitionConnection: "Asset Tracker — ignition connection",
  finalInstall: "Asset Tracker — final install",
};

const LINXUP_VT_PHOTO_LABELS: Record<LinxupVtPhotoKey, string> = {
  vehicleTrackerTag: "Vehicle Tracker — tag",
  greenActivityLight: "Vehicle Tracker — green activity light",
  installation: "Vehicle Tracker — installation",
  finalInstall: "Vehicle Tracker — final installation",
  powerConnection: "Vehicle Tracker — power connection",
  groundConnection: "Vehicle Tracker — ground connection",
  ignitionConnection: "Vehicle Tracker — ignition connection",
};

const LINXUP_LC_PHOTO_LABELS: Record<LinxupLcPhotoKey, string> = {
  linxCamTag: "LinxCam — tag",
  greenActivityLight: "LinxCam — green activity light",
  installation: "LinxCam — installation",
  finalInstall: "LinxCam — final installation",
  powerConnection: "LinxCam — power connection",
  groundConnection: "LinxCam — ground connection",
  ignitionConnection: "LinxCam — ignition connection",
};

const PHOTO_FIELD_LABELS: Record<UploadFieldName, string> = {
  ...PHOTO_FIELD_LABELS_BASE,
  ...Object.fromEntries(PPD_PHOTO_KEYS.map((k) => [ppdUploadFieldFor(k), PPD_PHOTO_LABELS[k]])) as Record<
    PpdUploadFieldName,
    string
  >,
  ...Object.fromEntries(CP4_PHOTO_KEYS.map((k) => [cp4UploadFieldFor(k), CP4_PHOTO_LABELS[k]])) as Record<
    Cp4UploadFieldName,
    string
  >,
  ...Object.fromEntries(LINXUP_AT_PHOTO_KEYS.map((k) => [linxupAtUploadFieldFor(k), LINXUP_AT_PHOTO_LABELS[k]])) as Record<
    LinxupAtUploadFieldName,
    string
  >,
  ...Object.fromEntries(LINXUP_VT_PHOTO_KEYS.map((k) => [linxupVtUploadFieldFor(k), LINXUP_VT_PHOTO_LABELS[k]])) as Record<
    LinxupVtUploadFieldName,
    string
  >,
  ...Object.fromEntries(LINXUP_LC_PHOTO_KEYS.map((k) => [linxupLcUploadFieldFor(k), LINXUP_LC_PHOTO_LABELS[k]])) as Record<
    LinxupLcUploadFieldName,
    string
  >,
};

/** Shared upload control copy for VAC4, PPD, CP4, and vehicle photos */
export const PHOTO_UPLOAD_LABEL_SINGLE = "Take or upload photo";
const PHOTO_UPLOAD_LABEL_MULTI = "Take or upload photos";

const VAC_PHOTO_KEYS = Object.keys(emptyVacPhotoFileNames()) as (keyof VacPhotoFileNames)[];

function isVehiclePictureField(f: UploadFieldName): f is VehiclePictureKey {
  return f === "vehicleFront" || f === "vehicleSide" || f === "vehicleRear";
}

function isPpdUploadField(f: UploadFieldName): f is PpdUploadFieldName {
  return PPD_PHOTO_KEYS.some((k) => f === ppdUploadFieldFor(k));
}

function isCp4UploadField(f: UploadFieldName): f is Cp4UploadFieldName {
  return CP4_PHOTO_KEYS.some((k) => f === cp4UploadFieldFor(k));
}

function isLinxupAtUploadField(f: UploadFieldName): f is LinxupAtUploadFieldName {
  return LINXUP_AT_PHOTO_KEYS.some((k) => f === linxupAtUploadFieldFor(k));
}

function isLinxupVtUploadField(f: UploadFieldName): f is LinxupVtUploadFieldName {
  return LINXUP_VT_PHOTO_KEYS.some((k) => f === linxupVtUploadFieldFor(k));
}

function isLinxupLcUploadField(f: UploadFieldName): f is LinxupLcUploadFieldName {
  return LINXUP_LC_PHOTO_KEYS.some((k) => f === linxupLcUploadFieldFor(k));
}

function VAC4Section({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function RequiredMark() {
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
      return "mt-1 inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold tracking-tight text-slate-700 ring-1 ring-inset ring-slate-200/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600";
    case "Complete":
      return "mt-1 inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold tracking-tight text-emerald-900 ring-1 ring-inset ring-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-800/60";
    case "In Progress":
    default:
      return "mt-1 inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold tracking-tight text-amber-900 ring-1 ring-inset ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-800/50";
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
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] dark:border-gray-700 dark:bg-gray-900 sm:p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${ring} text-white`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
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
      <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{title}</h2>
    </div>
  );
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

export function PhotoUploadFeedback({ count, names }: { count: number; names: string[] }) {
  const line = formatPhotoSelectionLine(count, names);
  if (!line) return null;
  return <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{line}</p>;
}

export type RemoteThumb = { publicUrl: string; filename: string; storagePath?: string; uploadedAt?: string };

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
          <div
            key={e.key}
            className="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
          >
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                onClick={() => onRemoveRemote?.(e.remote)}
              >
                Remove
              </button>
            </div>
            <img src={e.remote.publicUrl} alt={e.remote.filename} className="h-20 w-full rounded-md object-cover" />
            <p className="mt-1 truncate text-xs text-gray-700 dark:text-gray-300" title={e.remote.filename}>
              {e.remote.filename}
            </p>
          </div>
        ) : (
          <div
            key={e.key}
            className="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
          >
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                onClick={() => onRemoveLocal?.(e.file)}
              >
                Remove
              </button>
            </div>
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

export function NewSubmissionForm() {
  const router = useRouter();
  const { loading: authLoading, context: authUserContext } = useAuthUserContext();
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
    primaryContact: "",
    contactNumber: "",
    contactEmail: "",
  });
  const [selectedCompanyName, setSelectedCompanyName] = useState<string | null>(null);
  /** Company UUID from localStorage — used for hybrid DB product resolution. */
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  /** False until selected company name is resolved from localStorage company id (or confirmed missing). */
  const [companyContextReady, setCompanyContextReady] = useState(false);
  const [linxupVehicleType, setLinxupVehicleType] = useState("");
  const [linxupHoursMiles, setLinxupHoursMiles] = useState("");
  const [linxupYear, setLinxupYear] = useState("");
  const [linxupPowerConnectionDescription, setLinxupPowerConnectionDescription] = useState("");
  const [linxupGroundConnectionDescription, setLinxupGroundConnectionDescription] = useState("");
  const [linxupIgnitionConnectionDescription, setLinxupIgnitionConnectionDescription] = useState("");
  const [linxupAtPhotoFiles, setLinxupAtPhotoFiles] = useState<Record<LinxupAtPhotoKey, File[]>>(() => emptyLinxupAtPhotoFiles());
  const [linxupAtPhotoErrors, setLinxupAtPhotoErrors] = useState<Record<LinxupAtPhotoKey, string | null>>(() =>
    emptyLinxupAtPhotoErrors(),
  );
  const [linxupVtObdPortConnected, setLinxupVtObdPortConnected] = useState("");
  const [linxupVtInstallationNotes, setLinxupVtInstallationNotes] = useState("");
  const [linxupVtPowerConnectionDescription, setLinxupVtPowerConnectionDescription] = useState("");
  const [linxupVtGroundConnectionDescription, setLinxupVtGroundConnectionDescription] = useState("");
  const [linxupVtIgnitionConnectionDescription, setLinxupVtIgnitionConnectionDescription] = useState("");
  const [linxupVtPhotoFiles, setLinxupVtPhotoFiles] = useState<Record<LinxupVtPhotoKey, File[]>>(() => emptyLinxupVtPhotoFiles());
  const [linxupVtPhotoErrors, setLinxupVtPhotoErrors] = useState<Record<LinxupVtPhotoKey, string | null>>(() =>
    emptyLinxupVtPhotoErrors(),
  );
  const [linxupLcObdPortConnected, setLinxupLcObdPortConnected] = useState("");
  const [linxupLcInstallationNotes, setLinxupLcInstallationNotes] = useState("");
  const [linxupLcPowerConnectionDescription, setLinxupLcPowerConnectionDescription] = useState("");
  const [linxupLcGroundConnectionDescription, setLinxupLcGroundConnectionDescription] = useState("");
  const [linxupLcIgnitionConnectionDescription, setLinxupLcIgnitionConnectionDescription] = useState("");
  const [linxupLcPhotoFiles, setLinxupLcPhotoFiles] = useState<Record<LinxupLcPhotoKey, File[]>>(() => emptyLinxupLcPhotoFiles());
  const [linxupLcPhotoErrors, setLinxupLcPhotoErrors] = useState<Record<LinxupLcPhotoKey, string | null>>(() =>
    emptyLinxupLcPhotoErrors(),
  );
  /** Blaxtair AHD equipment (camera(s) + monitor) — only populated when that product is selected. */
  const [blaxtairSystem, setBlaxtairSystem] = useState<InstalledProductSystem | null>(null);
  /** Blaxtair SSC Speed — simple photo + manual-entry fields, only populated when that product is selected. */
  const [sscFields, setSscFields] = useState<SscSpeedFieldState>({
    connectionType: "",
    powerDescription: "",
    groundDescription: "",
    ignitionDescription: "",
    speedSignalDescription: "",
    hasDirectionSignal: false,
    directionDescription: "",
  });
  const [sscConfigFile, setSscConfigFile] = useState<UploadedProductFile | null>(null);
  const [sscConfigFileUploading, setSscConfigFileUploading] = useState(false);
  const [sscConfigFileError, setSscConfigFileError] = useState<string | null>(null);
  const [submissionCompletedAt, setSubmissionCompletedAt] = useState<number | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<"Draft" | "Submitted">("Draft");
  const [submitSuccessMessage, setSubmitSuccessMessage] = useState<string | null>(null);
  const [emailSubmissionPreview, setEmailSubmissionPreview] = useState<{ model: EmailViewModel } | null>(null);
  const [emailSendModalOpen, setEmailSendModalOpen] = useState(false);
  const [lastEmailMode, setLastEmailMode] = useState<EmailSendMode | null>(null);
  const [submitPersistStatus, setSubmitPersistStatus] = useState<"idle" | "saving" | "error">("idle");
  const [projectExternalRecipientEmails, setProjectExternalRecipientEmails] = useState<string[]>([]);
  const [pendingEmailPayload, setPendingEmailPayload] = useState<JobCardSubmissionPayload | null>(null);
  const [emailSendStatus, setEmailSendStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [emailSendErrorMessage, setEmailSendErrorMessage] = useState<string | null>(null);
  const [postSubmitSyncWarning, setPostSubmitSyncWarning] = useState<string | null>(null);

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
  const [ppdHubSerial, setPpdHubSerial] = useState("");
  const [ppdCameraLocations, setPpdCameraLocations] = useState<PpdCameraLocationKey[]>([]);
  const [ppdCameraSerialsByLocation, setPpdCameraSerialsByLocation] = useState<Record<PpdCameraLocationKey, string>>(
    () => emptyPpdCameraSerialsByLocation(),
  );
  const [ppdMonitorInstalled, setPpdMonitorInstalled] = useState("");
  const [ppdCustomBracketsNeeded, setPpdCustomBracketsNeeded] = useState("");
  const [ppdCustomBracketNotes, setPpdCustomBracketNotes] = useState("");
  const [ppdClientApproval, setPpdClientApproval] = useState("");
  const [ppdJsonFileName, setPpdJsonFileName] = useState("");
  const [ppdJsonLocalFile, setPpdJsonLocalFile] = useState<File | null>(null);
  const [ppdJsonUploadedConfig, setPpdJsonUploadedConfig] = useState<JobCardPpdJsonConfigFile | null>(null);
  /** Product-file slots keyed by productKey::fileKey::device. */
  const [productFileSlots, setProductFileSlots] = useState<Record<string, ProductFileUploadSlot>>({});
  const [ppdProjectCustomerId, setPpdProjectCustomerId] = useState<string | null>(null);
  const ppdJsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const [ppdRelaysUsedForSpeedControl, setPpdRelaysUsedForSpeedControl] = useState("");
  const [ppdRedWireDescription, setPpdRedWireDescription] = useState("");
  const [ppdBlackWireDescription, setPpdBlackWireDescription] = useState("");
  const [ppdYellowWireDescription, setPpdYellowWireDescription] = useState("");
  const [ppdGreyWireDescription, setPpdGreyWireDescription] = useState("");
  const [ppdBlueWireDescription, setPpdBlueWireDescription] = useState("");
  const [ppdPowerConverterDescription, setPpdPowerConverterDescription] = useState("");
  const [ppdRedAlarmOutDescription, setPpdRedAlarmOutDescription] = useState("");
  const [ppdYellowAlarmOutDescription, setPpdYellowAlarmOutDescription] = useState("");
  const [ppdBlackAlarmGroundDescription, setPpdBlackAlarmGroundDescription] = useState("");
  const [ppdPhotoFiles, setPpdPhotoFiles] = useState<Record<PpdPhotoKey, File[]>>(() => emptyPpdPhotoFiles());
  const [ppdPhotoErrors, setPpdPhotoErrors] = useState<Record<PpdPhotoKey, string | null>>(() => emptyPpdPhotoErrors());
  const [cp4Drid, setCp4Drid] = useState("");
  const [cp4Serial, setCp4Serial] = useState("");
  const [cp4CameraQuantity, setCp4CameraQuantity] = useState("");
  const [cp4MonitorInstalled, setCp4MonitorInstalled] = useState("");
  const [cp4ClientApproval, setCp4ClientApproval] = useState("");
  const [cp4CustomBracketsNeeded, setCp4CustomBracketsNeeded] = useState("");
  const [cp4CustomBracketNotes, setCp4CustomBracketNotes] = useState("");
  const [cp4AlarmIn1RelayInstalled, setCp4AlarmIn1RelayInstalled] = useState("");
  const [cp4AlarmIn1Description, setCp4AlarmIn1Description] = useState("");
  const [cp4AlarmIn2RelayInstalled, setCp4AlarmIn2RelayInstalled] = useState("");
  const [cp4AlarmIn2Description, setCp4AlarmIn2Description] = useState("");
  const [cp4HubMountingDescription, setCp4HubMountingDescription] = useState("");
  const [cp4MicrophoneMountingDescription, setCp4MicrophoneMountingDescription] = useState("");
  const [cp4RemoteControlMountingDescription, setCp4RemoteControlMountingDescription] = useState("");
  const [cp4GpsSensorMountingDescription, setCp4GpsSensorMountingDescription] = useState("");
  const [cp4RedWireDescription, setCp4RedWireDescription] = useState("");
  const [cp4BlackWireDescription, setCp4BlackWireDescription] = useState("");
  const [cp4WhiteWireDescription, setCp4WhiteWireDescription] = useState("");
  const [cp4MonitorMountingDescription, setCp4MonitorMountingDescription] = useState("");
  const [cp4PowerConverterDescription, setCp4PowerConverterDescription] = useState("");
  const [cp4PhotoFiles, setCp4PhotoFiles] = useState<Record<Cp4PhotoKey, File[]>>(() => emptyCp4PhotoFiles());
  const [cp4PhotoErrors, setCp4PhotoErrors] = useState<Record<Cp4PhotoKey, string | null>>(() => emptyCp4PhotoErrors());
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

  const remoteThumbsForPpdField = (key: PpdPhotoKey): RemoteThumb[] => {
    const uf = ppdUploadFieldFor(key);
    return photoMetadataByField[uf]
      .filter((p) => p.publicUrl?.trim())
      .map((p) => ({
        publicUrl: p.publicUrl.trim(),
        filename: p.filename,
        storagePath: p.storagePath,
        uploadedAt: p.uploadedAt,
      }));
  };

  /** Multi-photo Blaxtair slots (galleries, not single "replace" fields) — everything else stays single. */
  const BLAXTAIR_MULTI_PHOTO_KEYS: PpdPhotoKey[] = ["blaxtairWirePath", "sscWirePath"];

  const getBlaxtairPhotoSlot = (key: BlaxtairPhotoSlotKey): BlaxtairPhotoSlot => {
    const ppdKey = key as PpdPhotoKey;
    const uploadField = ppdUploadFieldFor(ppdKey);
    const mode: "single" | "multi" = BLAXTAIR_MULTI_PHOTO_KEYS.includes(ppdKey) ? "multi" : "single";
    return {
      files: ppdPhotoFiles[ppdKey],
      remoteThumbs: remoteThumbsForPpdField(ppdKey),
      error: ppdPhotoErrors[ppdKey],
      uploadedCount: photoMetadataByField[uploadField].filter((p) => p.publicUrl?.trim()).length,
      persistStatus: photoFieldPersistStatus[uploadField] ?? undefined,
      onUpload: (e) => void applyPpdPhotoUpload(ppdKey, e, mode),
      onRemoveLocal: (file) => removePpdLocalPhoto(ppdKey, file),
      onRemoveRemote: (remote) => void removeUploadedPhotoFromField(uploadField, remote),
    };
  };

  const getSscPhotoSlot = (key: SscPhotoSlotKey): BlaxtairPhotoSlot => getBlaxtairPhotoSlot(key as unknown as BlaxtairPhotoSlotKey);

  const handleSscConfigFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setSscConfigFileUploading(true);
    setSscConfigFileError(null);
    try {
      const projectContext = await resolveProjectContextPayload();
      const dotIndex = file.name.lastIndexOf(".");
      const ext = dotIndex >= 0 ? file.name.slice(dotIndex) : "";
      const slugify = (v: string, fallback: string) => (v.trim().replace(/[^a-zA-Z0-9._-]/g, "_") || fallback);
      const siteSlug = slugify(projectContext.projectName || coreJob.location, "site");
      const unitSlug = slugify(coreJob.unitNumber, "asset");
      const renamedFile = new File([file], `${siteSlug}_${unitSlug}${ext}`, { type: file.type });
      const definition: ProductFileDefinition = {
        key: "ssc_config",
        label: "SSC Speed configuration file",
        category: "configuration",
        required: true,
        multiple: false,
        acceptedExtensions: [],
        acceptedMimeTypes: [],
        includeInReview: true,
        includeInEmail: true,
        productScoped: true,
        displayOrder: 0,
        active: true,
      };
      const uploaded = await uploadProductFile({
        file: renamedFile,
        definition,
        productKey: "SSC_SPEED",
        baseFormId: "speed_ssc",
        companyId: projectContext.companyId,
        projectId: projectContext.projectId,
        customerId: null,
        unitNumber: coreJob.unitNumber,
      });
      await insertProductFileSiteRowTyped({ file: uploaded, submissionId });
      setSscConfigFile(uploaded);
    } catch (err) {
      setSscConfigFileError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSscConfigFileUploading(false);
    }
  };

  const remoteThumbsForCp4Field = (key: Cp4PhotoKey): RemoteThumb[] => {
    const uf = cp4UploadFieldFor(key);
    return photoMetadataByField[uf]
      .filter((p) => p.publicUrl?.trim())
      .map((p) => ({
        publicUrl: p.publicUrl.trim(),
        filename: p.filename,
        storagePath: p.storagePath,
        uploadedAt: p.uploadedAt,
      }));
  };

  const remoteThumbsForLinxupAtField = (key: LinxupAtPhotoKey): RemoteThumb[] => {
    const uf = linxupAtUploadFieldFor(key);
    return photoMetadataByField[uf]
      .filter((p) => p.publicUrl?.trim())
      .map((p) => ({
        publicUrl: p.publicUrl.trim(),
        filename: p.filename,
        storagePath: p.storagePath,
        uploadedAt: p.uploadedAt,
      }));
  };

  const remoteThumbsForLinxupVtField = (key: LinxupVtPhotoKey): RemoteThumb[] => {
    const uf = linxupVtUploadFieldFor(key);
    return photoMetadataByField[uf]
      .filter((p) => p.publicUrl?.trim())
      .map((p) => ({
        publicUrl: p.publicUrl.trim(),
        filename: p.filename,
        storagePath: p.storagePath,
        uploadedAt: p.uploadedAt,
      }));
  };

  const remoteThumbsForLinxupLcField = (key: LinxupLcPhotoKey): RemoteThumb[] => {
    const uf = linxupLcUploadFieldFor(key);
    return photoMetadataByField[uf]
      .filter((p) => p.publicUrl?.trim())
      .map((p) => ({
        publicUrl: p.publicUrl.trim(),
        filename: p.filename,
        storagePath: p.storagePath,
        uploadedAt: p.uploadedAt,
      }));
  };

  const [vacPhotoErrors, setVacPhotoErrors] = useState<VacPhotoErrorsState>(() => emptyVacPhotoErrors());
  const [vehiclePictureFiles, setVehiclePictureFiles] = useState<VehiclePictureFilesState>(() => emptyVehiclePictureFiles());
  const [vehiclePictureUrls, setVehiclePictureUrls] = useState<VehiclePictureUrlsState>(() => emptyVehiclePictureUrls());
  const [vehiclePictureErrors, setVehiclePictureErrors] = useState<VehiclePictureErrorsState>(() => emptyVehiclePictureErrors());
  const vacPhotoUrlsRef = useRef<VacPhotoUrlsState>(emptyVacPhotoUrls());
  const vehiclePictureUrlsRef = useRef<VehiclePictureUrlsState>(emptyVehiclePictureUrls());
  const photoMetadataByFieldRef = useRef<PhotoMetadataByFieldState>(emptyPhotoMetadataByField());
  const defaultContextIdsRef = useRef<DefaultContextIds | null>(null);
  const restoredFromDraftRef = useRef(false);
  /** True after the user edits Installer Name via the form (not programmatic prefill or draft restore). */
  const installerNameUserEditedRef = useRef(false);
  const [reviewHighlights, setReviewHighlights] = useState<Set<string>>(() => new Set());
  const [reviewBlockMessage, setReviewBlockMessage] = useState<string | null>(null);
  const [draftNoticeMessage, setDraftNoticeMessage] = useState<string | null>(null);
  const [draftSaveStage, setDraftSaveStage] = useState<DraftPhotoSaveStage>("idle");
  const [photoFieldPersistStatus, setPhotoFieldPersistStatus] = useState<
    Partial<Record<string, "uploading" | "saved" | "failed">>
  >({});
  const photoFieldPersistStatusRef = useRef<Partial<Record<string, "uploading" | "saved" | "failed">>>({});
  const pendingPhotoUploadsRef = useRef(0);
  const pendingPhotoUploadWaitersRef = useRef<Array<() => void>>([]);
  const lastSaveSucceededRef = useRef(false);
  const [localDeviceSaveError, setLocalDeviceSaveError] = useState<string | null>(null);
  const [offlineProjectDetailsWarning, setOfflineProjectDetailsWarning] = useState<string | null>(null);
  const [autosaveRestorePayload, setAutosaveRestorePayload] = useState<JobCardAutosavePayload | null>(() => {
    if (typeof window === "undefined") return null;
    const hasManualResumeRequest =
      !!window.localStorage.getItem(JOB_CARD_RESUME_DRAFT_PAYLOAD_KEY) ||
      !!window.localStorage.getItem(JOB_CARD_RESUME_DRAFT_ID_KEY) ||
      !!window.localStorage.getItem(INSTALLER_OFFLINE_DRAFT_ID_KEY);
    if (hasManualResumeRequest) return null;
    const companyId = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
    const projectId = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
    return readMatchingAutosave(companyId, projectId);
  });
  const [isOffline, setIsOffline] = useState(false);
  /** IndexedDB offline job card id for this form when resumed from device or after "Save to this device". */
  const offlineDraftIdRef = useRef<string | null>(null);
  /**
   * Set when the user taps Resume on the autosave banner. companyId/projectId match the autosave storage key
   * (including empty strings for the global `jobCard_autosave` bucket) so we clear only that entry after a durable save.
   */
  const autosaveRestoredClearTargetRef = useRef<{ companyId: string; projectId: string } | null>(null);
  /** When true, background autosave must not persist (exit without saving: avoid rewriting immediately after clearing). */
  const autosavePersistSuppressedRef = useRef(false);
  /** Suppress stale save/reject from overlapping "Save to this device" clicks. */
  const saveToDeviceGenerationRef = useRef(0);
  const [exitWithoutSavingOpen, setExitWithoutSavingOpen] = useState(false);
  const autosaveCheckedRef = useRef(false);
  const autosaveRestorePayloadRef = useRef<JobCardAutosavePayload | null>(null);
  const submissionStatusAutosaveRef = useRef(submissionStatus);
  const emailSendStatusAutosaveRef = useRef(emailSendStatus);
  const buildAutosaveBaseRef = useRef(() => ({
    submissionId: "",
    savedAt: "",
    selectedSections: [] as string[],
    data: {} as StoredJobCardDraft["data"],
  }));

  const {
    products: resolvedProducts,
    selectableProducts,
    loading: productsLoading,
  } = useCompanyProducts({
    companyId: selectedCompanyId,
    companyName: selectedCompanyName,
    enabled: companyContextReady,
  });

  const productLookup = useMemo(
    () => buildProductLookupMaps(resolvedProducts),
    [resolvedProducts],
  );

  const resolveEffective = useMemo(
    () => (key: string | null | undefined) =>
      resolveEffectiveSectionKeyWithLookup(key, productLookup),
    [productLookup],
  );

  const selectedIncludeEffective = useMemo(
    () => (sections: readonly string[] | null | undefined, target: string) =>
      selectedSectionsIncludeEffectiveWithLookup(sections, target, productLookup),
    [productLookup],
  );

  const productLabel = useMemo(
    () => (key: string | null | undefined) => getProductLabelWithLookup(key, productLookup),
    [productLookup],
  );

  const hasCompanyProducts = selectableProducts.length > 0;
  const companyOffersLinxUp = useMemo(
    () =>
      selectableProducts.length > 0 &&
      selectableProducts.some((p) => p.profileId === "linxup_install"),
    [selectableProducts],
  );

  /** Normalized primary products for the technician dropdown (DB or registry via resolver). */
  const primaryFormOptions = useMemo((): FormDefinition[] => {
    if (!companyContextReady) return [];
    return getAllowedPrimaryProducts(resolvedProducts).map(toFormDefinitionFromProduct);
  }, [companyContextReady, resolvedProducts]);
  /**
   * Drop a primary that is not assigned to the current company (e.g. after company context changes).
   * Requires company name to be loaded — never treat an unresolved company as allowing all forms.
   */
  const effectivePrimary = useMemo(() => {
    if (!primary || !companyContextReady) return "";
    return selectableProducts.some((p) => p.sectionKey === primary) ? primary : "";
  }, [primary, companyContextReady, selectableProducts]);
  const selectedPrimaryForm: FormDefinition | undefined = useMemo(() => {
    const product = resolvedProducts.find((p) => p.sectionKey === effectivePrimary);
    return product ? toFormDefinitionFromProduct(product) : undefined;
  }, [effectivePrimary, resolvedProducts]);
  /** Company only has LinxUp products — use shared profile before a product is chosen. */
  const companyUsesLinxUpProfile = useMemo(() => {
    return (
      selectableProducts.length > 0 &&
      selectableProducts.every((p) => p.profileId === "linxup_install")
    );
  }, [selectableProducts]);
  /** True when rendering the shared LinxUp field profile. */
  const isLinxUpProfile = companyUsesLinxUpProfile || isLinxUpSectionKey(effectivePrimary);
  const availableAdditional = useMemo(() => {
    return getAllowedAdditionalProducts(resolvedProducts, effectivePrimary).map((p) => p.sectionKey);
  }, [resolvedProducts, effectivePrimary]);
  /** Drop invalid extras without a syncing effect (Blaxtair: never two devices). */
  const selectedAdditional = useMemo(
    () => additional.filter((item) => availableAdditional.includes(item)),
    [additional, availableAdditional],
  );
  const selectedSections = [effectivePrimary, ...selectedAdditional].filter(Boolean);

  const selectedNormalizedProducts = useMemo((): NormalizedProductDefinition[] => {
    return selectedSections
      .map((sk) => resolvedProducts.find((p) => p.sectionKey === sk))
      .filter((p): p is NormalizedProductDefinition => !!p);
  }, [selectedSections, resolvedProducts]);

  const selectedProductsWithFiles = useMemo(
    () => selectedNormalizedProducts.filter((p) => (p.productFileDefinitions?.length ?? 0) > 0),
    [selectedNormalizedProducts],
  );

  const ppdProductsWithFiles = useMemo(
    () =>
      selectedProductsWithFiles.filter(
        (p) => resolveEffective(p.sectionKey) === "PPD",
      ),
    [selectedProductsWithFiles, resolveEffective],
  );

  const nonPpdProductsWithFiles = useMemo(
    () =>
      selectedProductsWithFiles.filter(
        (p) => resolveEffective(p.sectionKey) !== "PPD",
      ),
    [selectedProductsWithFiles, resolveEffective],
  );

  /** Exact shared PPD product (Matrix/Powerfleet) when selected — deprecated ppd.json* mirror only. */
  const sharedPpdProductSelected = useMemo(
    () => selectedNormalizedProducts.some((p) => p.productKey === PPD_PRODUCT_KEY),
    [selectedNormalizedProducts],
  );

  const applyProductFileSlotChange = (slot: ProductFileUploadSlot) => {
    const id = productFileSlotId({
      productKey: slot.productKey,
      fileKey: slot.fileKey,
      deviceInstanceId: slot.deviceInstanceId,
    });
    setProductFileSlots((prev) => ({ ...prev, [id]: slot }));
    // Mirror shared PPD JSON onto deprecated ppd.json* fields for existing email/UI paths.
    if (
      slot.fileKey === PPD_JSON_FILE_KEY &&
      slot.productKey === PPD_PRODUCT_KEY
    ) {
      if (slot.localFiles[0]) {
        setPpdJsonLocalFile(slot.localFiles[0]);
        setPpdJsonFileName(slot.localFiles[0].name);
        setPpdJsonUploadedConfig(null);
      } else if (slot.uploaded[0]) {
        setPpdJsonLocalFile(null);
        setPpdJsonUploadedConfig(ppdJsonConfigFromUploadedProductFile(slot.uploaded[0]));
        setPpdJsonFileName(slot.uploaded[0].originalFileName);
      } else {
        setPpdJsonLocalFile(null);
        setPpdJsonUploadedConfig(null);
        setPpdJsonFileName("");
      }
    }
  };
  const isLinxUpAssetTracker = selectedSections.some(
    (section) => section === LINXUP_ASSET_TRACKER_FORM_ID || isLinxUpAssetTrackerFormId(section),
  );
  const isLinxUpVehicleTracker = selectedSections.some(
    (section) => section === LINXUP_VEHICLE_TRACKER_FORM_ID || isLinxUpVehicleTrackerFormId(section),
  );
  const isLinxUpLinxCam = selectedSections.some(
    (section) => section === LINXUP_LINXCAM_FORM_ID || isLinxUpLinxCamFormId(section),
  );
  const inputClassName =
    "w-full min-h-[52px] px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:focus:border-blue-400 dark:focus:ring-blue-900/40";
  const selectClassName =
    "w-full min-h-[52px] px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-900/40";
  const labelClassName = "block text-gray-900 font-semibold text-base mb-2 dark:text-gray-100";
  const photoPickClassName =
    "flex min-h-[52px] w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-center text-base font-semibold text-gray-900 active:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:active:bg-gray-700";
  const cardClassName =
    "rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6";
  const headerCardClassName =
    "rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:px-5 sm:py-4";
  const btnPrimaryClassName =
    "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 sm:min-w-[220px]";
  const btnSecondaryClassName =
    "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-blue-600 bg-white px-5 py-3.5 text-base font-semibold text-blue-600 shadow-sm hover:bg-blue-50 active:bg-blue-100 sm:min-w-[160px]";
  const btnExitWithoutSaveClassName =
    "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-gray-300 bg-white px-5 py-3.5 text-base font-semibold text-gray-800 shadow-sm hover:bg-gray-50 active:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 sm:min-w-[160px]";
  const checkboxRowClassName =
    "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl border-2 border-gray-100 bg-gray-50/80 px-4 py-3 text-base font-medium text-gray-900 active:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:active:bg-gray-700";
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

  const ppdVehicleVolts = useMemo(
    () => parseVehicleVoltageVolts(vac4DriveType, vac4VehicleVoltage, vac4VehicleVoltageOther),
    [vac4DriveType, vac4VehicleVoltage, vac4VehicleVoltageOther],
  );
  const cp4VehicleVolts = useMemo(
    () => parseVehicleVoltageVolts(vac4DriveType, vac4VehicleVoltage, vac4VehicleVoltageOther),
    [vac4DriveType, vac4VehicleVoltage, vac4VehicleVoltageOther],
  );
  const cp4ShowPowerConverterMounting = cp4VehicleVolts !== null && cp4VehicleVolts > 24;
  const cp4ShowMonitorMounting = cp4MonitorInstalled === "Yes";
  const cp4ShowAlarmIn1 = cp4AlarmIn1RelayInstalled === "Yes";
  const cp4ShowAlarmIn2 = cp4AlarmIn2RelayInstalled === "Yes";
  const ppdShowPowerConverterMounting = ppdVehicleVolts !== null && ppdVehicleVolts > 36;
  const ppdShowAlarmOutConnections = useMemo(
    () => selectedSections.some((s) => hardwareSectionTriggersPpdAlarmOut(s, resolveEffective)),
    [selectedSections, resolveEffective],
  );
  const ppdShowRelaysSpeedControlQuestion = useMemo(
    () => additional.some((s) => isSpeedControlAdditionalHardwareLabel(s, resolveEffective)),
    [additional, resolveEffective],
  );
  const ppdShowBlackAlarmGround = ppdShowRelaysSpeedControlQuestion && ppdRelaysUsedForSpeedControl === "Yes";

  const ppdJsonConfigFormEffective: JobCardPpdJsonConfigForm = useMemo(() => {
    const n = normalizeUppercaseCoreJob(coreJob);
    return {
      make: n.equipmentMake.trim(),
      model: n.equipmentModel.trim(),
      unitNumber: n.unitNumber.trim(),
      notes: "",
    };
  }, [coreJob]);

  const ppdPc = useMemo(() => {
    const out = {} as Record<PpdPhotoKey, number>;
    for (const k of PPD_PHOTO_KEYS) {
      const uf = ppdUploadFieldFor(k);
      out[k] = Math.max(
        ppdPhotoFiles[k].length,
        photoMetadataByField[uf].filter((p) => p.publicUrl?.trim()).length,
      );
    }
    return out;
  }, [ppdPhotoFiles, photoMetadataByField]);

  const ppdPhotoFileNames = useMemo(() => {
    const out = {} as Record<PpdPhotoKey, string[]>;
    for (const k of PPD_PHOTO_KEYS) {
      const uf = ppdUploadFieldFor(k);
      const fromFiles = ppdPhotoFiles[k].map((f) => f.name);
      const fromMeta = photoMetadataByField[uf].filter((p) => p.publicUrl?.trim()).map((p) => p.filename);
      out[k] = fromFiles.length > 0 ? fromFiles : fromMeta;
    }
    return out;
  }, [ppdPhotoFiles, photoMetadataByField]);

  const cp4Pc = useMemo(() => {
    const out = {} as Record<Cp4PhotoKey, number>;
    for (const k of CP4_PHOTO_KEYS) {
      const uf = cp4UploadFieldFor(k);
      out[k] = Math.max(
        cp4PhotoFiles[k].length,
        photoMetadataByField[uf].filter((p) => p.publicUrl?.trim()).length,
      );
    }
    return out;
  }, [cp4PhotoFiles, photoMetadataByField]);

  const cp4PhotoFileNames = useMemo(() => {
    const out = {} as Record<Cp4PhotoKey, string[]>;
    for (const k of CP4_PHOTO_KEYS) {
      const uf = cp4UploadFieldFor(k);
      const fromFiles = cp4PhotoFiles[k].map((f) => f.name);
      const fromMeta = photoMetadataByField[uf].filter((p) => p.publicUrl?.trim()).map((p) => p.filename);
      out[k] = fromFiles.length > 0 ? fromFiles : fromMeta;
    }
    return out;
  }, [cp4PhotoFiles, photoMetadataByField]);

  const linxupAtPc = useMemo(() => {
    const out = {} as Record<LinxupAtPhotoKey, number>;
    for (const k of LINXUP_AT_PHOTO_KEYS) {
      const uf = linxupAtUploadFieldFor(k);
      out[k] = Math.max(
        linxupAtPhotoFiles[k].length,
        photoMetadataByField[uf].filter((p) => p.publicUrl?.trim()).length,
      );
    }
    return out;
  }, [linxupAtPhotoFiles, photoMetadataByField]);

  const linxupAtPhotoFileNames = useMemo(() => {
    const out = {} as Record<LinxupAtPhotoKey, string[]>;
    for (const k of LINXUP_AT_PHOTO_KEYS) {
      const uf = linxupAtUploadFieldFor(k);
      const fromFiles = linxupAtPhotoFiles[k].map((f) => f.name);
      const fromMeta = photoMetadataByField[uf].filter((p) => p.publicUrl?.trim()).map((p) => p.filename);
      out[k] = fromFiles.length > 0 ? fromFiles : fromMeta;
    }
    return out;
  }, [linxupAtPhotoFiles, photoMetadataByField]);

  const linxupVtPc = useMemo(() => {
    const out = {} as Record<LinxupVtPhotoKey, number>;
    for (const k of LINXUP_VT_PHOTO_KEYS) {
      const uf = linxupVtUploadFieldFor(k);
      out[k] = Math.max(
        linxupVtPhotoFiles[k].length,
        photoMetadataByField[uf].filter((p) => p.publicUrl?.trim()).length,
      );
    }
    return out;
  }, [linxupVtPhotoFiles, photoMetadataByField]);

  const linxupVtPhotoFileNames = useMemo(() => {
    const out = {} as Record<LinxupVtPhotoKey, string[]>;
    for (const k of LINXUP_VT_PHOTO_KEYS) {
      const uf = linxupVtUploadFieldFor(k);
      const fromFiles = linxupVtPhotoFiles[k].map((f) => f.name);
      const fromMeta = photoMetadataByField[uf].filter((p) => p.publicUrl?.trim()).map((p) => p.filename);
      out[k] = fromFiles.length > 0 ? fromFiles : fromMeta;
    }
    return out;
  }, [linxupVtPhotoFiles, photoMetadataByField]);

  const linxupLcPc = useMemo(() => {
    const out = {} as Record<LinxupLcPhotoKey, number>;
    for (const k of LINXUP_LC_PHOTO_KEYS) {
      const uf = linxupLcUploadFieldFor(k);
      out[k] = Math.max(
        linxupLcPhotoFiles[k].length,
        photoMetadataByField[uf].filter((p) => p.publicUrl?.trim()).length,
      );
    }
    return out;
  }, [linxupLcPhotoFiles, photoMetadataByField]);

  const linxupLcPhotoFileNames = useMemo(() => {
    const out = {} as Record<LinxupLcPhotoKey, string[]>;
    for (const k of LINXUP_LC_PHOTO_KEYS) {
      const uf = linxupLcUploadFieldFor(k);
      const fromFiles = linxupLcPhotoFiles[k].map((f) => f.name);
      const fromMeta = photoMetadataByField[uf].filter((p) => p.publicUrl?.trim()).map((p) => p.filename);
      out[k] = fromFiles.length > 0 ? fromFiles : fromMeta;
    }
    return out;
  }, [linxupLcPhotoFiles, photoMetadataByField]);

  const ppdCameraSerialsReviewSummary = useMemo(() => {
    const parts = PPD_CAMERA_LOCATION_OPTIONS.filter((o) => ppdCameraLocations.includes(o.key)).map(
      (o) => `${o.label}: ${ppdCameraSerialsByLocation[o.key].trim() || "—"}`,
    );
    return parts.join("; ");
  }, [ppdCameraLocations, ppdCameraSerialsByLocation]);

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

  const describeSupabaseError = (error: unknown): string => {
    if (typeof error === "object" && error !== null) {
      const maybeMessage = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
      const maybeDetails = "details" in error ? String((error as { details?: unknown }).details ?? "") : "";
      const maybeHint = "hint" in error ? String((error as { hint?: unknown }).hint ?? "") : "";
      return [maybeMessage, maybeDetails, maybeHint].map((v) => v.trim()).filter(Boolean).join(" | ");
    }
    if (error instanceof Error) return error.message;
    return String(error || "Unknown Supabase error");
  };

  const logSupabasePostSubmitError = (error: unknown) => {
    const obj = (typeof error === "object" && error !== null ? error : {}) as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const message = typeof obj.message === "string" ? obj.message : "";
    const code = typeof obj.code === "string" ? obj.code : "";
    const details = typeof obj.details === "string" ? obj.details : "";
    const hint = typeof obj.hint === "string" ? obj.hint : "";
    const asJson = (() => {
      try {
        return JSON.stringify(error);
      } catch {
        return "";
      }
    })();
    console.error("Supabase post-submit sync failed:", {
      message,
      code,
      details,
      hint,
      json: asJson,
      raw: error,
    });
  };

  const resolveDefaultContextIds = async (): Promise<DefaultContextIds> => {
    if (defaultContextIdsRef.current) return defaultContextIdsRef.current;

    const { data: companyRow, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("name", DEFAULT_COMPANY_NAME)
      .maybeSingle<{ id: string }>();
    if (companyError) throw companyError;
    if (!companyRow?.id) throw new Error(`Default company not found: ${DEFAULT_COMPANY_NAME}`);

    const { data: projectRow, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("company_id", companyRow.id)
      .eq("project_name", DEFAULT_PROJECT_NAME)
      .maybeSingle<{ id: string }>();
    if (projectError) throw projectError;
    if (!projectRow?.id) throw new Error(`Default project not found: ${DEFAULT_PROJECT_NAME}`);

    const ids = { companyId: companyRow.id, projectId: projectRow.id };
    defaultContextIdsRef.current = ids;
    return ids;
  };

  const resolveSelectedOrDefaultContextIds = async (): Promise<DefaultContextIds> => {
    if (typeof window !== "undefined") {
      const selectedCompanyId = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
      const selectedProjectId = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
      if (selectedCompanyId && selectedProjectId) {
        return { companyId: selectedCompanyId, projectId: selectedProjectId };
      }
    }
    return resolveDefaultContextIds();
  };

  const normalizeRecipientEmails = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return dedupeEmailStrings(
        value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return dedupeEmailStrings(
            parsed
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean),
          );
        }
      } catch {
        // ignore non-JSON string values
      }
    }
    return [];
  };

  const resolveProjectContextPayload = async (): Promise<ProjectContextPayload> => {
    const selected = await resolveSelectedOrDefaultContextIds();
    let projectName = "";
    let projectRecipientEmails: string[] = [];

    if (typeof window !== "undefined" && !window.navigator.onLine) {
      const companyId = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
      const projectId = selected.projectId;
      if (companyId && projectId) {
        try {
          const snap = await getBestStarterSnapshotForOffline();
          const list = snap?.projectsByCompanyId[companyId] || [];
          const row = list.find((p) => p.id === projectId);
          if (row) {
            projectName = row.project_name?.trim() || "";
          }
        } catch {
          // offline: keep empty projectName
        }
      }
      return {
        companyId: selected.companyId,
        projectId: selected.projectId,
        projectName,
        projectRecipientEmails: [],
      };
    }

    try {
      const { data, error } = await supabase
        .from("projects")
        .select("id, company_id, project_name, external_recipient_emails")
        .eq("id", selected.projectId)
        .maybeSingle<ProjectRecipientsRow>();
      if (!error && data) {
        projectName = data.project_name?.trim() || "";
        projectRecipientEmails = normalizeRecipientEmails(data.external_recipient_emails);
      }
    } catch {
      // ignore project lookup errors; fall back to IDs only
    }

    return {
      companyId: selected.companyId,
      projectId: selected.projectId,
      projectName,
      projectRecipientEmails,
    };
  };

  const requiredCoreValues = isLinxUpProfile
    ? [coreJob.customer, coreJob.location, coreJob.installerName]
    : [coreJob.customer, coreJob.location, coreJob.workOrder, coreJob.serviceAppointment, coreJob.installerName];
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
      : requiredCoreFilledCount === requiredCoreValues.length
        ? "Complete"
        : "In Progress";

  const hardwareSectionStatus: SectionStepStatus =
    !effectivePrimary
      ? "Not Started"
      : hasAdditional === "Yes" || hasAdditional === "No"
        ? "Complete"
        : "In Progress";
  const isVehicleInfoComplete = isLinxUpProfile
    ? coreJob.equipmentMake.trim().length > 0 &&
      coreJob.equipmentModel.trim().length > 0 &&
      coreJob.equipmentSerial.trim().length > 0 &&
      coreJob.unitNumber.trim().length > 0 &&
      linxupVehicleType.trim().length > 0 &&
      linxupHoursMiles.trim().length > 0
    : coreJob.equipmentMake.trim().length > 0 &&
      coreJob.equipmentModel.trim().length > 0 &&
      coreJob.equipmentSerial.trim().length > 0 &&
      coreJob.unitNumber.trim().length > 0 &&
      vac4VehicleType.trim().length > 0 &&
      vac4DriveType.trim().length > 0 &&
      (vac4VehicleType !== "Other" || vac4OtherVehicleType.trim().length > 0) &&
      (vac4DriveType !== "Electric" ||
        (vac4VehicleVoltage.trim().length > 0 && (vac4VehicleVoltage !== "Other" || vac4VehicleVoltageOther.trim().length > 0)));
  const hasAnsweredAdditionalHardwareQuestion =
    (hasAdditional === "Yes" || hasAdditional === "No") &&
    (!isLinxUpProfile || (!!effectivePrimary && isVehicleInfoComplete));

  const hardwareStatusSections = [...new Set(selectedSections)];

  const vac4PhotoIssueKeys = useMemo(() => new Set(VAC_PHOTO_KEYS.map((key) => `photo-${key}`)), []);

  const collectReviewValidationIssues = (): string[] => {
    const issues: string[] = [];

    if (!companyContextReady || !selectedCompanyName) {
      issues.push("hw-primary");
      return issues;
    }
    if (!hasCompanyProducts) {
      issues.push("hw-primary");
      return issues;
    }

    if (isLinxUpProfile) {
      if (!effectivePrimary || !selectableProducts.some((p) => p.sectionKey === effectivePrimary)) {
        issues.push("hw-primary");
      }
      if (hasAdditional !== "Yes" && hasAdditional !== "No") issues.push("hw-hasAdditional");
      if (!areAdditionalProductsAllowed(resolvedProducts, effectivePrimary, selectedAdditional)) {
        issues.push("hw-hasAdditional");
      }
      if (!coreJob.customer.trim()) issues.push("core-customer");
      if (!coreJob.location.trim()) issues.push("core-location");
      if (!coreJob.installerName.trim()) issues.push("core-installerName");
      if (coreJob.contactEmail?.trim() && !coreJob.contactEmail.includes("@")) issues.push("core-contactEmail");
      if (!coreJob.equipmentMake.trim()) issues.push("vehicle-equipmentMake");
      if (!coreJob.equipmentModel.trim()) issues.push("vehicle-equipmentModel");
      if (!coreJob.equipmentSerial.trim()) issues.push("vehicle-equipmentSerial");
      if (!coreJob.unitNumber.trim()) issues.push("vehicle-unitNumber");
      if (!linxupVehicleType.trim()) issues.push("linxup-vehicleType");
      if (!linxupHoursMiles.trim()) issues.push("linxup-hoursMiles");
      if (vehiclePictureCounts.vehicleFront < 1) issues.push("photo-vehicleFront");
      if (vehiclePictureCounts.vehicleRear < 1) issues.push("photo-vehicleRear");
      if (isLinxUpVehicleTracker) {
        if (linxupVtPc.vehicleTrackerTag < 1) issues.push("photo-linxup-vt-vehicleTrackerTag");
        if (linxupVtObdPortConnected !== "Yes" && linxupVtObdPortConnected !== "No") {
          issues.push("linxup-vt-obdPortConnected");
        }
        if (linxupVtObdPortConnected === "Yes") {
          if (linxupVtPc.installation < 1) issues.push("photo-linxup-vt-installation");
          if (!linxupVtInstallationNotes.trim()) issues.push("linxup-vt-installationNotes");
        } else if (linxupVtObdPortConnected === "No") {
          if (!linxupVtPowerConnectionDescription.trim()) issues.push("linxup-vt-powerConnectionDescription");
          if (linxupVtPc.powerConnection < 1) issues.push("photo-linxup-vt-powerConnection");
          if (!linxupVtGroundConnectionDescription.trim()) issues.push("linxup-vt-groundConnectionDescription");
          if (linxupVtPc.groundConnection < 1) issues.push("photo-linxup-vt-groundConnection");
          if (!linxupVtIgnitionConnectionDescription.trim()) issues.push("linxup-vt-ignitionConnectionDescription");
          if (linxupVtPc.ignitionConnection < 1) issues.push("photo-linxup-vt-ignitionConnection");
          if (linxupVtPc.finalInstall < 1) issues.push("photo-linxup-vt-finalInstall");
          if (!linxupVtInstallationNotes.trim()) issues.push("linxup-vt-installationNotes");
        }
      }
      if (isLinxUpLinxCam) {
        if (linxupLcPc.linxCamTag < 1) issues.push("photo-linxup-lc-linxCamTag");
        if (linxupLcObdPortConnected !== "Yes" && linxupLcObdPortConnected !== "No") {
          issues.push("linxup-lc-obdPortConnected");
        }
        if (linxupLcObdPortConnected === "Yes") {
          if (linxupLcPc.installation < 1) issues.push("photo-linxup-lc-installation");
        } else if (linxupLcObdPortConnected === "No") {
          if (!linxupLcPowerConnectionDescription.trim()) issues.push("linxup-lc-powerConnectionDescription");
          if (linxupLcPc.powerConnection < 1) issues.push("photo-linxup-lc-powerConnection");
          if (!linxupLcGroundConnectionDescription.trim()) issues.push("linxup-lc-groundConnectionDescription");
          if (linxupLcPc.groundConnection < 1) issues.push("photo-linxup-lc-groundConnection");
          if (!linxupLcIgnitionConnectionDescription.trim()) issues.push("linxup-lc-ignitionConnectionDescription");
          if (linxupLcPc.ignitionConnection < 1) issues.push("photo-linxup-lc-ignitionConnection");
          if (linxupLcPc.finalInstall < 1) issues.push("photo-linxup-lc-finalInstall");
          if (!linxupLcInstallationNotes.trim()) issues.push("linxup-lc-installationNotes");
        }
      }
      if (isLinxUpAssetTracker) {
        if (linxupAtPc.assetTrackerTag < 1) issues.push("photo-linxup-at-assetTrackerTag");
        if (!linxupPowerConnectionDescription.trim()) issues.push("linxup-at-powerConnectionDescription");
        if (linxupAtPc.powerConnection < 1) issues.push("photo-linxup-at-powerConnection");
        if (!linxupGroundConnectionDescription.trim()) issues.push("linxup-at-groundConnectionDescription");
        if (linxupAtPc.groundConnection < 1) issues.push("photo-linxup-at-groundConnection");
        if (!linxupIgnitionConnectionDescription.trim()) issues.push("linxup-at-ignitionConnectionDescription");
        if (linxupAtPc.ignitionConnection < 1) issues.push("photo-linxup-at-ignitionConnection");
        if (linxupAtPc.finalInstall < 1) issues.push("photo-linxup-at-finalInstall");
      }
      return issues;
    }

    if (!effectivePrimary || !selectableProducts.some((p) => p.sectionKey === effectivePrimary)) {
      issues.push("hw-primary");
    }
    if (!areAdditionalProductsAllowed(resolvedProducts, effectivePrimary, selectedAdditional)) {
      issues.push("hw-hasAdditional");
    }

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
    if (vehiclePictureCounts.vehicleRear < 1) issues.push("photo-vehicleRear");
    if (!coreJob.installerName.trim()) issues.push("core-installerName");
    if (hasAdditional !== "Yes" && hasAdditional !== "No") issues.push("hw-hasAdditional");

    if (selectedSections.includes("VAC4")) {
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
      if (!sensorHubInstalled.trim()) issues.push("vac4-sensorHubInstalled");
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
    }

    if (selectedSections.includes("blaxtair_ahd")) {
      const hasBlaxtairPhoto = (field: PpdPhotoKey) =>
        photoMetadataByField[ppdUploadFieldFor(field)].some((p) => p.publicUrl?.trim());
      if (!blaxtairSystem || !blaxtairSystem.plannedCameraCount) {
        issues.push("blaxtair-equipment");
      } else {
        const CAMERA_WIRE_KEYS: Array<{ key: string; suffix: string }> = [
          { key: "ground", suffix: "Ground" },
          { key: "out1", suffix: "Out1" },
          { key: "out2", suffix: "Out2" },
          { key: "out3", suffix: "Out3" },
          { key: "in1", suffix: "In1" },
        ];
        const MONITOR_WIRE_KEYS: Array<{ key: string; suffix: string; required: boolean }> = [
          { key: "ground", suffix: "Ground", required: true },
          { key: "power", suffix: "Power", required: true },
          { key: "ignition", suffix: "Ignition", required: true },
          { key: "trigger1", suffix: "Trigger1", required: false },
          { key: "trigger2", suffix: "Trigger2", required: false },
          { key: "trigger3", suffix: "Trigger3", required: false },
          { key: "trigger4", suffix: "Trigger4", required: false },
          { key: "trigger5", suffix: "Trigger5", required: false },
        ];
        for (const c of blaxtairSystem.components) {
          const key = `blaxtair-${c.id}`;
          const isMonitor = c.componentType === "monitor";
          const cameraNum = isMonitor ? null : c.slotKey.slice("camera_".length);
          const photoField = isMonitor ? "blaxtairMonitor" : (`blaxtairCamera${cameraNum}` as PpdPhotoKey);
          const hasPhoto = hasBlaxtairPhoto(photoField);
          if (!c.technicianConfirmed || !hasPhoto) issues.push(key);
          if (isMonitor) {
            if (!hasBlaxtairPhoto("blaxtairMonitorMounting")) issues.push(`${key}-mountingPhoto`);
          } else {
            if (!hasBlaxtairPhoto(`blaxtairCamera${cameraNum}Mounting` as PpdPhotoKey)) issues.push(`${key}-installPhoto`);
          }
          const wireKeys = isMonitor ? MONITOR_WIRE_KEYS : CAMERA_WIRE_KEYS.map((w) => ({ ...w, required: false }));
          for (const wireDef of wireKeys) {
            const lead = c.wireLeads?.[wireDef.key];
            const used = wireDef.required || lead?.used;
            if (!used) continue;
            const wireField = isMonitor
              ? (`blaxtairMonitorWire${wireDef.suffix}` as PpdPhotoKey)
              : (`blaxtairCamera${cameraNum}Wire${wireDef.suffix}` as PpdPhotoKey);
            if (!hasBlaxtairPhoto(wireField) || !lead?.description.trim()) {
              issues.push(`${key}-wire-${wireDef.key}`);
            }
          }
        }
        const alarm = blaxtairSystem.externalAlarm;
        if (alarm?.installed) {
          if (!hasBlaxtairPhoto("blaxtairAlarmMounting")) issues.push("blaxtair-alarm-mountingPhoto");
          if (alarm.triggerComponentIds.length === 0) issues.push("blaxtair-alarm-cameras");
        }
        if (!hasBlaxtairPhoto("blaxtairWirePath")) issues.push(ppdPhotoIssueKey("blaxtairWirePath"));
      }
    }

    if (selectedSections.includes("blaxtair_ssc_speed")) {
      const hasSscPhoto = (field: PpdPhotoKey) => photoMetadataByField[ppdUploadFieldFor(field)].some((p) => p.publicUrl?.trim());
      if (!hasSscPhoto("sscLabel")) issues.push("ssc-label");
      if (!hasSscPhoto("sscPower")) issues.push("ssc-power");
      if (!sscFields.powerDescription.trim()) issues.push("ssc-power-description");
      if (!hasSscPhoto("sscGround")) issues.push("ssc-ground");
      if (!sscFields.groundDescription.trim()) issues.push("ssc-ground-description");
      if (!hasSscPhoto("sscIgnition")) issues.push("ssc-ignition");
      if (!sscFields.ignitionDescription.trim()) issues.push("ssc-ignition-description");
      if (sscFields.connectionType !== "CAN" && sscFields.connectionType !== "Hardwire") {
        issues.push("ssc-connectionType");
      } else if (sscFields.connectionType === "CAN") {
        if (!hasSscPhoto("sscCanConnection")) issues.push("ssc-canConnection");
      } else {
        if (!hasSscPhoto("sscSpeedSignal")) issues.push("ssc-speedSignal");
        if (!sscFields.speedSignalDescription.trim()) issues.push("ssc-speedSignal-description");
        if (sscFields.hasDirectionSignal) {
          if (!hasSscPhoto("sscDirection")) issues.push("ssc-direction");
          if (!sscFields.directionDescription.trim()) issues.push("ssc-direction-description");
        }
      }
      if (!hasSscPhoto("sscMounting")) issues.push("ssc-mounting");
      if (!hasSscPhoto("sscWirePath")) issues.push("ssc-wirePath");
      // Config file upload is temporarily hidden from the SSC Speed section — see
      // SSC_CONFIG_FILE_UPLOAD_ENABLED in BlaxtairSscSpeedSection.tsx. Do not require it
      // while the field is hidden, or the form becomes impossible to submit.
    }

    if (selectedIncludeEffective(selectedSections, "PPD") && !selectedSections.includes("blaxtair_ahd")) {
      if (!ppdHubSerial.trim()) issues.push("ppd-hubSerial");
      for (const loc of ppdCameraLocations) {
        if (!ppdCameraSerialsByLocation[loc]?.trim()) {
          issues.push(`ppd-cameraSerial-${loc}`);
        }
      }
      if (!ppdClientApproval.trim()) issues.push("ppd-clientApproval");
      if (ppdMonitorInstalled !== "Yes" && ppdMonitorInstalled !== "No") issues.push("ppd-monitorInstalled");
      if (ppdCustomBracketsNeeded !== "Yes" && ppdCustomBracketsNeeded !== "No") issues.push("ppd-customBracketsNeeded");
      if (ppdCustomBracketsNeeded === "Yes" && !ppdCustomBracketNotes.trim()) issues.push("ppd-customBracketNotes");
      if (ppdShowRelaysSpeedControlQuestion) {
        if (ppdRelaysUsedForSpeedControl !== "Yes" && ppdRelaysUsedForSpeedControl !== "No") {
          issues.push("ppd-relaysSpeedControl");
        }
      }

      if (ppdMonitorInstalled === "Yes" && ppdPc.monitorInstalled < 1) {
        issues.push("photo-ppd-monitorInstalled");
      }

      if (ppdPc.cameraHubMounting < 1) issues.push("photo-ppd-cameraHubMounting");
      if (ppdPc.wirePath < PPD_WIRE_PATH_MIN_PHOTOS) issues.push("photo-ppd-wirePath");

      if (ppdPc.redBattery < 1) issues.push("photo-ppd-redBattery");
      if (!ppdRedWireDescription.trim()) issues.push("ppd-redWireDescription");
      if (ppdPc.blackBattery < 1) issues.push("photo-ppd-blackBattery");
      if (!ppdBlackWireDescription.trim()) issues.push("ppd-blackWireDescription");
      if (ppdPc.yellowIgnition < 1) issues.push("photo-ppd-yellowIgnition");
      if (!ppdYellowWireDescription.trim()) issues.push("ppd-yellowWireDescription");
      if (ppdPc.greyMotion < 1) issues.push("photo-ppd-greyMotion");
      if (!ppdGreyWireDescription.trim()) issues.push("ppd-greyWireDescription");
      if (ppdPc.blueDirection < 1) issues.push("photo-ppd-blueDirection");
      if (!ppdBlueWireDescription.trim()) issues.push("ppd-blueWireDescription");

      if (ppdShowPowerConverterMounting) {
        if (ppdPc.powerConverter < 1) issues.push("photo-ppd-powerConverter");
        if (!ppdPowerConverterDescription.trim()) issues.push("ppd-powerConverterDescription");
      }
      if (ppdShowAlarmOutConnections) {
        if (ppdPc.redAlarmOut < 1) issues.push("photo-ppd-redAlarmOut");
        if (!ppdRedAlarmOutDescription.trim()) issues.push("ppd-redAlarmOutDescription");
        if (ppdPc.yellowAlarmOut < 1) issues.push("photo-ppd-yellowAlarmOut");
        if (!ppdYellowAlarmOutDescription.trim()) issues.push("ppd-yellowAlarmOutDescription");
      }
      if (ppdShowBlackAlarmGround) {
        if (ppdPc.blackAlarmGround < 1) issues.push("photo-ppd-blackAlarmGround");
        if (!ppdBlackAlarmGroundDescription.trim()) issues.push("ppd-blackAlarmGroundDescription");
      }
    }

    if (selectedSections.includes("CP4")) {
      const cameraQty = Number.parseInt(cp4CameraQuantity, 10);
      if (!cp4Drid.trim()) issues.push("cp4-drid");
      if (!cp4Serial.trim()) issues.push("cp4-serial");
      if (!Number.isFinite(cameraQty) || cameraQty < 1 || cameraQty > 4) issues.push("cp4-cameraQuantity");
      if (cp4MonitorInstalled !== "Yes" && cp4MonitorInstalled !== "No") issues.push("cp4-monitorInstalled");
      if (!cp4ClientApproval.trim()) issues.push("cp4-clientApproval");
      if (cp4CustomBracketsNeeded !== "Yes" && cp4CustomBracketsNeeded !== "No") issues.push("cp4-customBracketsNeeded");
      if (cp4CustomBracketsNeeded === "Yes" && !cp4CustomBracketNotes.trim()) issues.push("cp4-customBracketNotes");

      if (cp4Pc.cameraMounting < 1) issues.push("photo-cp4-cameraMounting");
      if (cp4Pc.wirePath < 1) issues.push("photo-cp4-wirePath");
      if (cp4Pc.hubMounting < 1) issues.push("photo-cp4-hubMounting");
      if (!cp4HubMountingDescription.trim()) issues.push("cp4-hubMountingDescription");
      if (cp4Pc.microphoneMounting < 1) issues.push("photo-cp4-microphoneMounting");
      if (!cp4MicrophoneMountingDescription.trim()) issues.push("cp4-microphoneMountingDescription");
      if (cp4Pc.remoteControlMounting < 1) issues.push("photo-cp4-remoteControlMounting");
      if (!cp4RemoteControlMountingDescription.trim()) issues.push("cp4-remoteControlMountingDescription");
      if (cp4Pc.gpsSensorMounting < 1) issues.push("photo-cp4-gpsSensorMounting");
      if (!cp4GpsSensorMountingDescription.trim()) issues.push("cp4-gpsSensorMountingDescription");
      if (cp4Pc.redBattery < 1) issues.push("photo-cp4-redBattery");
      if (!cp4RedWireDescription.trim()) issues.push("cp4-redWireDescription");
      if (cp4Pc.blackBattery < 1) issues.push("photo-cp4-blackBattery");
      if (!cp4BlackWireDescription.trim()) issues.push("cp4-blackWireDescription");
      if (cp4Pc.whiteIgnition < 1) issues.push("photo-cp4-whiteIgnition");
      if (!cp4WhiteWireDescription.trim()) issues.push("cp4-whiteWireDescription");

      if (cp4ShowMonitorMounting) {
        if (cp4Pc.monitorMounting < 1) issues.push("photo-cp4-monitorMounting");
        if (!cp4MonitorMountingDescription.trim()) issues.push("cp4-monitorMountingDescription");
      }
      if (cp4ShowPowerConverterMounting) {
        if (cp4Pc.powerConverter < 1) issues.push("photo-cp4-powerConverter");
        if (!cp4PowerConverterDescription.trim()) issues.push("cp4-powerConverterDescription");
      }
      if (cp4ShowAlarmIn1) {
        if (cp4Pc.alarmIn1 < 1) issues.push("photo-cp4-alarmIn1");
        if (!cp4AlarmIn1Description.trim()) issues.push("cp4-alarmIn1Description");
      }
      if (cp4ShowAlarmIn2) {
        if (cp4Pc.alarmIn2 < 1) issues.push("photo-cp4-alarmIn2");
        if (!cp4AlarmIn2Description.trim()) issues.push("cp4-alarmIn2Description");
      }
    }

    for (const fileIssue of collectRequiredProductFileIssues({
      products: selectedNormalizedProducts,
      slots: productFileSlots,
      isOffline,
    })) {
      if (fileIssue.fileKey === PPD_JSON_FILE_KEY) {
        issues.push(isOffline ? "ppd-jsonOffline" : "ppd-jsonFile");
      } else {
        issues.push(fileIssue.code);
      }
    }

    return issues;
  };

  const vac4SectionStatus: SectionStepStatus = useMemo(() => {
    if (!selectedSections.includes("VAC4")) return "Not Started";

    const vac4ValuesStarted = [
      vac4VehicleType,
      vac4OtherVehicleType,
      vac4DriveType,
      vac4VehicleVoltage,
      vac4VehicleVoltageOther,
      vac4ClientApproval,
      vac4HourMeter,
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
    ].some((value) => value.trim().length > 0);
    const vac4PhotosStarted = Object.values(pc).some((count) => count > 0);
    if (!vac4ValuesStarted && !vac4PhotosStarted) return "Not Started";

    const issues = collectReviewValidationIssues();
    const vac4Issues = issues.filter((key) => key.startsWith("vac4-") || vac4PhotoIssueKeys.has(key));
    return vac4Issues.length === 0 ? "Complete" : "In Progress";
  }, [
    selectedSections,
    vac4VehicleType,
    vac4OtherVehicleType,
    vac4DriveType,
    vac4VehicleVoltage,
    vac4VehicleVoltageOther,
    vac4ClientApproval,
    vac4HourMeter,
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
    pc,
    vac4PhotoIssueKeys,
  ]);

  const setCoreField = (key: keyof CoreJobFields, value: string) => {
    if (key === "installerName") {
      installerNameUserEditedRef.current = true;
    }
    const normalizedValue =
      key === "workOrder"
        ? sanitizeWorkOrderInput(value)
        : key === "serviceAppointment"
          ? sanitizeServiceAppointmentInput(value)
          : UPPERCASE_CORE_KEYS.includes(key)
            ? formatUpper(value)
            : value;
    setCoreJob((prev) => ({ ...prev, [key]: normalizedValue }));
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

  const togglePpdCameraLocation = (key: PpdCameraLocationKey) => {
    setPpdCameraLocations((prev) => {
      if (prev.includes(key)) {
        setPpdCameraSerialsByLocation((s) => ({ ...s, [key]: "" }));
        queueMicrotask(() => clearFieldHighlight(`ppd-cameraSerial-${key}`));
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  };

  type PhotoStorageGroup = "vac4" | "vehicle" | "ppd" | "cp4" | "linxup";

  type UploadFailureLog = {
    error: unknown;
    storagePath: string;
    filename: string;
    fieldName: UploadFieldName;
    group: PhotoStorageGroup;
    submissionId: string;
  };

  const logSupabaseUploadIssue = (level: "warn" | "error", failure: UploadFailureLog) => {
    const error = (typeof failure.error === "object" && failure.error !== null ? failure.error : {}) as {
      message?: unknown;
      name?: unknown;
      statusCode?: unknown;
      error?: unknown;
    };
    const payload = {
      message: String(error.message ?? ""),
      name: String(error.name ?? ""),
      statusCode: String(error.statusCode ?? ""),
      error: String(error.error ?? ""),
      json: (() => {
        try {
          return JSON.stringify(failure.error);
        } catch {
          return "";
        }
      })(),
      storagePath: failure.storagePath,
      bucket: PHOTO_BUCKET,
      fieldName: failure.fieldName,
      group: failure.group,
      submissionId: failure.submissionId,
      filename: failure.filename,
    };
    if (level === "warn") console.warn("Supabase upload warning:", payload);
    else console.error("Supabase upload failed:", payload);
  };

  const notifyPendingPhotoUploadsChanged = () => {
    if (pendingPhotoUploadsRef.current > 0) return;
    const waiters = pendingPhotoUploadWaitersRef.current;
    pendingPhotoUploadWaitersRef.current = [];
    for (const resolve of waiters) resolve();
  };

  const waitForPendingPhotoUploads = async () => {
    if (pendingPhotoUploadsRef.current <= 0) return;
    await new Promise<void>((resolve) => {
      pendingPhotoUploadWaitersRef.current.push(resolve);
    });
  };

  const beginPhotoUploadTracking = (fieldName: UploadFieldName) => {
    pendingPhotoUploadsRef.current += 1;
    setPhotoFieldPersistStatus((prev) => {
      const next = { ...prev, [fieldName]: "uploading" as const };
      photoFieldPersistStatusRef.current = next;
      return next;
    });
  };

  const endPhotoUploadTracking = (fieldName: UploadFieldName, ok: boolean) => {
    pendingPhotoUploadsRef.current = Math.max(0, pendingPhotoUploadsRef.current - 1);
    setPhotoFieldPersistStatus((prev) => {
      const next = { ...prev, [fieldName]: ok ? ("saved" as const) : ("failed" as const) };
      photoFieldPersistStatusRef.current = next;
      return next;
    });
    notifyPendingPhotoUploadsChanged();
  };

  const uploadPhotosToStorage = async (group: PhotoStorageGroup, fieldName: UploadFieldName, files: File[]) => {
    beginPhotoUploadTracking(fieldName);
    const uploadedUrls: string[] = [];
    const uploadedPhotos: UploadedPhotoMetadata[] = [];
    const failures: UploadFailureLog[] = [];
    let ok = true;
    try {
      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        // eslint-disable-next-line react-hooks/purity -- unique storage object names (not render)
        const stampedName = `${Date.now()}-${safeName}`;
        const objectPath = `${submissionId}/${group}/${fieldName}/${stampedName}`;
        const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(objectPath, file, {
          upsert: true,
          contentType: file.type || undefined,
        });
        if (uploadError) {
          failures.push({
            error: uploadError,
            storagePath: objectPath,
            filename: file.name,
            submissionId,
            group,
            fieldName,
          });
          ok = false;
          continue;
        }
        const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(objectPath);
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
      return { ok, uploadedUrls, uploadedPhotos, failures };
    } finally {
      endPhotoUploadTracking(fieldName, uploadedPhotos.length > 0);
    }
  };

  const isVacPhotoField = (key: UploadFieldName): key is keyof VacPhotoFileNames => VAC_PHOTO_KEYS.includes(key as keyof VacPhotoFileNames);

  const isPhotoFieldRequiredNow = (field: UploadFieldName): boolean => {
    if (field === "vehicleFront" || field === "vehicleSide" || field === "vehicleRear") return true;
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
    if (!isVehiclePictureField(field)) return;
    const nextLocal = vehiclePictureFiles[field].filter((f) => localFileDedupeKey(f) !== targetKey);
    setVehiclePictureFiles((p) => ({ ...p, [field]: nextLocal }));
    const nextCount = Math.max(nextLocal.length, photoMetadataByFieldRef.current[field].filter((m) => m.publicUrl?.trim()).length);
    updatePhotoFieldHighlight(field, nextCount);
  };

  const syncPpdPhotoHighlightFromCounts = (key: PpdPhotoKey, localLen: number, remoteCount: number) => {
    const photoKey = `photo-ppd-${key}`;
    const total = Math.max(localLen, remoteCount);
    const minPhotos = key === "wirePath" ? PPD_WIRE_PATH_MIN_PHOTOS : 1;
    if (total < minPhotos) {
      setReviewHighlights((prev) => {
        const next = new Set(prev);
        next.add(photoKey);
        return next;
      });
    } else {
      setReviewHighlights((prev) => {
        if (!prev.has(photoKey)) return prev;
        const next = new Set(prev);
        next.delete(photoKey);
        if (next.size === 0) queueMicrotask(() => setReviewBlockMessage(null));
        return next;
      });
    }
  };

  const syncCp4PhotoHighlightFromCounts = (key: Cp4PhotoKey, localLen: number, remoteCount: number) => {
    const photoKey = `photo-cp4-${key}`;
    const total = Math.max(localLen, remoteCount);
    if (total < 1) {
      setReviewHighlights((prev) => {
        const next = new Set(prev);
        next.add(photoKey);
        return next;
      });
    } else {
      setReviewHighlights((prev) => {
        if (!prev.has(photoKey)) return prev;
        const next = new Set(prev);
        next.delete(photoKey);
        if (next.size === 0) queueMicrotask(() => setReviewBlockMessage(null));
        return next;
      });
    }
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
    } else if (isVehiclePictureField(field)) {
      setVehiclePictureUrlsSafe((p) => ({ ...p, [field]: nextUrls }));
    }

    const localCount = isVacPhotoField(field)
      ? vacPhotoFiles[field].length
      : isVehiclePictureField(field)
        ? vehiclePictureFiles[field].length
        : isPpdUploadField(field)
          ? ppdPhotoFiles[ppdKeyFromUploadField(field)].length
          : isCp4UploadField(field)
            ? cp4PhotoFiles[cp4KeyFromUploadField(field)].length
            : isLinxupAtUploadField(field)
              ? linxupAtPhotoFiles[linxupAtKeyFromUploadField(field)].length
              : isLinxupVtUploadField(field)
                ? linxupVtPhotoFiles[linxupVtKeyFromUploadField(field)].length
                : isLinxupLcUploadField(field)
                  ? linxupLcPhotoFiles[linxupLcKeyFromUploadField(field)].length
                  : 0;

    if (isVacPhotoField(field)) {
      updatePhotoFieldHighlight(field, Math.max(localCount, nextUrls.length));
    } else if (isVehiclePictureField(field)) {
      updatePhotoFieldHighlight(field, Math.max(localCount, nextUrls.length));
    } else if (isPpdUploadField(field)) {
      syncPpdPhotoHighlightFromCounts(ppdKeyFromUploadField(field), localCount, nextUrls.length);
    } else if (isCp4UploadField(field)) {
      syncCp4PhotoHighlightFromCounts(cp4KeyFromUploadField(field), localCount, nextUrls.length);
    } else if (isLinxupAtUploadField(field)) {
      syncLinxupAtPhotoHighlightFromCounts(linxupAtKeyFromUploadField(field), localCount, nextUrls.length);
    } else if (isLinxupVtUploadField(field)) {
      syncLinxupVtPhotoHighlightFromCounts(linxupVtKeyFromUploadField(field), localCount, nextUrls.length);
    } else if (isLinxupLcUploadField(field)) {
      syncLinxupLcPhotoHighlightFromCounts(linxupLcKeyFromUploadField(field), localCount, nextUrls.length);
    }

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
      if (nextMeta.length === 0) {
        uploadResult.failures.forEach((f) => logSupabaseUploadIssue("error", f));
        setVacPhotoUrlsSafe((p) => ({ ...p, [key]: prevMeta.map((m) => m.publicUrl).filter(Boolean) }));
        setPhotoMetadataByFieldSafe((p) => ({ ...p, [key]: prevMeta }));
        setVacPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_UPLOAD_FAILED }));
        clearFieldHighlight(`photo-${String(key)}`);
        return;
      }
      if (!uploadResult.ok && uploadResult.failures.length > 0) {
        uploadResult.failures.forEach((f) => logSupabaseUploadIssue("warn", f));
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
    if (!uploadResult.ok && uploadResult.failures.length > 0) {
      const level: "warn" | "error" = nextMeta.length > 0 ? "warn" : "error";
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue(level, f));
    }
    setVacPhotoUrlsSafe((p) => ({ ...p, [key]: nextMeta.map((m) => m.publicUrl).filter(Boolean) }));
    setPhotoMetadataByFieldSafe((p) => ({ ...p, [key]: nextMeta }));
    setVacPhotoErrors((er) => ({ ...er, [key]: nextMeta.length > 0 ? null : uploadResult.ok ? null : UPLOAD_ERR_UPLOAD_FAILED }));
    if (uploadResult.ok) {
      setVacPhotoFiles((p) => ({ ...p, [key]: [] }));
    } else if (nextMeta.length > 0) {
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
    if (nextMeta.length === 0) {
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue("error", f));
      setVehiclePictureUrlsSafe((p) => ({ ...p, [key]: prevMeta.map((m) => m.publicUrl).filter(Boolean) }));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [key]: prevMeta }));
      setVehiclePictureErrors((er) => ({ ...er, [key]: UPLOAD_ERR_UPLOAD_FAILED }));
      clearFieldHighlight(`photo-${key}`);
      return;
    }
    if (!uploadResult.ok && uploadResult.failures.length > 0) {
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue("warn", f));
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

  const ppdPhotoIssueKey = (key: PpdPhotoKey) => `photo-ppd-${key}`;

  const removePpdLocalPhoto = (key: PpdPhotoKey, targetFile: File) => {
    const targetKey = localFileDedupeKey(targetFile);
    const uploadField = ppdUploadFieldFor(key);
    setPpdPhotoFiles((p) => {
      const nextList = p[key].filter((f) => localFileDedupeKey(f) !== targetKey);
      queueMicrotask(() => {
        const metaCount = photoMetadataByFieldRef.current[uploadField].filter((m) => m.publicUrl?.trim()).length;
        syncPpdPhotoHighlightFromCounts(key, nextList.length, metaCount);
      });
      return { ...p, [key]: nextList };
    });
  };

  const clearPpdPhotoSlotAndStorage = (key: PpdPhotoKey) => {
    const uploadField = ppdUploadFieldFor(key);
    const prev = [...photoMetadataByFieldRef.current[uploadField]];
    setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: [] }));
    setPpdPhotoFiles((pf) => ({ ...pf, [key]: [] }));
    for (const m of prev) {
      if (m.storagePath) void deleteJobCardPhotoObject(m.storagePath);
    }
    syncPpdPhotoHighlightFromCounts(key, 0, 0);
  };

  const applyPpdPhotoUpload = async (key: PpdPhotoKey, e: ChangeEvent<HTMLInputElement>, mode: "single" | "multi") => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    const uploadField = ppdUploadFieldFor(key);
    const photoKey = `photo-ppd-${key}`;

    const hasInvalidType = picked.some((f) => {
      const mime = f.type.toLowerCase();
      const name = f.name.toLowerCase();
      const allowedMime = mime === "image/jpeg" || mime === "image/png";
      const allowedExt = name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
      return !(allowedMime || allowedExt);
    });
    if (hasInvalidType && picked.length > 0) {
      setPpdPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_TYPE }));
      return;
    }

    const overSize = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (overSize) {
      setPpdPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_SIZE }));
      return;
    }

    if (picked.length === 0) {
      const prevMeta = [...photoMetadataByFieldRef.current[uploadField]];
      setPpdPhotoFiles((p) => ({ ...p, [key]: [] }));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: [] }));
      for (const m of prevMeta) {
        if (m.storagePath) void deleteJobCardPhotoObject(m.storagePath);
      }
      setPpdPhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(photoKey);
      syncPpdPhotoHighlightFromCounts(key, 0, 0);
      return;
    }

    if (mode === "single") {
      const prevMeta = [...photoMetadataByFieldRef.current[uploadField]];
      setPpdPhotoFiles((p) => ({ ...p, [key]: [picked[0]] }));
      const uploadResult = await uploadPhotosToStorage("ppd", uploadField, [picked[0]]);
      const nextMeta = dedupeUploadedPhotoMeta(uploadResult.uploadedPhotos);
      if (nextMeta.length === 0) {
        uploadResult.failures.forEach((f) => logSupabaseUploadIssue("error", f));
        setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: prevMeta }));
        setPpdPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_UPLOAD_FAILED }));
        clearFieldHighlight(photoKey);
        syncPpdPhotoHighlightFromCounts(key, 1, prevMeta.filter((m) => m.publicUrl?.trim()).length);
        return;
      }
      if (!uploadResult.ok && uploadResult.failures.length > 0) {
        uploadResult.failures.forEach((f) => logSupabaseUploadIssue("warn", f));
      }
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: nextMeta }));
      setPpdPhotoFiles((p) => ({ ...p, [key]: [] }));
      for (const m of prevMeta) {
        if (m.storagePath && !nextMeta.some((n) => n.storagePath === m.storagePath)) {
          void deleteJobCardPhotoObject(m.storagePath);
        }
      }
      setPpdPhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(photoKey);
      syncPpdPhotoHighlightFromCounts(key, 0, nextMeta.filter((m) => m.publicUrl?.trim()).length);
      return;
    }

    const currentCount = Math.max(
      ppdPhotoFiles[key].length,
      photoMetadataByFieldRef.current[uploadField].filter((p) => p.publicUrl?.trim()).length,
    );
    if (currentCount + picked.length > MAX_PHOTOS_PER_FIELD) {
      setPpdPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_MAX_COUNT }));
      return;
    }

    const merged = [...ppdPhotoFiles[key], ...picked];
    setPpdPhotoFiles((p) => ({ ...p, [key]: merged }));
    const uploadResult = await uploadPhotosToStorage("ppd", uploadField, picked);
    const nextMeta = dedupeUploadedPhotoMeta([...photoMetadataByFieldRef.current[uploadField], ...uploadResult.uploadedPhotos]).slice(
      0,
      MAX_PHOTOS_PER_FIELD,
    );
    if (!uploadResult.ok && uploadResult.failures.length > 0) {
      const level: "warn" | "error" = nextMeta.length > 0 ? "warn" : "error";
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue(level, f));
    }
    setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: nextMeta }));
    setPpdPhotoErrors((er) => ({ ...er, [key]: nextMeta.length > 0 ? null : uploadResult.ok ? null : UPLOAD_ERR_UPLOAD_FAILED }));
    if (uploadResult.ok || nextMeta.length > 0) {
      setPpdPhotoFiles((p) => ({ ...p, [key]: [] }));
    }
    clearFieldHighlight(photoKey);
    syncPpdPhotoHighlightFromCounts(key, 0, nextMeta.filter((m) => m.publicUrl?.trim()).length);
  };

  const cp4PhotoIssueKey = (key: Cp4PhotoKey) => `photo-cp4-${key}`;

  const removeCp4LocalPhoto = (key: Cp4PhotoKey, targetFile: File) => {
    const targetKey = localFileDedupeKey(targetFile);
    const uploadField = cp4UploadFieldFor(key);
    setCp4PhotoFiles((p) => {
      const nextList = p[key].filter((f) => localFileDedupeKey(f) !== targetKey);
      queueMicrotask(() => {
        const metaCount = photoMetadataByFieldRef.current[uploadField].filter((m) => m.publicUrl?.trim()).length;
        syncCp4PhotoHighlightFromCounts(key, nextList.length, metaCount);
      });
      return { ...p, [key]: nextList };
    });
  };

  const clearCp4PhotoSlotAndStorage = (key: Cp4PhotoKey) => {
    const uploadField = cp4UploadFieldFor(key);
    const prev = [...photoMetadataByFieldRef.current[uploadField]];
    setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: [] }));
    setCp4PhotoFiles((pf) => ({ ...pf, [key]: [] }));
    for (const m of prev) {
      if (m.storagePath) void deleteJobCardPhotoObject(m.storagePath);
    }
    syncCp4PhotoHighlightFromCounts(key, 0, 0);
  };

  const applyCp4PhotoUpload = async (key: Cp4PhotoKey, e: ChangeEvent<HTMLInputElement>, mode: "single" | "multi") => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    const uploadField = cp4UploadFieldFor(key);
    const photoKey = `photo-cp4-${key}`;

    const hasInvalidType = picked.some((f) => {
      const mime = f.type.toLowerCase();
      const name = f.name.toLowerCase();
      const allowedMime = mime === "image/jpeg" || mime === "image/png";
      const allowedExt = name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
      return !(allowedMime || allowedExt);
    });
    if (hasInvalidType && picked.length > 0) {
      setCp4PhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_TYPE }));
      return;
    }

    const overSize = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (overSize) {
      setCp4PhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_SIZE }));
      return;
    }

    if (picked.length === 0) {
      const prevMeta = [...photoMetadataByFieldRef.current[uploadField]];
      setCp4PhotoFiles((p) => ({ ...p, [key]: [] }));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: [] }));
      for (const m of prevMeta) {
        if (m.storagePath) void deleteJobCardPhotoObject(m.storagePath);
      }
      setCp4PhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(photoKey);
      syncCp4PhotoHighlightFromCounts(key, 0, 0);
      return;
    }

    if (mode === "single") {
      const prevMeta = [...photoMetadataByFieldRef.current[uploadField]];
      setCp4PhotoFiles((p) => ({ ...p, [key]: [picked[0]] }));
      const uploadResult = await uploadPhotosToStorage("cp4", uploadField, [picked[0]]);
      const nextMeta = dedupeUploadedPhotoMeta(uploadResult.uploadedPhotos);
      if (nextMeta.length === 0) {
        uploadResult.failures.forEach((f) => logSupabaseUploadIssue("error", f));
        setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: prevMeta }));
        setCp4PhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_UPLOAD_FAILED }));
        clearFieldHighlight(photoKey);
        syncCp4PhotoHighlightFromCounts(key, 1, prevMeta.filter((m) => m.publicUrl?.trim()).length);
        return;
      }
      if (!uploadResult.ok && uploadResult.failures.length > 0) {
        uploadResult.failures.forEach((f) => logSupabaseUploadIssue("warn", f));
      }
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: nextMeta }));
      setCp4PhotoFiles((p) => ({ ...p, [key]: [] }));
      for (const m of prevMeta) {
        if (m.storagePath && !nextMeta.some((n) => n.storagePath === m.storagePath)) {
          void deleteJobCardPhotoObject(m.storagePath);
        }
      }
      setCp4PhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(photoKey);
      syncCp4PhotoHighlightFromCounts(key, 0, nextMeta.filter((m) => m.publicUrl?.trim()).length);
      return;
    }

    const currentCount = Math.max(
      cp4PhotoFiles[key].length,
      photoMetadataByFieldRef.current[uploadField].filter((p) => p.publicUrl?.trim()).length,
    );
    if (currentCount + picked.length > MAX_PHOTOS_PER_FIELD) {
      setCp4PhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_MAX_COUNT }));
      return;
    }

    const merged = [...cp4PhotoFiles[key], ...picked];
    setCp4PhotoFiles((p) => ({ ...p, [key]: merged }));
    const uploadResult = await uploadPhotosToStorage("cp4", uploadField, picked);
    const nextMeta = dedupeUploadedPhotoMeta([...photoMetadataByFieldRef.current[uploadField], ...uploadResult.uploadedPhotos]).slice(
      0,
      MAX_PHOTOS_PER_FIELD,
    );
    if (!uploadResult.ok && uploadResult.failures.length > 0) {
      const level: "warn" | "error" = nextMeta.length > 0 ? "warn" : "error";
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue(level, f));
    }
    setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: nextMeta }));
    setCp4PhotoErrors((er) => ({ ...er, [key]: nextMeta.length > 0 ? null : uploadResult.ok ? null : UPLOAD_ERR_UPLOAD_FAILED }));
    if (uploadResult.ok || nextMeta.length > 0) {
      setCp4PhotoFiles((p) => ({ ...p, [key]: [] }));
    }
    clearFieldHighlight(photoKey);
    syncCp4PhotoHighlightFromCounts(key, 0, nextMeta.filter((m) => m.publicUrl?.trim()).length);
  };

  const linxupAtPhotoIssueKey = (key: LinxupAtPhotoKey) => `photo-linxup-at-${key}`;

  const syncLinxupAtPhotoHighlightFromCounts = (key: LinxupAtPhotoKey, localLen: number, remoteCount: number) => {
    const photoKey = linxupAtPhotoIssueKey(key);
    const total = Math.max(localLen, remoteCount);
    if (total < 1) {
      setReviewHighlights((prev) => {
        const next = new Set(prev);
        next.add(photoKey);
        return next;
      });
    } else {
      setReviewHighlights((prev) => {
        if (!prev.has(photoKey)) return prev;
        const next = new Set(prev);
        next.delete(photoKey);
        if (next.size === 0) queueMicrotask(() => setReviewBlockMessage(null));
        return next;
      });
    }
  };

  const removeLinxupAtLocalPhoto = (key: LinxupAtPhotoKey, targetFile: File) => {
    setLinxupAtPhotoFiles((p) => ({ ...p, [key]: p[key].filter((f) => f !== targetFile) }));
  };

  const applyLinxupAtPhotoUpload = async (key: LinxupAtPhotoKey, e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    const uploadField = linxupAtUploadFieldFor(key);
    const photoKey = linxupAtPhotoIssueKey(key);

    const hasInvalidType = picked.some((f) => {
      const mime = f.type.toLowerCase();
      const name = f.name.toLowerCase();
      const allowedMime = mime === "image/jpeg" || mime === "image/png";
      const allowedExt = name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
      return !(allowedMime || allowedExt);
    });
    if (hasInvalidType && picked.length > 0) {
      setLinxupAtPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_TYPE }));
      return;
    }

    const overSize = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (overSize) {
      setLinxupAtPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_SIZE }));
      return;
    }

    if (picked.length === 0) {
      const prevMeta = [...photoMetadataByFieldRef.current[uploadField]];
      setLinxupAtPhotoFiles((p) => ({ ...p, [key]: [] }));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: [] }));
      for (const m of prevMeta) {
        if (m.storagePath) void deleteJobCardPhotoObject(m.storagePath);
      }
      setLinxupAtPhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(photoKey);
      syncLinxupAtPhotoHighlightFromCounts(key, 0, 0);
      return;
    }

    const prevMeta = [...photoMetadataByFieldRef.current[uploadField]];
    setLinxupAtPhotoFiles((p) => ({ ...p, [key]: [picked[0]] }));
    const uploadResult = await uploadPhotosToStorage("linxup", uploadField, [picked[0]]);
    const nextMeta = dedupeUploadedPhotoMeta(uploadResult.uploadedPhotos);
    if (nextMeta.length === 0) {
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue("error", f));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: prevMeta }));
      setLinxupAtPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_UPLOAD_FAILED }));
      clearFieldHighlight(photoKey);
      syncLinxupAtPhotoHighlightFromCounts(key, 1, prevMeta.filter((m) => m.publicUrl?.trim()).length);
      return;
    }
    if (!uploadResult.ok && uploadResult.failures.length > 0) {
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue("warn", f));
    }
    setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: nextMeta }));
    setLinxupAtPhotoFiles((p) => ({ ...p, [key]: [] }));
    for (const m of prevMeta) {
      if (m.storagePath && !nextMeta.some((n) => n.storagePath === m.storagePath)) {
        void deleteJobCardPhotoObject(m.storagePath);
      }
    }
    setLinxupAtPhotoErrors((er) => ({ ...er, [key]: null }));
    clearFieldHighlight(photoKey);
    syncLinxupAtPhotoHighlightFromCounts(key, 0, nextMeta.filter((m) => m.publicUrl?.trim()).length);
  };

  const linxupVtPhotoIssueKey = (key: LinxupVtPhotoKey) => `photo-linxup-vt-${key}`;

  const syncLinxupVtPhotoHighlightFromCounts = (key: LinxupVtPhotoKey, localLen: number, remoteCount: number) => {
    const photoKey = linxupVtPhotoIssueKey(key);
    const total = Math.max(localLen, remoteCount);
    if (total < 1) {
      setReviewHighlights((prev) => {
        const next = new Set(prev);
        next.add(photoKey);
        return next;
      });
    } else {
      setReviewHighlights((prev) => {
        if (!prev.has(photoKey)) return prev;
        const next = new Set(prev);
        next.delete(photoKey);
        if (next.size === 0) queueMicrotask(() => setReviewBlockMessage(null));
        return next;
      });
    }
  };

  const removeLinxupVtLocalPhoto = (key: LinxupVtPhotoKey, targetFile: File) => {
    setLinxupVtPhotoFiles((p) => ({ ...p, [key]: p[key].filter((f) => f !== targetFile) }));
  };

  const applyLinxupVtPhotoUpload = async (key: LinxupVtPhotoKey, e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    const uploadField = linxupVtUploadFieldFor(key);
    const photoKey = linxupVtPhotoIssueKey(key);

    const hasInvalidType = picked.some((f) => {
      const mime = f.type.toLowerCase();
      const name = f.name.toLowerCase();
      const allowedMime = mime === "image/jpeg" || mime === "image/png";
      const allowedExt = name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
      return !(allowedMime || allowedExt);
    });
    if (hasInvalidType && picked.length > 0) {
      setLinxupVtPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_TYPE }));
      return;
    }

    const overSize = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (overSize) {
      setLinxupVtPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_SIZE }));
      return;
    }

    if (picked.length === 0) {
      const prevMeta = [...photoMetadataByFieldRef.current[uploadField]];
      setLinxupVtPhotoFiles((p) => ({ ...p, [key]: [] }));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: [] }));
      for (const m of prevMeta) {
        if (m.storagePath) void deleteJobCardPhotoObject(m.storagePath);
      }
      setLinxupVtPhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(photoKey);
      syncLinxupVtPhotoHighlightFromCounts(key, 0, 0);
      return;
    }

    const prevMeta = [...photoMetadataByFieldRef.current[uploadField]];
    setLinxupVtPhotoFiles((p) => ({ ...p, [key]: [picked[0]] }));
    const uploadResult = await uploadPhotosToStorage("linxup", uploadField, [picked[0]]);
    const nextMeta = dedupeUploadedPhotoMeta(uploadResult.uploadedPhotos);
    if (nextMeta.length === 0) {
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue("error", f));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: prevMeta }));
      setLinxupVtPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_UPLOAD_FAILED }));
      clearFieldHighlight(photoKey);
      syncLinxupVtPhotoHighlightFromCounts(key, 1, prevMeta.filter((m) => m.publicUrl?.trim()).length);
      return;
    }
    if (!uploadResult.ok && uploadResult.failures.length > 0) {
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue("warn", f));
    }
    setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: nextMeta }));
    setLinxupVtPhotoFiles((p) => ({ ...p, [key]: [] }));
    for (const m of prevMeta) {
      if (m.storagePath && !nextMeta.some((n) => n.storagePath === m.storagePath)) {
        void deleteJobCardPhotoObject(m.storagePath);
      }
    }
    setLinxupVtPhotoErrors((er) => ({ ...er, [key]: null }));
    clearFieldHighlight(photoKey);
    syncLinxupVtPhotoHighlightFromCounts(key, 0, nextMeta.filter((m) => m.publicUrl?.trim()).length);
  };

  const linxupLcPhotoIssueKey = (key: LinxupLcPhotoKey) => `photo-linxup-lc-${key}`;

  const syncLinxupLcPhotoHighlightFromCounts = (key: LinxupLcPhotoKey, localLen: number, remoteCount: number) => {
    const photoKey = linxupLcPhotoIssueKey(key);
    const total = Math.max(localLen, remoteCount);
    if (total < 1) {
      setReviewHighlights((prev) => {
        const next = new Set(prev);
        next.add(photoKey);
        return next;
      });
    } else {
      setReviewHighlights((prev) => {
        if (!prev.has(photoKey)) return prev;
        const next = new Set(prev);
        next.delete(photoKey);
        if (next.size === 0) queueMicrotask(() => setReviewBlockMessage(null));
        return next;
      });
    }
  };

  const removeLinxupLcLocalPhoto = (key: LinxupLcPhotoKey, targetFile: File) => {
    setLinxupLcPhotoFiles((p) => ({ ...p, [key]: p[key].filter((f) => f !== targetFile) }));
  };

  const applyLinxupLcPhotoUpload = async (key: LinxupLcPhotoKey, e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    const uploadField = linxupLcUploadFieldFor(key);
    const photoKey = linxupLcPhotoIssueKey(key);

    const hasInvalidType = picked.some((f) => {
      const mime = f.type.toLowerCase();
      const name = f.name.toLowerCase();
      const allowedMime = mime === "image/jpeg" || mime === "image/png";
      const allowedExt = name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
      return !(allowedMime || allowedExt);
    });
    if (hasInvalidType && picked.length > 0) {
      setLinxupLcPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_TYPE }));
      return;
    }

    const overSize = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (overSize) {
      setLinxupLcPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_SIZE }));
      return;
    }

    if (picked.length === 0) {
      const prevMeta = [...photoMetadataByFieldRef.current[uploadField]];
      setLinxupLcPhotoFiles((p) => ({ ...p, [key]: [] }));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: [] }));
      for (const m of prevMeta) {
        if (m.storagePath) void deleteJobCardPhotoObject(m.storagePath);
      }
      setLinxupLcPhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(photoKey);
      syncLinxupLcPhotoHighlightFromCounts(key, 0, 0);
      return;
    }

    const prevMeta = [...photoMetadataByFieldRef.current[uploadField]];
    setLinxupLcPhotoFiles((p) => ({ ...p, [key]: [picked[0]] }));
    const uploadResult = await uploadPhotosToStorage("linxup", uploadField, [picked[0]]);
    const nextMeta = dedupeUploadedPhotoMeta(uploadResult.uploadedPhotos);
    if (nextMeta.length === 0) {
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue("error", f));
      setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: prevMeta }));
      setLinxupLcPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_UPLOAD_FAILED }));
      clearFieldHighlight(photoKey);
      syncLinxupLcPhotoHighlightFromCounts(key, 1, prevMeta.filter((m) => m.publicUrl?.trim()).length);
      return;
    }
    if (!uploadResult.ok && uploadResult.failures.length > 0) {
      uploadResult.failures.forEach((f) => logSupabaseUploadIssue("warn", f));
    }
    setPhotoMetadataByFieldSafe((p) => ({ ...p, [uploadField]: nextMeta }));
    setLinxupLcPhotoFiles((p) => ({ ...p, [key]: [] }));
    for (const m of prevMeta) {
      if (m.storagePath && !nextMeta.some((n) => n.storagePath === m.storagePath)) {
        void deleteJobCardPhotoObject(m.storagePath);
      }
    }
    setLinxupLcPhotoErrors((er) => ({ ...er, [key]: null }));
    clearFieldHighlight(photoKey);
    syncLinxupLcPhotoHighlightFromCounts(key, 0, nextMeta.filter((m) => m.publicUrl?.trim()).length);
  };

  const handleReviewClick = () => {
    setSubmitSuccessMessage(null);
    setEmailSubmissionPreview(null);
    const issues = collectReviewValidationIssues();
    if (issues.length > 0) {
      setReviewHighlights(new Set(issues));
      setReviewBlockMessage(
        "Fix the highlighted items below (scroll stopped at the first one). Add missing photos or text, then try again.",
      );
      queueMicrotask(() => {
        document.getElementById(`field-${issues[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setReviewHighlights(new Set());
    setReviewBlockMessage(null);
    setStep("review");
  };

  const buildSubmissionPayload = async (): Promise<JobCardSubmissionPayload> => {
    const photoSnapshot = getPhotoPersistenceSnapshot();
    const normalizedCoreJob = normalizeUppercaseCoreJob(coreJob);
    const projectContext = await resolveProjectContextPayload();

    // Authorize against the project's company from trusted storage/DB — not only React UI state.
    let trustedCompanyName = selectedCompanyName?.trim() || "";
    try {
      if (typeof window !== "undefined" && !window.navigator.onLine) {
        const snap = await getBestStarterSnapshotForOffline();
        const fromSnap = snap?.companies.find((c) => c.id === projectContext.companyId)?.name?.trim() || "";
        if (fromSnap) trustedCompanyName = fromSnap;
      } else if (projectContext.companyId) {
        const { data: companyRow, error: companyError } = await supabase
          .from("companies")
          .select("name")
          .eq("id", projectContext.companyId)
          .maybeSingle<{ name: string }>();
        if (!companyError && companyRow?.name?.trim()) {
          trustedCompanyName = companyRow.name.trim();
        }
      }
    } catch {
      // keep selectedCompanyName fallback
    }

    if (!trustedCompanyName || !hasCompanyProducts) {
      throw new Error("Project company is not loaded or is not assigned any forms.");
    }
    if (!effectivePrimary || !selectableProducts.some((p) => p.sectionKey === effectivePrimary)) {
      throw new Error("Selected form is not assigned to this company.");
    }
    if (!areAdditionalProductsAllowed(resolvedProducts, effectivePrimary, selectedAdditional)) {
      throw new Error("Selected additional hardware is not allowed with this primary product.");
    }

    const ppdPayload: JobCardPpdPayload | undefined = selectedIncludeEffective(selectedSections, "PPD")
      ? {
          hubSerial: ppdHubSerial,
          cameraLocations: [...ppdCameraLocations],
          cameraSerialsByLocation: { ...ppdCameraSerialsByLocation },
          monitorInstalled: ppdMonitorInstalled,
          customBracketsNeeded: ppdCustomBracketsNeeded,
          customBracketNotes: ppdCustomBracketNotes,
          clientApproval: ppdClientApproval,
          jsonFileName: ppdJsonLocalFile?.name.trim() || ppdJsonFileName.trim(),
          ...(ppdJsonUploadedConfig ? { jsonConfigFile: ppdJsonUploadedConfig } : {}),
          jsonConfigForm: ppdJsonConfigFormEffective,
          relaysUsedForSpeedControl: ppdRelaysUsedForSpeedControl,
          redWireDescription: ppdRedWireDescription,
          blackWireDescription: ppdBlackWireDescription,
          yellowWireDescription: ppdYellowWireDescription,
          greyWireDescription: ppdGreyWireDescription,
          blueWireDescription: ppdBlueWireDescription,
          powerConverterDescription: ppdPowerConverterDescription,
          redAlarmOutDescription: ppdRedAlarmOutDescription,
          yellowAlarmOutDescription: ppdYellowAlarmOutDescription,
          blackAlarmGroundDescription: ppdBlackAlarmGroundDescription,
        }
      : undefined;
    const cp4Payload: JobCardCp4Payload | undefined = selectedSections.includes("CP4")
      ? {
          drid: cp4Drid,
          serial: cp4Serial,
          cameraQuantity: cp4CameraQuantity,
          monitorInstalled: cp4MonitorInstalled,
          clientApproval: cp4ClientApproval,
          customBracketsNeeded: cp4CustomBracketsNeeded,
          customBracketNotes: cp4CustomBracketNotes,
          alarmIn1RelayInstalled: cp4AlarmIn1RelayInstalled,
          alarmIn1Description: cp4AlarmIn1Description,
          alarmIn2RelayInstalled: cp4AlarmIn2RelayInstalled,
          alarmIn2Description: cp4AlarmIn2Description,
          hubMountingDescription: cp4HubMountingDescription,
          microphoneMountingDescription: cp4MicrophoneMountingDescription,
          remoteControlMountingDescription: cp4RemoteControlMountingDescription,
          gpsSensorMountingDescription: cp4GpsSensorMountingDescription,
          redWireDescription: cp4RedWireDescription,
          blackWireDescription: cp4BlackWireDescription,
          whiteWireDescription: cp4WhiteWireDescription,
          monitorMountingDescription: cp4MonitorMountingDescription,
          powerConverterDescription: cp4PowerConverterDescription,
        }
      : undefined;
    const sscSpeedPayload = selectedSections.includes("blaxtair_ssc_speed") ? { ...sscFields } : undefined;
    const linxupPayload = isLinxUpProfile && selectedPrimaryForm
      ? buildLinxUpPayload({
          formId: selectedPrimaryForm.id,
          customer: normalizedCoreJob.customer,
          location: normalizedCoreJob.location,
          primaryContact: normalizedCoreJob.primaryContact ?? "",
          contactNumber: normalizedCoreJob.contactNumber ?? "",
          contactEmail: normalizedCoreJob.contactEmail ?? "",
          year: linxupYear,
          make: normalizedCoreJob.equipmentMake,
          model: normalizedCoreJob.equipmentModel,
          serialVin: normalizedCoreJob.equipmentSerial,
          assetNumber: normalizedCoreJob.unitNumber,
          vehicleType: linxupVehicleType,
          hoursMiles: linxupHoursMiles,
          powerConnectionDescription: linxupPowerConnectionDescription,
          groundConnectionDescription: linxupGroundConnectionDescription,
          ignitionConnectionDescription: linxupIgnitionConnectionDescription,
          includeAssetTrackerFields: isLinxUpAssetTracker,
          vehicleTracker: isLinxUpVehicleTracker
            ? {
                obdPortConnected: linxupVtObdPortConnected,
                installationNotes: linxupVtInstallationNotes,
                powerConnectionDescription: linxupVtPowerConnectionDescription,
                groundConnectionDescription: linxupVtGroundConnectionDescription,
                ignitionConnectionDescription: linxupVtIgnitionConnectionDescription,
              }
            : null,
          linxCam: isLinxUpLinxCam
            ? {
                obdPortConnected: linxupLcObdPortConnected,
                installationNotes: linxupLcInstallationNotes,
                powerConnectionDescription: linxupLcPowerConnectionDescription,
                groundConnectionDescription: linxupLcGroundConnectionDescription,
                ignitionConnectionDescription: linxupLcIgnitionConnectionDescription,
              }
            : null,
        })
      : undefined;

    return {
      submissionId,
      submissionTimestamp: new Date().toISOString(),
      status: "Submitted",
      companyId: projectContext.companyId,
      projectId: projectContext.projectId,
      projectName: projectContext.projectName,
      projectRecipientEmails: projectContext.projectRecipientEmails,
      coreJobInfo: { ...normalizedCoreJob },
      hardwareSelection: {
        primary: effectivePrimary,
        hasAdditional,
        additional: [...selectedAdditional],
      },
      selectedSections: [...selectedSections],
      productDisplay: toProductDisplayContext(productLookup),
      ...(selectedPrimaryForm
        ? { formId: selectedPrimaryForm.id, submissionType: selectedPrimaryForm.submissionType }
        : {}),
      photoUploads: [...photoSnapshot.photoUploads],
      ...(ppdPayload ? { ppd: ppdPayload } : {}),
      ...(cp4Payload ? { cp4: cp4Payload } : {}),
      ...(sscSpeedPayload ? { sscSpeed: sscSpeedPayload } : {}),
      ...(linxupPayload ? { linxup: linxupPayload } : {}),
      ...(blaxtairSystem ? { installedProductSystems: [blaxtairSystem] } : {}),
      productFiles: [
        ...mergeLegacyPpdIntoProductFiles({
          productKey: PPD_PRODUCT_KEY,
          productFiles: flattenUploadedProductFiles(productFileSlots),
          ppd: ppdPayload,
          baseFormId: "ppd",
        }),
        ...(sscConfigFile ? [sscConfigFile] : []),
      ],
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

  const cleanupLocalDraftsAfterSubmit = async (submittedPayload: JobCardSubmissionPayload) => {
    try {
      window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_ID_KEY);
      window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_PAYLOAD_KEY);
      const sc = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
      const sp = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
      clearMatchingAutosave(sc, sp);
      const drafts = readMigratedDraftsFromStorage();
      const next = drafts.filter((d) => (d.submissionId || d.id) !== submissionId);
      window.localStorage.setItem(JOB_CARD_DRAFTS_STORAGE_KEY, JSON.stringify(next));
      if (offlineDraftIdRef.current) {
        const offlineId = offlineDraftIdRef.current;
        await deleteOfflineJobCardDraft(offlineId);
        console.log("[offline-draft] deleted after submit", offlineId);
        offlineDraftIdRef.current = null;
      }
      try {
        window.localStorage.removeItem(INSTALLER_OFFLINE_DRAFT_ID_KEY);
      } catch {
        // ignore
      }
      clearRestoredAutosaveAfterPersist(autosaveRestoredClearTargetRef, "submit");
    } catch {
      // ignore localStorage cleanup errors
    }
    void submittedPayload;
  };

  const persistSubmittedJobCard = async (submittedPayload: JobCardSubmissionPayload) => {
    const contextIds = await resolveSelectedOrDefaultContextIds();
    const createdAt = new Date().toISOString();
    const { data: existingRow, error: existingError } = await supabase
      .from("job_card_submissions")
      .select("submission_id")
      .eq("submission_id", submittedPayload.submissionId)
      .maybeSingle<{ submission_id: string }>();
    if (existingError) throw existingError;
    if (existingRow?.submission_id) {
      const { error: updateError } = await supabase
        .from("job_card_submissions")
        .update({
          payload: submittedPayload,
          customer: submittedPayload.coreJobInfo.customer.trim() || "—",
          unit_number: submittedPayload.coreJobInfo.unitNumber.trim() || "—",
        })
        .eq("submission_id", submittedPayload.submissionId);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase.from("job_card_submissions").insert({
        submission_id: submittedPayload.submissionId,
        company_id: contextIds.companyId,
        project_id: contextIds.projectId,
        customer: submittedPayload.coreJobInfo.customer.trim() || "—",
        unit_number: submittedPayload.coreJobInfo.unitNumber.trim() || "—",
        payload: submittedPayload,
        created_at: createdAt,
      });
      if (insertError) throw insertError;
    }
    const { error: deleteDraftError } = await supabase
      .from("job_card_drafts")
      .delete()
      .eq("submission_id", submittedPayload.submissionId);
    if (deleteDraftError) throw deleteDraftError;
    await cleanupLocalDraftsAfterSubmit(submittedPayload);
  };

  const insertCustomerSiteFileRowOnce = async (params: {
    companyId: string;
    customerId: string | null;
    projectId: string;
    submissionId: string;
    fileName: string;
    storagePath: string;
    make: string;
    model: string;
    unitNum: string;
  }) => {
    const { data: existingRow, error: existingError } = await supabase
      .from("customer_site_files")
      .select("id")
      .eq("submission_id", params.submissionId)
      .eq("storage_path", params.storagePath)
      .maybeSingle<{ id: string }>();
    if (existingError) throw existingError;
    if (existingRow?.id) return;
    const { data: userData } = await supabase.auth.getUser();
    await insertCustomerSiteFileRow({
      company_id: params.companyId,
      customer_id: params.customerId,
      project_id: params.projectId,
      submission_id: params.submissionId,
      file_name: params.fileName,
      storage_path: params.storagePath,
      make: params.make || null,
      model: params.model || null,
      unit_number: params.unitNum || null,
      notes: null,
      uploaded_by: userData.user?.id ?? null,
    });
  };

  const ensurePpdJsonOnPayload = async (
    payloadForSend: JobCardSubmissionPayload,
  ): Promise<JobCardSubmissionPayload> => {
    // Only the exact shared PPD product uses the deprecated ppd.json* upload bridge.
    if (!(sharedPpdProductSelected && payloadForSend.ppd)) {
      return payloadForSend;
    }
    if (isOffline) {
      throw new Error("JSON upload requires online connection.");
    }
    if (!ppdJsonLocalFile && !ppdJsonUploadedConfig) {
      throw new Error("Select a JSON configuration file (.json).");
    }
    const ctx = await resolveSelectedOrDefaultContextIds();
    const { data: projRow, error: projErr } = await supabase
      .from("projects")
      .select("customer_id")
      .eq("id", ctx.projectId)
      .maybeSingle<{ customer_id: string | null }>();
    const customerId = !projErr && projRow ? projRow.customer_id?.trim() || null : null;
    const nj = normalizeUppercaseCoreJob(coreJob);
    const make = nj.equipmentMake.trim();
    const model = nj.equipmentModel.trim();
    const unitNum = nj.unitNumber.trim();
    let jsonConfigFile: JobCardPpdJsonConfigFile;
    if (ppdJsonLocalFile) {
      const { storagePath, publicUrl, uploadedAt } = await uploadPpdJsonFileToStorage(ppdJsonLocalFile, {
        companyId: ctx.companyId,
        projectId: ctx.projectId,
        customerId,
        unitNumber: unitNum || "unit",
        make,
        model,
        notes: "",
      });
      jsonConfigFile = {
        fileName: ppdJsonLocalFile.name,
        storagePath,
        publicUrl,
        customerId,
        projectId: ctx.projectId,
        companyId: ctx.companyId,
        make,
        model,
        unitNumber: unitNum,
        notes: "",
        uploadedAt,
      };
      setPpdJsonUploadedConfig(jsonConfigFile);
      setPpdJsonFileName(ppdJsonLocalFile.name);
      setPpdJsonLocalFile(null);
    } else {
      jsonConfigFile = {
        ...ppdJsonUploadedConfig!,
        fileName: ppdJsonUploadedConfig!.fileName || ppdJsonFileName.trim() || "config.json",
        make,
        model,
        unitNumber: unitNum,
        notes: "",
      };
    }

    await insertCustomerSiteFileRowOnce({
      companyId: ctx.companyId,
      customerId,
      projectId: ctx.projectId,
      submissionId: payloadForSend.submissionId,
      fileName: jsonConfigFile.fileName,
      storagePath: jsonConfigFile.storagePath,
      make,
      model,
      unitNum,
    });

    return {
      ...payloadForSend,
      ppd: {
        ...payloadForSend.ppd!,
        jsonConfigFile,
        jsonFileName: jsonConfigFile.fileName,
        jsonConfigForm: ppdJsonConfigFormEffective,
      },
      productFiles: mergeLegacyPpdIntoProductFiles({
        productKey: PPD_PRODUCT_KEY,
        productFiles: [
          ...flattenUploadedProductFiles(productFileSlots).filter(
            (a) =>
              !(
                a.productKey === PPD_PRODUCT_KEY &&
                a.fileKey === PPD_JSON_FILE_KEY
              ),
          ),
          {
            fileKey: PPD_JSON_FILE_KEY,
            productKey: PPD_PRODUCT_KEY,
            originalFileName: jsonConfigFile.fileName,
            storageBucket: "customer-site-files",
            storagePath: jsonConfigFile.storagePath,
            mimeType: "application/json",
            sizeBytes: 0,
            uploadedAt: jsonConfigFile.uploadedAt,
            displayLabel: "PPD JSON configuration",
            baseFormId: "ppd",
            downloadUrl: jsonConfigFile.publicUrl,
            includeInReview: true,
            includeInEmail: true,
            make: jsonConfigFile.make,
            model: jsonConfigFile.model,
            unitNumber: jsonConfigFile.unitNumber,
            notes: jsonConfigFile.notes,
            companyId: jsonConfigFile.companyId,
            projectId: jsonConfigFile.projectId,
            customerId: jsonConfigFile.customerId,
          },
        ],
        ppd: { jsonConfigFile },
        baseFormId: "ppd",
      }),
    };
  };

  const ensureProductFilesOnPayload = async (
    payloadForSend: JobCardSubmissionPayload,
  ): Promise<JobCardSubmissionPayload> => {
    let next = await ensurePpdJsonOnPayload(payloadForSend);
    if (isOffline) return next;

    const ctx = await resolveSelectedOrDefaultContextIds();
    const { data: projRow, error: projErr } = await supabase
      .from("projects")
      .select("customer_id")
      .eq("id", ctx.projectId)
      .maybeSingle<{ customer_id: string | null }>();
    const customerId = !projErr && projRow ? projRow.customer_id?.trim() || null : null;
    const nj = normalizeUppercaseCoreJob(coreJob);
    const make = nj.equipmentMake.trim();
    const model = nj.equipmentModel.trim();
    const unitNum = nj.unitNumber.trim();
    const { data: userData } = await supabase.auth.getUser();

    const nextSlots = { ...productFileSlots };
    for (const product of selectedProductsWithFiles) {
      for (const def of product.productFileDefinitions) {
        if (!def.active) continue;
        if (def.key === PPD_JSON_FILE_KEY && product.productKey === PPD_PRODUCT_KEY) {
          continue; // Shared PPD JSON handled by ensurePpdJsonOnPayload mirror bridge
        }
        const id = productFileSlotId({ productKey: product.productKey, fileKey: def.key });
        const slot = nextSlots[id];
        if (!slot?.localFiles.length) continue;
        const uploadedList = [...(slot.uploaded || [])];
        for (const file of slot.localFiles) {
          const uploaded = await uploadProductFile({
            file,
            definition: def,
            productKey: product.productKey,
            baseFormId: product.baseFormId,
            companyId: ctx.companyId,
            projectId: ctx.projectId,
            customerId,
            unitNumber: unitNum || "unit",
            make,
            model,
            notes: "",
            uploadedByUserId: userData.user?.id ?? null,
          });
          await insertProductFileSiteRowTyped({
            file: uploaded,
            submissionId: next.submissionId,
          });
          uploadedList.push(uploaded);
        }
        nextSlots[id] = {
          ...slot,
          localFiles: [],
          uploaded: def.multiple ? uploadedList : uploadedList.slice(-1),
        };
      }
    }
    setProductFileSlots(nextSlots);

    const files = mergeLegacyPpdIntoProductFiles({
      productKey: PPD_PRODUCT_KEY,
      productFiles: flattenUploadedProductFiles(nextSlots),
      ppd: next.ppd,
      baseFormId: "ppd",
    });
    next = {
      ...next,
      productFiles: files,
      ...(next.ppd
        ? { ppd: syncPpdPayloadWithProductFiles({ ppd: next.ppd, productKey: PPD_PRODUCT_KEY, files }) }
        : {}),
    };
    return next;
  };

  const handleFinalSubmit = async () => {
    if (isOffline) {
      setDraftNoticeMessage("Offline mode — submit is disabled until connection returns.");
      return;
    }
    setSubmitSuccessMessage(null);
    setEmailSendStatus("idle");
    setEmailSendErrorMessage(null);
    setPostSubmitSyncWarning(null);
    setSubmitPersistStatus("saving");
    try {
      let payload = await buildSubmissionPayload();
      payload = await ensureProductFilesOnPayload(payload);
      console.log("[Job card submission]", payload);
      setPendingEmailPayload(payload);
      await persistSubmittedJobCard(payload);
      setSubmissionStatus("Submitted");
      // eslint-disable-next-line react-hooks/purity -- submission completion timestamp (event handler)
      setSubmissionCompletedAt(Date.now());
      setSubmitPersistStatus("idle");
      setSubmitSuccessMessage(
        "Job card submitted. Photos are saved. You can send the email now or later from Submitted Job Cards.",
      );
      setEmailSubmissionPreview({
        model: buildEmailViewModel(payload),
      });
      setReviewHighlights(new Set());
      setReviewBlockMessage(null);
      setStep("form");
    } catch (e) {
      setSubmitPersistStatus("error");
      setPostSubmitSyncWarning(
        e instanceof Error ? e.message : "Could not save the submitted job card. Email was not required.",
      );
    }
  };

  const handleConfirmSendEmail = async (sendMode: EmailSendMode) => {
    if (!pendingEmailPayload) return;
    setEmailSendStatus("sending");
    setEmailSendErrorMessage(null);
    setPostSubmitSyncWarning(null);
    try {
      const payloadForSend = pendingEmailPayload;
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: payloadForSend,
          sendMode,
          sentByUserId: authUserContext.userId || null,
        }),
      });
      let data: {
        error?: string;
        sendMode?: EmailSendMode;
        photoAttachments?: {
          attachedCount?: number;
          skippedCount?: number;
          warnings?: string[];
          failures?: Array<{ label: string; filename: string; reason: string }>;
          failureMessages?: string[];
          blocked?: boolean;
        };
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        /* ignore non-JSON */
      }
      if (!res.ok) {
        setEmailSendStatus("error");
        const failureLines =
          data.photoAttachments?.failureMessages?.length
            ? data.photoAttachments.failureMessages
            : (data.photoAttachments?.failures || []).map(
                (f) => `${f.label} (${f.filename}): ${f.reason}`,
              );
        const base =
          typeof data.error === "string" ? data.error : `Request failed (${res.status})`;
        setEmailSendErrorMessage(
          failureLines.length > 0 ? `${base}\n${failureLines.join("\n")}` : base,
        );
        return;
      }
      setEmailSendStatus("success");
      setEmailSendModalOpen(false);
      setLastEmailMode(data.sendMode || sendMode);
      const attached = data.photoAttachments?.attachedCount;
      setSubmitSuccessMessage(
        typeof attached === "number"
          ? `Email sent (${sendMode === "internal_only" ? "internal only" : "client + internal"}) with ${attached} inline photo${attached === 1 ? "" : "s"}.`
          : `Email sent (${sendMode === "internal_only" ? "internal only" : "client + internal"}).`,
      );
      setEmailSubmissionPreview((prev) =>
        prev ? { model: buildEmailViewModel(payloadForSend) } : { model: buildEmailViewModel(payloadForSend) },
      );
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
    restoredFromDraftRef.current = true;
    setSubmissionId(restoredSubmissionId);
    setCoreJob((prev) => normalizeUppercaseCoreJob({ ...prev, ...draft.coreJob }));
    setPrimary(draft.hardwareSelection?.primary || "");
    setHasAdditional(draft.hardwareSelection?.hasAdditional || "");
    // Keep stored IDs; selectedAdditional derives allowed extras once company context is ready.
    setAdditional(Array.isArray(draft.hardwareSelection?.additional) ? draft.hardwareSelection.additional : []);
    setBlaxtairSystem(Array.isArray(draft.installedProductSystems) ? (draft.installedProductSystems[0] ?? null) : null);
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
    const rawPpd = draft.ppd;
    if (rawPpd !== undefined && rawPpd !== null && typeof rawPpd === "object" && !Array.isArray(rawPpd)) {
      const p = rawPpd as Record<string, unknown>;
      setPpdHubSerial(normalizePpdSerialInput(draftString(p.hubSerial)));
      setPpdCameraLocations(sanitizePpdCameraLocationsFromDraft(p.cameraLocations));
      setPpdCameraSerialsByLocation(mergePpdCameraSerialsFromDraft(p.cameraSerialsByLocation));
      setPpdMonitorInstalled(draftString(p.monitorInstalled));
      setPpdCustomBracketsNeeded(draftString(p.customBracketsNeeded));
      setPpdCustomBracketNotes(draftString(p.customBracketNotes));
      setPpdClientApproval(draftString(p.clientApproval));
      setPpdJsonFileName(draftString(p.jsonFileName));
      if (p.jsonConfigFile && typeof p.jsonConfigFile === "object" && !Array.isArray(p.jsonConfigFile)) {
        setPpdJsonUploadedConfig(p.jsonConfigFile as JobCardPpdJsonConfigFile);
      } else {
        setPpdJsonUploadedConfig(null);
      }
      setPpdJsonLocalFile(null);
      try {
        if (ppdJsonFileInputRef.current) ppdJsonFileInputRef.current.value = "";
      } catch {
        // ignore
      }
      {
        const storedFiles = draft as {
          productFiles?: unknown;
          /** Uncommitted predecessor key; read only for compatibility. */
          productArtifacts?: unknown;
        };
        const productFiles = readUploadedProductFiles(
          storedFiles.productFiles ?? storedFiles.productArtifacts,
        );
        setProductFileSlots(
          hydrateAllProductFileSlotsFromPayload({
            productFiles,
            ppd:
              p.jsonConfigFile && typeof p.jsonConfigFile === "object"
                ? {
                    jsonConfigFile: p.jsonConfigFile as JobCardPpdJsonConfigFile,
                    jsonFileName: draftString(p.jsonFileName),
                  }
                : null,
            mirrorPpdProductKey: PPD_PRODUCT_KEY,
            baseFormId: "ppd",
          }),
        );
      }
      setPpdRelaysUsedForSpeedControl(draftString(p.relaysUsedForSpeedControl));
      setPpdRedWireDescription(draftString(p.redWireDescription));
      setPpdBlackWireDescription(draftString(p.blackWireDescription));
      setPpdYellowWireDescription(draftString(p.yellowWireDescription));
      setPpdGreyWireDescription(draftString(p.greyWireDescription));
      setPpdBlueWireDescription(draftString(p.blueWireDescription));
      setPpdPowerConverterDescription(draftString(p.powerConverterDescription));
      setPpdRedAlarmOutDescription(draftString(p.redAlarmOutDescription));
      setPpdYellowAlarmOutDescription(draftString(p.yellowAlarmOutDescription));
      setPpdBlackAlarmGroundDescription(draftString(p.blackAlarmGroundDescription));
    } else {
      setPpdHubSerial("");
      setPpdCameraLocations([]);
      setPpdCameraSerialsByLocation(emptyPpdCameraSerialsByLocation());
      setPpdMonitorInstalled("");
      setPpdCustomBracketsNeeded("");
      setPpdCustomBracketNotes("");
      setPpdClientApproval("");
      setPpdJsonFileName("");
      setPpdJsonUploadedConfig(null);
      setPpdJsonLocalFile(null);
      setProductFileSlots({});
      setPpdRelaysUsedForSpeedControl("");
      setPpdRedWireDescription("");
      setPpdBlackWireDescription("");
      setPpdYellowWireDescription("");
      setPpdGreyWireDescription("");
      setPpdBlueWireDescription("");
      setPpdPowerConverterDescription("");
      setPpdRedAlarmOutDescription("");
      setPpdYellowAlarmOutDescription("");
      setPpdBlackAlarmGroundDescription("");
    }

    const rawCp4 = draft.cp4;
    if (rawCp4 !== undefined && rawCp4 !== null && typeof rawCp4 === "object" && !Array.isArray(rawCp4)) {
      const c = rawCp4 as Record<string, unknown>;
      setCp4Drid(draftString(c.drid));
      setCp4Serial(draftString(c.serial));
      setCp4CameraQuantity(draftString(c.cameraQuantity));
      setCp4MonitorInstalled(draftString(c.monitorInstalled));
      setCp4ClientApproval(draftString(c.clientApproval));
      setCp4CustomBracketsNeeded(draftString(c.customBracketsNeeded));
      setCp4CustomBracketNotes(draftString(c.customBracketNotes));
      setCp4AlarmIn1RelayInstalled(draftString(c.alarmIn1RelayInstalled));
      setCp4AlarmIn1Description(draftString(c.alarmIn1Description));
      setCp4AlarmIn2RelayInstalled(draftString(c.alarmIn2RelayInstalled));
      setCp4AlarmIn2Description(draftString(c.alarmIn2Description));
      setCp4HubMountingDescription(draftString(c.hubMountingDescription));
      setCp4MicrophoneMountingDescription(draftString(c.microphoneMountingDescription));
      setCp4RemoteControlMountingDescription(draftString(c.remoteControlMountingDescription));
      setCp4GpsSensorMountingDescription(draftString(c.gpsSensorMountingDescription));
      setCp4RedWireDescription(draftString(c.redWireDescription));
      setCp4BlackWireDescription(draftString(c.blackWireDescription));
      setCp4WhiteWireDescription(draftString(c.whiteWireDescription));
      setCp4MonitorMountingDescription(draftString(c.monitorMountingDescription));
      setCp4PowerConverterDescription(draftString(c.powerConverterDescription));
    } else {
      setCp4Drid("");
      setCp4Serial("");
      setCp4CameraQuantity("");
      setCp4MonitorInstalled("");
      setCp4ClientApproval("");
      setCp4CustomBracketsNeeded("");
      setCp4CustomBracketNotes("");
      setCp4AlarmIn1RelayInstalled("");
      setCp4AlarmIn1Description("");
      setCp4AlarmIn2RelayInstalled("");
      setCp4AlarmIn2Description("");
      setCp4HubMountingDescription("");
      setCp4MicrophoneMountingDescription("");
      setCp4RemoteControlMountingDescription("");
      setCp4GpsSensorMountingDescription("");
      setCp4RedWireDescription("");
      setCp4BlackWireDescription("");
      setCp4WhiteWireDescription("");
      setCp4MonitorMountingDescription("");
      setCp4PowerConverterDescription("");
    }

    const rawSsc = draft.sscSpeed;
    if (rawSsc !== undefined && rawSsc !== null && typeof rawSsc === "object" && !Array.isArray(rawSsc)) {
      const s = rawSsc as Record<string, unknown>;
      const connectionType = draftString(s.connectionType);
      setSscFields({
        connectionType: connectionType === "CAN" || connectionType === "Hardwire" ? connectionType : "",
        powerDescription: draftString(s.powerDescription),
        groundDescription: draftString(s.groundDescription),
        ignitionDescription: draftString(s.ignitionDescription),
        speedSignalDescription: draftString(s.speedSignalDescription),
        hasDirectionSignal: !!s.hasDirectionSignal,
        directionDescription: draftString(s.directionDescription),
      });
    } else {
      setSscFields({
        connectionType: "",
        powerDescription: "",
        groundDescription: "",
        ignitionDescription: "",
        speedSignalDescription: "",
        hasDirectionSignal: false,
        directionDescription: "",
      });
    }
    {
      const draftProductFiles = readUploadedProductFiles(
        (draft as { productFiles?: unknown }).productFiles ?? (draft as { productArtifacts?: unknown }).productArtifacts,
      );
      setSscConfigFile(draftProductFiles.find((f) => f.fileKey === "ssc_config") ?? null);
      setSscConfigFileError(null);
    }

    if (draft.linxup || (draft.formId && draft.formId.startsWith("linxup_")) || isLinxUpSectionKey(draft.hardwareSelection?.primary)) {
      const lx = draft.linxup as {
        vehicleType?: unknown;
        hoursMiles?: unknown;
        year?: unknown;
        powerConnectionDescription?: unknown;
        groundConnectionDescription?: unknown;
        ignitionConnectionDescription?: unknown;
        vehicleTracker?: {
          obdPortConnected?: unknown;
          installationNotes?: unknown;
          powerConnectionDescription?: unknown;
          groundConnectionDescription?: unknown;
          ignitionConnectionDescription?: unknown;
        };
        linxCam?: {
          obdPortConnected?: unknown;
          installationNotes?: unknown;
          powerConnectionDescription?: unknown;
          groundConnectionDescription?: unknown;
          ignitionConnectionDescription?: unknown;
        };
      } | undefined;
      setLinxupVehicleType(typeof lx?.vehicleType === "string" ? lx.vehicleType : "");
      setLinxupHoursMiles(typeof lx?.hoursMiles === "string" ? lx.hoursMiles : "");
      setLinxupYear(typeof lx?.year === "string" ? lx.year : "");
      setLinxupPowerConnectionDescription(typeof lx?.powerConnectionDescription === "string" ? lx.powerConnectionDescription : "");
      setLinxupGroundConnectionDescription(typeof lx?.groundConnectionDescription === "string" ? lx.groundConnectionDescription : "");
      setLinxupIgnitionConnectionDescription(
        typeof lx?.ignitionConnectionDescription === "string" ? lx.ignitionConnectionDescription : "",
      );
      const vt = lx?.vehicleTracker;
      setLinxupVtObdPortConnected(typeof vt?.obdPortConnected === "string" ? vt.obdPortConnected : "");
      setLinxupVtInstallationNotes(typeof vt?.installationNotes === "string" ? vt.installationNotes : "");
      setLinxupVtPowerConnectionDescription(
        typeof vt?.powerConnectionDescription === "string" ? vt.powerConnectionDescription : "",
      );
      setLinxupVtGroundConnectionDescription(
        typeof vt?.groundConnectionDescription === "string" ? vt.groundConnectionDescription : "",
      );
      setLinxupVtIgnitionConnectionDescription(
        typeof vt?.ignitionConnectionDescription === "string" ? vt.ignitionConnectionDescription : "",
      );
      const lc = lx?.linxCam;
      setLinxupLcObdPortConnected(typeof lc?.obdPortConnected === "string" ? lc.obdPortConnected : "");
      setLinxupLcInstallationNotes(typeof lc?.installationNotes === "string" ? lc.installationNotes : "");
      setLinxupLcPowerConnectionDescription(
        typeof lc?.powerConnectionDescription === "string" ? lc.powerConnectionDescription : "",
      );
      setLinxupLcGroundConnectionDescription(
        typeof lc?.groundConnectionDescription === "string" ? lc.groundConnectionDescription : "",
      );
      setLinxupLcIgnitionConnectionDescription(
        typeof lc?.ignitionConnectionDescription === "string" ? lc.ignitionConnectionDescription : "",
      );
    } else {
      setLinxupVehicleType("");
      setLinxupHoursMiles("");
      setLinxupYear("");
      setLinxupPowerConnectionDescription("");
      setLinxupGroundConnectionDescription("");
      setLinxupIgnitionConnectionDescription("");
      setLinxupVtObdPortConnected("");
      setLinxupVtInstallationNotes("");
      setLinxupVtPowerConnectionDescription("");
      setLinxupVtGroundConnectionDescription("");
      setLinxupVtIgnitionConnectionDescription("");
      setLinxupLcObdPortConnected("");
      setLinxupLcInstallationNotes("");
      setLinxupLcPowerConnectionDescription("");
      setLinxupLcGroundConnectionDescription("");
      setLinxupLcIgnitionConnectionDescription("");
    }

    // VAC/vehicle/PPD/CP4 photos: rebuild from saved upload metadata (`photoUploads`). Local File buffers stay empty.
    setVacPhotoFiles(emptyVacPhotoFiles());
    setPpdPhotoFiles(emptyPpdPhotoFiles());
    setPpdPhotoErrors(emptyPpdPhotoErrors());
    setCp4PhotoFiles(emptyCp4PhotoFiles());
    setCp4PhotoErrors(emptyCp4PhotoErrors());
    setLinxupAtPhotoFiles(emptyLinxupAtPhotoFiles());
    setLinxupAtPhotoErrors(emptyLinxupAtPhotoErrors());
    setLinxupVtPhotoFiles(emptyLinxupVtPhotoFiles());
    setLinxupVtPhotoErrors(emptyLinxupVtPhotoErrors());
    setLinxupLcPhotoFiles(emptyLinxupLcPhotoFiles());
    setLinxupLcPhotoErrors(emptyLinxupLcPhotoErrors());
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
      ...PPD_PHOTO_KEYS.map((k) => ppdUploadFieldFor(k)),
      ...CP4_PHOTO_KEYS.map((k) => cp4UploadFieldFor(k)),
      ...LINXUP_AT_PHOTO_KEYS.map((k) => linxupAtUploadFieldFor(k)),
      ...LINXUP_VT_PHOTO_KEYS.map((k) => linxupVtUploadFieldFor(k)),
      ...LINXUP_LC_PHOTO_KEYS.map((k) => linxupLcUploadFieldFor(k)),
    ];
    for (const k of allPhotoFieldKeys) {
      restoredMetadataByField[k] = dedupeUploadedPhotoMeta(restoredMetadataByField[k]);
    }
    photoMetadataByFieldRef.current = restoredMetadataByField;
    setPhotoMetadataByField(restoredMetadataByField);
    const restoredStatus: Partial<Record<string, "uploading" | "saved" | "failed">> = {};
    for (const photo of restoredUploads) {
      if (photo.storagePath?.trim() && photo.fieldName) {
        restoredStatus[photo.fieldName] = "saved";
      }
    }
    photoFieldPersistStatusRef.current = restoredStatus;
    setPhotoFieldPersistStatus(restoredStatus);

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

  const handleResumeAutosave = () => {
    if (!autosaveRestorePayload) return;
    const p = autosaveRestorePayload;
    const pc = (p.companyId ?? "").trim();
    const pp = (p.projectId ?? "").trim();
    autosaveRestoredClearTargetRef.current = { companyId: pc, projectId: pp };
    console.log("[restore] source: autosave");
    restoreFromDraftData(p.data, p.submissionId || generateSubmissionId());
    try {
      clearMatchingAutosave(pc, pp);
    } catch {
      // ignore localStorage cleanup errors
    }
    setAutosaveRestorePayload(null);
    setDraftNoticeMessage("Autosave restored.");
  };

  const handleDiscardAutosave = () => {
    try {
      if (autosaveRestorePayload) {
        const pc = (autosaveRestorePayload.companyId ?? "").trim();
        const pp = (autosaveRestorePayload.projectId ?? "").trim();
        clearMatchingAutosave(pc, pp);
      } else {
        const sc = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
        const sp = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
        clearMatchingAutosave(sc, sp);
      }
    } catch {
      // ignore localStorage cleanup errors
    }
    autosaveRestoredClearTargetRef.current = null;
    setAutosaveRestorePayload(null);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    void (async () => {
      const offlineResumeId = window.localStorage.getItem(INSTALLER_OFFLINE_DRAFT_ID_KEY)?.trim();
      if (offlineResumeId) {
        let restoredOffline = false;
        try {
          const draft = await getOfflineJobCardDraftById<OfflineJobCardDraftPayload["data"]>(offlineResumeId);
          if (!cancelled && draft) {
            try {
              const sc = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
              const sp = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
              clearMatchingAutosave(sc, sp);
            } catch {
              // ignore
            }
            setAutosaveRestorePayload(null);
            try {
              window.localStorage.removeItem(INSTALLER_OFFLINE_DRAFT_ID_KEY);
            } catch {
              // ignore
            }
            setTimeout(() => {
              console.log("[restore] source: offline-draft");
              offlineDraftIdRef.current = draft.offlineDraftId;
              restoreFromDraftData(draft.data, draft.submissionId || generateSubmissionId());
              const localJson = draft.attachments?.ppdJsonFile;
              if (localJson?.data) {
                const restoredFile = new File([localJson.data], localJson.name || "config.json", {
                  type: localJson.type || "application/json",
                  lastModified: localJson.lastModified || Date.now(),
                });
                setPpdJsonLocalFile(restoredFile);
                setPpdJsonFileName(localJson.name || "config.json");
                setPpdJsonUploadedConfig(null);
                const productKey =
                  String(draft.data?.hardwareSelection?.primary || "").trim() || "PPD";
                const slotId = productFileSlotId({
                  productKey,
                  fileKey: PPD_JSON_FILE_KEY,
                });
                setProductFileSlots((prev) => ({
                  ...prev,
                  [slotId]: {
                    fileKey: PPD_JSON_FILE_KEY,
                    productKey,
                    localFiles: [restoredFile],
                    uploaded: [],
                  },
                }));
              }
              setDraftNoticeMessage("Offline draft restored (text fields). Re-upload photos before submitting.");
            }, 0);
            restoredOffline = true;
          }
        } catch {
          // fall through to cloud resume / autosave
        }
        if (restoredOffline) return;
      }

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
            setTimeout(() => {
              console.log("[restore] source: supabase");
              restoreFromDraftData(resumePayload, restoredId);
              const uploadedName =
                typeof resumePayload.ppd?.jsonConfigFile?.fileName === "string"
                  ? resumePayload.ppd.jsonConfigFile.fileName
                  : "";
              if (uploadedName) {
                setDraftNoticeMessage(`JSON file already uploaded: ${uploadedName}`);
              }
            }, 0);
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
          setTimeout(() => {
            console.log("[restore] source: supabase");
            restoreFromDraftData(match.data, restoredId);
            const uploadedName =
              typeof match.data.ppd?.jsonConfigFile?.fileName === "string" ? match.data.ppd.jsonConfigFile.fileName : "";
            if (uploadedName) {
              setDraftNoticeMessage(`JSON file already uploaded: ${uploadedName}`);
            }
          }, 0);
        }
        window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_ID_KEY);
      } catch {
        window.localStorage.removeItem(JOB_CARD_RESUME_DRAFT_ID_KEY);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (restoredFromDraftRef.current) return;
    if (installerNameUserEditedRef.current) return;
    const suggestion =
      authUserContext.displayName?.trim() || authUserContext.email?.trim() || "";
    if (!suggestion) return;
    setCoreJob((prev) => {
      if (restoredFromDraftRef.current) return prev;
      if (installerNameUserEditedRef.current) return prev;
      if (prev.installerName.trim()) return prev;
      return { ...prev, installerName: suggestion };
    });
  }, [authLoading, authUserContext.displayName, authUserContext.email]);

  useEffect(() => {
    autosaveCheckedRef.current = true;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const offline = !window.navigator.onLine;
      setIsOffline(offline);
      if (!offline) setOfflineProjectDetailsWarning(null);
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const loadCompanyName = async () => {
      setCompanyContextReady(false);
      const companyId = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
      if (!companyId) {
        if (!cancelled) {
          setSelectedCompanyId(null);
          setSelectedCompanyName(null);
          setCompanyContextReady(true);
        }
        return;
      }
      if (!cancelled) setSelectedCompanyId(companyId);
      if (!window.navigator.onLine) {
        try {
          const snap = await getBestStarterSnapshotForOffline();
          if (cancelled) return;
          const company = snap?.companies.find((c) => c.id === companyId);
          setSelectedCompanyName(company?.name?.trim() || null);
          setCompanyContextReady(true);
        } catch {
          if (!cancelled) {
            setSelectedCompanyName(null);
            setCompanyContextReady(true);
          }
        }
        return;
      }
      try {
        const { data, error } = await supabase
          .from("companies")
          .select("name")
          .eq("id", companyId)
          .maybeSingle<{ name: string }>();
        if (cancelled) return;
        if (!error && data) {
          setSelectedCompanyName(data.name?.trim() || null);
        } else {
          setSelectedCompanyName(null);
        }
        setCompanyContextReady(true);
      } catch {
        if (!cancelled) {
          setSelectedCompanyName(null);
          setCompanyContextReady(true);
        }
      }
    };
    void loadCompanyName();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (typeof window === "undefined") return;
      if (!selectedIncludeEffective(selectedSections, "PPD") || isOffline) {
        if (!cancelled) setPpdProjectCustomerId(null);
        return;
      }
      const projectId = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
      if (!projectId) {
        if (!cancelled) setPpdProjectCustomerId(null);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("projects")
          .select("customer_id")
          .eq("id", projectId)
          .maybeSingle<{ customer_id: string | null }>();
        if (cancelled) return;
        if (error) {
          setPpdProjectCustomerId(null);
          return;
        }
        setPpdProjectCustomerId(data?.customer_id ?? null);
      } catch {
        if (!cancelled) setPpdProjectCustomerId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSections, isOffline, selectedIncludeEffective]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (restoredFromDraftRef.current) return;

    let cancelled = false;
    const offlineCacheWarning =
      "Project details were not cached. Open this project online once before using offline.";

    const applyProjectAutofill = async () => {
      const selectedProjectId = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
      const selectedCompanyId = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
      if (!selectedProjectId) return;

      if (!window.navigator.onLine) {
        try {
          const snap = await getBestStarterSnapshotForOffline();
          const list = snap?.projectsByCompanyId[selectedCompanyId] || [];
          const cached = list.find((p) => p.id === selectedProjectId);
          if (cancelled) return;
          if (!cached) {
            setOfflineProjectDetailsWarning(offlineCacheWarning);
            return;
          }
          let projectCustomer = cached.displayCustomerName?.trim() || "";
          if (projectCustomer === "—") projectCustomer = "";
          const projectLocation = cached.displayLocation?.trim() || "";
          if (!projectCustomer && !projectLocation) {
            setOfflineProjectDetailsWarning(offlineCacheWarning);
            return;
          }
          setOfflineProjectDetailsWarning(null);
          setCoreJob((prev) => {
            if (restoredFromDraftRef.current) return prev;
            const nextCustomer = prev.customer.trim() ? prev.customer : projectCustomer;
            const nextLocation = prev.location.trim() ? prev.location : projectLocation;
            if (nextCustomer === prev.customer && nextLocation === prev.location) return prev;
            return { ...prev, customer: nextCustomer, location: nextLocation };
          });
        } catch {
          if (!cancelled) setOfflineProjectDetailsWarning(offlineCacheWarning);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from("projects")
          .select("customer_id, customer_name, location")
          .eq("id", selectedProjectId)
          .maybeSingle<ProjectAutofillRow>();
        if (error || cancelled || !data) return;
        let projectCustomer = data.customer_name?.trim() || "";
        let projectLocation = data.location?.trim() || "";

        let contactNameFromCustomer = "";
        let contactNumberFromCustomer = "";
        let contactEmailFromCustomer = "";

        if (data.customer_id) {
          let customerRow: CustomerLookupRow | null = null;
          const withEmail = await supabase
            .from("customers")
            .select("customer_name, full_address, site_contact_name, contact_number, contact_email")
            .eq("id", data.customer_id)
            .maybeSingle<CustomerLookupRow>();
          if (!withEmail.error && withEmail.data) {
            customerRow = withEmail.data;
          } else {
            // Pre-migration DBs may lack contact_email — retry without it so autofill still works.
            const withoutEmail = await supabase
              .from("customers")
              .select("customer_name, full_address, site_contact_name, contact_number")
              .eq("id", data.customer_id)
              .maybeSingle<CustomerLookupRow>();
            if (!withoutEmail.error && withoutEmail.data) customerRow = withoutEmail.data;
          }
          if (customerRow) {
            const customerNameFromCustomer = customerRow.customer_name?.trim() || "";
            const locationFromCustomer = customerRow.full_address?.trim() || "";
            if (customerNameFromCustomer) projectCustomer = customerNameFromCustomer;
            if (locationFromCustomer) projectLocation = locationFromCustomer;
            contactNameFromCustomer = customerRow.site_contact_name?.trim() || "";
            contactNumberFromCustomer = customerRow.contact_number?.trim() || "";
            contactEmailFromCustomer = customerRow.contact_email?.trim() || "";
          }
        }
        if (!projectCustomer && !projectLocation) return;

        setCoreJob((prev) => {
          if (restoredFromDraftRef.current) return prev;
          const nextCustomer = prev.customer.trim() ? prev.customer : projectCustomer;
          const nextLocation = prev.location.trim() ? prev.location : projectLocation;
          const nextPrimaryContact =
            (prev.primaryContact ?? "").trim() ? (prev.primaryContact ?? "") : contactNameFromCustomer;
          const nextContactNumber =
            (prev.contactNumber ?? "").trim() ? (prev.contactNumber ?? "") : contactNumberFromCustomer;
          const nextContactEmail =
            (prev.contactEmail ?? "").trim() ? (prev.contactEmail ?? "") : contactEmailFromCustomer;
          if (
            nextCustomer === prev.customer &&
            nextLocation === prev.location &&
            nextPrimaryContact === (prev.primaryContact ?? "") &&
            nextContactNumber === (prev.contactNumber ?? "") &&
            nextContactEmail === (prev.contactEmail ?? "")
          )
            return prev;
          return {
            ...prev,
            customer: nextCustomer,
            location: nextLocation,
            primaryContact: nextPrimaryContact,
            contactNumber: nextContactNumber,
            contactEmail: nextContactEmail,
          };
        });
      } catch {
        // ignore project autofill errors
      }
    };

    void applyProjectAutofill();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadProjectExternalRecipients = async () => {
      try {
        if (typeof window !== "undefined" && !window.navigator.onLine) {
          if (!cancelled) setProjectExternalRecipientEmails([]);
          return;
        }
        const { projectId } = await resolveSelectedOrDefaultContextIds();
        if (!projectId || cancelled) return;
        const { data, error } = await supabase
          .from("projects")
          .select("external_recipient_emails")
          .eq("id", projectId)
          .maybeSingle<{ external_recipient_emails: unknown }>();
        if (cancelled || error || !data) return;
        setProjectExternalRecipientEmails(normalizeRecipientEmails(data.external_recipient_emails));
      } catch {
        if (!cancelled) setProjectExternalRecipientEmails([]);
      }
    };
    void loadProjectExternalRecipients();
    return () => {
      cancelled = true;
    };
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

  function buildCurrentDraftData(photoSnapshot: ReturnType<typeof getPhotoPersistenceSnapshot>): StoredJobCardDraft["data"] {
    const normalizedCoreJob = normalizeUppercaseCoreJob(coreJob);
    const cp4DraftPayload: StoredCp4DraftPayload | undefined = selectedSections.includes("CP4")
      ? {
          drid: cp4Drid,
          serial: cp4Serial,
          cameraQuantity: cp4CameraQuantity,
          monitorInstalled: cp4MonitorInstalled,
          clientApproval: cp4ClientApproval,
          customBracketsNeeded: cp4CustomBracketsNeeded,
          customBracketNotes: cp4CustomBracketNotes,
          alarmIn1RelayInstalled: cp4AlarmIn1RelayInstalled,
          alarmIn1Description: cp4AlarmIn1Description,
          alarmIn2RelayInstalled: cp4AlarmIn2RelayInstalled,
          alarmIn2Description: cp4AlarmIn2Description,
          hubMountingDescription: cp4HubMountingDescription,
          microphoneMountingDescription: cp4MicrophoneMountingDescription,
          remoteControlMountingDescription: cp4RemoteControlMountingDescription,
          gpsSensorMountingDescription: cp4GpsSensorMountingDescription,
          redWireDescription: cp4RedWireDescription,
          blackWireDescription: cp4BlackWireDescription,
          whiteWireDescription: cp4WhiteWireDescription,
          monitorMountingDescription: cp4MonitorMountingDescription,
          powerConverterDescription: cp4PowerConverterDescription,
        }
      : undefined;

    return {
      coreJob: normalizedCoreJob,
      hardwareSelection: { primary: effectivePrimary, hasAdditional, additional: selectedAdditional },
      ...(selectedPrimaryForm
        ? { formId: selectedPrimaryForm.id, submissionType: selectedPrimaryForm.submissionType }
        : {}),
      ...(isLinxUpProfile
        ? {
            linxup: {
              vehicleType: linxupVehicleType,
              hoursMiles: linxupHoursMiles,
              year: linxupYear,
              ...(isLinxUpAssetTracker
                ? {
                    powerConnectionDescription: linxupPowerConnectionDescription,
                    groundConnectionDescription: linxupGroundConnectionDescription,
                    ignitionConnectionDescription: linxupIgnitionConnectionDescription,
                  }
                : {}),
              ...(isLinxUpVehicleTracker
                ? {
                    vehicleTracker: {
                      obdPortConnected: linxupVtObdPortConnected,
                      installationNotes: linxupVtInstallationNotes,
                      ...(linxupVtObdPortConnected === "No"
                        ? {
                            powerConnectionDescription: linxupVtPowerConnectionDescription,
                            groundConnectionDescription: linxupVtGroundConnectionDescription,
                            ignitionConnectionDescription: linxupVtIgnitionConnectionDescription,
                          }
                        : {}),
                    },
                  }
                : {}),
              ...(isLinxUpLinxCam
                ? {
                    linxCam: {
                      obdPortConnected: linxupLcObdPortConnected,
                      ...(linxupLcObdPortConnected === "No"
                        ? {
                            installationNotes: linxupLcInstallationNotes,
                            powerConnectionDescription: linxupLcPowerConnectionDescription,
                            groundConnectionDescription: linxupLcGroundConnectionDescription,
                            ignitionConnectionDescription: linxupLcIgnitionConnectionDescription,
                          }
                        : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
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
      ppd: {
        hubSerial: ppdHubSerial,
        cameraLocations: [...ppdCameraLocations],
        cameraSerialsByLocation: { ...ppdCameraSerialsByLocation },
        monitorInstalled: ppdMonitorInstalled,
        customBracketsNeeded: ppdCustomBracketsNeeded,
        customBracketNotes: ppdCustomBracketNotes,
        clientApproval: ppdClientApproval,
        jsonFileName: ppdJsonLocalFile?.name.trim() || ppdJsonFileName.trim(),
        ...(ppdJsonUploadedConfig ? { jsonConfigFile: ppdJsonUploadedConfig } : {}),
        relaysUsedForSpeedControl: ppdRelaysUsedForSpeedControl,
        redWireDescription: ppdRedWireDescription,
        blackWireDescription: ppdBlackWireDescription,
        yellowWireDescription: ppdYellowWireDescription,
        greyWireDescription: ppdGreyWireDescription,
        blueWireDescription: ppdBlueWireDescription,
        powerConverterDescription: ppdPowerConverterDescription,
        redAlarmOutDescription: ppdRedAlarmOutDescription,
        yellowAlarmOutDescription: ppdYellowAlarmOutDescription,
        blackAlarmGroundDescription: ppdBlackAlarmGroundDescription,
      },
      ...(cp4DraftPayload ? { cp4: cp4DraftPayload } : {}),
      ...(selectedSections.includes("blaxtair_ssc_speed") ? { sscSpeed: { ...sscFields } } : {}),
      photoUploads: photoSnapshot.photoUploads,
      productFiles: [
        ...mergeLegacyPpdIntoProductFiles({
          productKey: PPD_PRODUCT_KEY,
          productFiles: flattenUploadedProductFiles(productFileSlots),
          ppd: {
            jsonConfigFile: ppdJsonUploadedConfig || undefined,
          },
          baseFormId: "ppd",
        }),
        ...(sscConfigFile ? [sscConfigFile] : []),
      ],
      ...(blaxtairSystem ? { installedProductSystems: [blaxtairSystem] } : {}),
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
  }

  useLayoutEffect(() => {
    autosaveRestorePayloadRef.current = autosaveRestorePayload;
    submissionStatusAutosaveRef.current = submissionStatus;
    emailSendStatusAutosaveRef.current = emailSendStatus;
    buildAutosaveBaseRef.current = () => ({
      submissionId,
      savedAt: new Date().toISOString(),
      selectedSections: [...selectedSections],
      data: buildCurrentDraftData(getPhotoPersistenceSnapshot()),
    });
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      if (!autosaveCheckedRef.current) return;
      if (autosavePersistSuppressedRef.current) return;
      if (autosaveRestorePayloadRef.current) return;
      const sub = submissionStatusAutosaveRef.current;
      if (sub === "Submitted") return;
      void (async () => {
        try {
          if (autosavePersistSuppressedRef.current) return;
          const base = buildAutosaveBaseRef.current();
          const companyId = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
          const projectId = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
          let companyName = "";
          let projectName = "";
          try {
            const snap = await getBestStarterSnapshotForOffline();
            if (autosavePersistSuppressedRef.current) return;
            if (snap && companyId) {
              companyName = snap.companies.find((c) => c.id === companyId)?.name?.trim() || "";
              const projects = snap.projectsByCompanyId[companyId] || [];
              projectName = projects.find((p) => p.id === projectId)?.project_name?.trim() || "";
            }
          } catch {
            // ignore snapshot errors; metadata stays partial
          }
          if (autosavePersistSuppressedRef.current) return;
          const normalizedCore = normalizeUppercaseCoreJob(base.data.coreJob);
          const payload: JobCardAutosavePayload = {
            ...base,
            companyId: companyId || undefined,
            projectId: projectId || undefined,
            companyName: companyName || undefined,
            projectName: projectName || undefined,
            customer: normalizedCore.customer.trim(),
            location: normalizedCore.location.trim(),
          };
          if (autosavePersistSuppressedRef.current) return;
          const formId =
            (base.data.formId || "").trim() ||
            getFormDefinitionBySectionKey(base.data.hardwareSelection?.primary)?.id ||
            "";
          // Require company+project; for form-scoped isolation require formId when a primary is chosen.
          // Never write a shared project key after a form is selected (prevents LinxUp product collisions).
          if (!companyId || !projectId) return;
          if (base.data.hardwareSelection?.primary && !formId) return;
          window.localStorage.setItem(getAutosaveKey(companyId, projectId, formId || undefined), JSON.stringify(payload));
        } catch {
          // ignore localStorage write errors
        }
      })();
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasLocalFiles =
        Object.values(vehiclePictureFiles).some((arr) => arr.length > 0) ||
        Object.values(vacPhotoFiles).some((arr) => arr.length > 0) ||
        Object.values(ppdPhotoFiles).some((arr) => arr.length > 0) ||
        Object.values(cp4PhotoFiles).some((arr) => arr.length > 0) ||
        Object.values(linxupAtPhotoFiles).some((arr) => arr.length > 0) ||
        Object.values(linxupVtPhotoFiles).some((arr) => arr.length > 0) ||
        Object.values(linxupLcPhotoFiles).some((arr) => arr.length > 0);
      const hasUploading = pendingPhotoUploadsRef.current > 0;
      const hasFailed = Object.values(photoFieldPersistStatusRef.current).some((s) => s === "failed");
      if (!hasLocalFiles && !hasUploading && !hasFailed) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [
    vehiclePictureFiles,
    vacPhotoFiles,
    ppdPhotoFiles,
    cp4PhotoFiles,
    linxupAtPhotoFiles,
    linxupVtPhotoFiles,
    linxupLcPhotoFiles,
  ]);

  const handleSaveDraft = async (): Promise<boolean> => {
    lastSaveSucceededRef.current = false;
    if (isOffline) {
      setDraftSaveStage("failed");
      setDraftNoticeMessage("Offline mode: cloud draft save disabled. Use 'Save to this device'.");
      return false;
    }

    const formIdForLog =
      (selectedPrimaryForm?.id || "").trim() ||
      getFormDefinitionBySectionKey(effectivePrimary)?.id ||
      "";

    try {
      if (pendingPhotoUploadsRef.current > 0) {
        setDraftSaveStage("uploading_photos");
        setDraftNoticeMessage("Uploading photos…");
        await waitForPendingPhotoUploads();
      }

      const failedCount = Object.values(photoFieldPersistStatusRef.current).filter((s) => s === "failed").length;
      if (failedCount > 0 || pendingPhotoUploadsRef.current > 0) {
        setDraftSaveStage("failed");
        setDraftNoticeMessage(
          `Draft save blocked: ${failedCount || pendingPhotoUploadsRef.current} photo upload(s) failed or still pending. Fix failed photos and try again.`,
        );
        logDraftPhotoSaveDiagnostic({
          stage: "blocked_failed_uploads",
          draftId: submissionId,
          formId: formIdForLog,
          userId: authUserContext.userId,
          existingRefCount: 0,
          incomingRefCount: 0,
          mergedRefCount: 0,
          uploadFailureCount: failedCount,
          errorCategory: "upload_failed",
        });
        return false;
      }

      setDraftSaveStage("saving_form");
      setDraftNoticeMessage("Saving form data…");

      const contextIds = await resolveSelectedOrDefaultContextIds();

      // Load existing cloud draft BEFORE building thin in-memory snapshot authority.
      const { data: existingRow, error: existingErr } = await supabase
        .from("job_card_drafts")
        .select("payload")
        .eq("submission_id", submissionId)
        .maybeSingle<{ payload: StoredJobCardDraft["data"] | null }>();
      if (existingErr) {
        throw new Error(existingErr.message || "Failed to load existing draft for photo merge.");
      }
      const cloudUploads = extractPhotoUploadsFromPayload(existingRow?.payload || null);
      const cloudProductFiles = extractProductFilesFromPayload(existingRow?.payload || null);

      const photoSnapshot = getPhotoPersistenceSnapshot();
      const memoryUploads = photoSnapshot.photoUploads || [];
      const mergeResult = mergeDurablePhotoUploads({
        cloudUploads,
        memoryUploads,
        newlyUploaded: [],
      });

      if (mergeResult.thinPayloadProtected) {
        logDraftPhotoSaveDiagnostic({
          stage: "thin_payload_protected",
          draftId: submissionId,
          projectId: contextIds.projectId,
          formId: formIdForLog,
          userId: authUserContext.userId,
          existingRefCount: mergeResult.existingRefCount,
          incomingRefCount: mergeResult.incomingRefCount,
          mergedRefCount: mergeResult.mergedRefCount,
          thinPayloadProtected: true,
        });
      }

      // Sync merged durable refs into in-memory metadata so later autosave/resume keep them.
      const restoredMetadataByField = emptyPhotoMetadataByField();
      for (const photo of mergeResult.merged) {
        const key = photo.fieldName as UploadFieldName;
        if (key in restoredMetadataByField) {
          restoredMetadataByField[key].push(photo);
        }
      }
      for (const k of Object.keys(restoredMetadataByField) as UploadFieldName[]) {
        restoredMetadataByField[k] = dedupeUploadedPhotoMeta(restoredMetadataByField[k]);
      }
      photoMetadataByFieldRef.current = restoredMetadataByField;
      setPhotoMetadataByField(restoredMetadataByField);
      const syncedSnapshot = getPhotoPersistenceSnapshot();

      const normalizedCoreJob = normalizeUppercaseCoreJob(coreJob);
      let draftDataForSave = applyMergedPhotoUploadsToPayload(
        buildCurrentDraftData(syncedSnapshot) as Record<string, unknown>,
        mergeResult.merged,
      ) as StoredJobCardDraft["data"];

      const memoryProductFiles = [
        ...mergeLegacyPpdIntoProductFiles({
          productKey: PPD_PRODUCT_KEY,
          productFiles: flattenUploadedProductFiles(productFileSlots),
          ppd: { jsonConfigFile: ppdJsonUploadedConfig || undefined },
          baseFormId: "ppd",
        }),
        ...(sscConfigFile ? [sscConfigFile] : []),
      ];
      const productFileMerge = mergeDurableProductFiles({
        cloudFiles: cloudProductFiles,
        memoryFiles: memoryProductFiles,
        allowClear:
          flattenUploadedProductFiles(productFileSlots).length === 0 &&
          !ppdJsonLocalFile &&
          !ppdJsonUploadedConfig &&
          !ppdJsonFileName.trim() &&
          !sscConfigFile,
      });
      draftDataForSave = {
        ...draftDataForSave,
        productFiles: productFileMerge.merged,
      };
      if (productFileMerge.thinPayloadProtected && productFileMerge.merged[0]) {
        const kept = productFileMerge.merged.find(
          (f) => f.fileKey === PPD_JSON_FILE_KEY && f.productKey === PPD_PRODUCT_KEY,
        );
        if (kept && draftDataForSave.ppd) {
          draftDataForSave = {
            ...draftDataForSave,
            ppd: {
              ...draftDataForSave.ppd,
              jsonFileName: kept.originalFileName,
              jsonConfigFile: ppdJsonConfigFromUploadedProductFile(kept),
            },
          };
        }
      }

      if (sharedPpdProductSelected && draftDataForSave.ppd) {
        const { data: projRow, error: projErr } = await supabase
          .from("projects")
          .select("customer_id")
          .eq("id", contextIds.projectId)
          .maybeSingle<{ customer_id: string | null }>();
        const customerId = !projErr && projRow ? projRow.customer_id?.trim() || null : null;
        const nj = normalizeUppercaseCoreJob(coreJob);
        const make = nj.equipmentMake.trim();
        const model = nj.equipmentModel.trim();
        const unitNum = nj.unitNumber.trim();
        if (ppdJsonLocalFile) {
          const { storagePath, publicUrl, uploadedAt } = await uploadPpdJsonFileToStorage(ppdJsonLocalFile, {
            companyId: contextIds.companyId,
            projectId: contextIds.projectId,
            customerId,
            unitNumber: unitNum || "unit",
            make,
            model,
            notes: "",
          });
          const uploadedConfig: JobCardPpdJsonConfigFile = {
            fileName: ppdJsonLocalFile.name,
            storagePath,
            publicUrl,
            customerId,
            projectId: contextIds.projectId,
            companyId: contextIds.companyId,
            make,
            model,
            unitNumber: unitNum,
            notes: "",
            uploadedAt,
          };
          setPpdJsonUploadedConfig(uploadedConfig);
          setPpdJsonFileName(ppdJsonLocalFile.name);
          setPpdJsonLocalFile(null);
          {
            const slotId = productFileSlotId({
              productKey: PPD_PRODUCT_KEY,
              fileKey: PPD_JSON_FILE_KEY,
            });
            const uploadedProductFile = {
              fileKey: PPD_JSON_FILE_KEY,
              productKey: PPD_PRODUCT_KEY,
              originalFileName: uploadedConfig.fileName,
              storageBucket: "customer-site-files",
              storagePath: uploadedConfig.storagePath,
              mimeType: "application/json",
              sizeBytes: 0,
              uploadedAt: uploadedConfig.uploadedAt,
              displayLabel: "PPD JSON configuration",
              baseFormId: "ppd",
              downloadUrl: uploadedConfig.publicUrl,
              includeInReview: true,
              includeInEmail: true,
              make: uploadedConfig.make,
              model: uploadedConfig.model,
              unitNumber: uploadedConfig.unitNumber,
              notes: uploadedConfig.notes,
              companyId: uploadedConfig.companyId,
              projectId: uploadedConfig.projectId,
              customerId: uploadedConfig.customerId,
            } satisfies UploadedProductFile;
            setProductFileSlots((prev) => ({
              ...prev,
              [slotId]: {
                fileKey: PPD_JSON_FILE_KEY,
                productKey: PPD_PRODUCT_KEY,
                localFiles: [],
                uploaded: [uploadedProductFile],
              },
            }));
            draftDataForSave = {
              ...draftDataForSave,
              ppd: {
                ...draftDataForSave.ppd,
                jsonFileName: ppdJsonLocalFile.name,
                jsonConfigFile: uploadedConfig,
              },
              productFiles: mergeLegacyPpdIntoProductFiles({
                productKey: PPD_PRODUCT_KEY,
                productFiles: [
                  ...flattenUploadedProductFiles(productFileSlots).filter(
                    (a) =>
                      !(
                        a.productKey === PPD_PRODUCT_KEY &&
                        a.fileKey === PPD_JSON_FILE_KEY
                      ),
                  ),
                  uploadedProductFile,
                ],
                ppd: { jsonConfigFile: uploadedConfig },
                baseFormId: "ppd",
              }),
            };
          }
        } else if (ppdJsonUploadedConfig) {
          draftDataForSave = {
            ...draftDataForSave,
            ppd: {
              ...draftDataForSave.ppd,
              jsonFileName: ppdJsonUploadedConfig.fileName || draftDataForSave.ppd.jsonFileName,
              jsonConfigFile: {
                ...ppdJsonUploadedConfig,
                customerId,
                projectId: contextIds.projectId,
                companyId: contextIds.companyId,
                make,
                model,
                unitNumber: unitNum,
                notes: "",
              },
            },
          };
        }
      }

      // Re-assert merged photos after PPD mutations.
      draftDataForSave = applyMergedPhotoUploadsToPayload(
        draftDataForSave as Record<string, unknown>,
        mergeResult.merged,
      ) as StoredJobCardDraft["data"];

      const updatedAt = new Date().toISOString();
      const nextDraft: StoredJobCardDraft = {
        submissionId,
        customer: normalizedCoreJob.customer.trim() || "—",
        unitNumber: normalizedCoreJob.unitNumber.trim() || "—",
        savedAt: updatedAt,
        data: draftDataForSave,
      };

      const { error } = await supabase.from("job_card_drafts").upsert(
        {
          submission_id: submissionId,
          company_id: contextIds.companyId,
          project_id: contextIds.projectId,
          customer: nextDraft.customer,
          unit_number: nextDraft.unitNumber,
          payload: draftDataForSave,
          updated_at: updatedAt,
        },
        { onConflict: "submission_id" },
      );
      if (error) throw error;

      setDraftSaveStage("verifying");
      setDraftNoticeMessage("Verifying saved draft…");

      const { data: verifiedRow, error: verifyErr } = await supabase
        .from("job_card_drafts")
        .select("payload")
        .eq("submission_id", submissionId)
        .maybeSingle<{ payload: StoredJobCardDraft["data"] | null }>();
      if (verifyErr) {
        throw new Error(verifyErr.message || "Failed to verify saved draft.");
      }
      const expectedPaths = mergeResult.merged.map((m) => m.storagePath);
      const verification = verifyMergedStoragePathsPresent(verifiedRow?.payload, expectedPaths);
      if (!verification.ok) {
        logDraftPhotoSaveDiagnostic({
          stage: "verification_mismatch",
          draftId: submissionId,
          projectId: contextIds.projectId,
          formId: formIdForLog,
          userId: authUserContext.userId,
          existingRefCount: mergeResult.existingRefCount,
          incomingRefCount: mergeResult.incomingRefCount,
          mergedRefCount: mergeResult.mergedRefCount,
          thinPayloadProtected: mergeResult.thinPayloadProtected,
          errorCategory: "verification_mismatch",
        });
        setDraftSaveStage("failed");
        setDraftNoticeMessage(
          `Draft save verification failed: ${verification.missing.length} photo reference(s) missing after write. Try Save Draft again.`,
        );
        return false;
      }

      try {
        saveDraftLocally(nextDraft);
      } catch {
        // ignore local cache sync errors when cloud save succeeds
      }
      const activeOfflineDraftId = offlineDraftIdRef.current?.trim();
      if (activeOfflineDraftId) {
        try {
          await deleteOfflineJobCardDraft(activeOfflineDraftId);
          console.log("[offline-draft] deleted after cloud save", activeOfflineDraftId);
          offlineDraftIdRef.current = null;
          try {
            window.localStorage.removeItem(INSTALLER_OFFLINE_DRAFT_ID_KEY);
          } catch {
            // ignore
          }
        } catch (cleanupErr) {
          console.warn("[offline-draft] Failed to delete local draft after cloud save", cleanupErr);
        }
      }
      clearMatchingAutosave(contextIds.companyId.trim(), contextIds.projectId.trim());
      clearRestoredAutosaveAfterPersist(autosaveRestoredClearTargetRef, "cloud-draft", { log: false });
      console.log("[autosave] cleared after cloud save");

      logDraftPhotoSaveDiagnostic({
        stage: "saved",
        draftId: submissionId,
        projectId: contextIds.projectId,
        formId: formIdForLog,
        userId: authUserContext.userId,
        existingRefCount: mergeResult.existingRefCount,
        incomingRefCount: mergeResult.incomingRefCount,
        mergedRefCount: mergeResult.mergedRefCount,
        thinPayloadProtected: mergeResult.thinPayloadProtected,
      });

      lastSaveSucceededRef.current = true;
      setDraftSaveStage("saved");
      setDraftNoticeMessage(
        mergeResult.thinPayloadProtected
          ? `Draft saved. Preserved ${mergeResult.existingRefCount} cloud photo(s); merged total ${mergeResult.mergedRefCount}.`
          : "Draft saved to cloud.",
      );
      return true;
    } catch (error) {
      const details = describeSupabaseError(error);
      console.error("Supabase draft save failed:", error);
      logDraftPhotoSaveDiagnostic({
        stage: "failed",
        draftId: submissionId,
        formId: formIdForLog,
        userId: authUserContext.userId,
        existingRefCount: 0,
        incomingRefCount: 0,
        mergedRefCount: 0,
        errorCategory: "draft_write_or_network",
      });
      setDraftSaveStage("failed");
      try {
        const photoSnapshot = getPhotoPersistenceSnapshot();
        const normalizedCoreJob = normalizeUppercaseCoreJob(coreJob);
        const fallbackDraft: StoredJobCardDraft = {
          submissionId,
          customer: normalizedCoreJob.customer.trim() || "—",
          unitNumber: normalizedCoreJob.unitNumber.trim() || "—",
          savedAt: new Date().toISOString(),
          data: buildCurrentDraftData(photoSnapshot),
        };
        saveDraftLocally(fallbackDraft);
        setDraftNoticeMessage(details ? `Draft saved locally. Cloud save failed: ${details}` : "Draft saved locally.");
      } catch {
        setDraftNoticeMessage(details ? `Unable to save draft. ${details}` : "Unable to save draft locally.");
      }
      return false;
    }
  };

  const handleSaveToDevice = async (event?: MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    console.log("[offline-save] clicked");
    const generation = ++saveToDeviceGenerationRef.current;
    setLocalDeviceSaveError(null);
    const photoSnapshot = getPhotoPersistenceSnapshot();
    const draftData = buildCurrentDraftData(photoSnapshot);
    const savedAt = new Date().toISOString();
    const previousOfflineId = offlineDraftIdRef.current?.trim() || null;
    const offlineDraftId = previousOfflineId || `offline-${generateId()}`;
    offlineDraftIdRef.current = offlineDraftId;
    const normalizedCore = normalizeUppercaseCoreJob(coreJob);
    const companyId =
      typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "" : "";
    const projectId =
      typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "" : "";
    let companyName = "";
    let projectName = "";
    try {
      const snap = await getBestStarterSnapshotForOffline();
      if (snap && companyId) {
        companyName = snap.companies.find((c) => c.id === companyId)?.name?.trim() || "";
        const projects = snap.projectsByCompanyId[companyId] || [];
        projectName = projects.find((p) => p.id === projectId)?.project_name?.trim() || "";
      }
    } catch {
      // ignore starter snapshot errors; metadata stays partial
    }
    const payload: OfflineJobCardDraftPayload = {
      offlineDraftId,
      submissionId,
      savedAt,
      selectedSections: [...selectedSections],
      data: draftData,
      photoRestoreSupported: false,
      companyId,
      projectId,
      companyName: companyName || undefined,
      projectName: projectName || undefined,
      customer: normalizedCore.customer.trim(),
      location: normalizedCore.location.trim(),
      unitNumber: normalizedCore.unitNumber.trim(),
      workOrderNumber: normalizedCore.workOrder.trim(),
      attachments: ppdJsonLocalFile
        ? {
            ppdJsonFile: {
              name: ppdJsonLocalFile.name,
              type: ppdJsonLocalFile.type,
              lastModified: ppdJsonLocalFile.lastModified,
              data: ppdJsonLocalFile,
            },
          }
        : undefined,
    };
    console.log("[offline-save] payload built", { offlineDraftId, submissionId, companyId, projectId });
    try {
      await saveOfflineJobCardDraft(payload);
      if (generation !== saveToDeviceGenerationRef.current) {
        console.log("[offline-save] error", "stale generation — ignoring success");
        return;
      }
      console.log("[offline-save] saved", { offlineDraftId, submissionId });
      setLocalDeviceSaveError(null);
      offlineDraftIdRef.current = offlineDraftId;
      clearRestoredAutosaveAfterPersist(autosaveRestoredClearTargetRef, "save-to-device");
      try {
        clearMatchingAutosave(companyId, projectId);
      } catch {
        // ignore
      }
      setAutosaveRestorePayload(null);
      setDraftNoticeMessage("Saved to this device");
    } catch (error) {
      if (generation !== saveToDeviceGenerationRef.current) {
        console.log("[offline-save] error", "stale generation — ignoring failure");
        return;
      }
      console.log("[offline-save] error", error instanceof Error ? error.message : String(error));
      if (!previousOfflineId) {
        offlineDraftIdRef.current = null;
      }
      setLocalDeviceSaveError("Unable to save on this device.");
      setDraftNoticeMessage("Unable to save on this device.");
    }
  };

  const handleExitToHome = () => {
    if (typeof window !== "undefined") {
      const companyId = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
      const projectId = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
      if (companyId && projectId) {
        router.push(`/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}`);
        return;
      }
    }
    router.push("/");
  };

  const handleSaveDraftAndExit = async () => {
    if (hasCoreOrVehicleInfo) {
      const ok = await handleSaveDraft();
      if (!ok) return;
    }
    handleExitToHome();
  };

  const handleExitWithoutSavingRequest = () => {
    setExitWithoutSavingOpen(true);
  };

  const handleExitWithoutSavingDismiss = () => {
    setExitWithoutSavingOpen(false);
  };

  const handleExitWithoutSavingConfirm = () => {
    setExitWithoutSavingOpen(false);
    autosavePersistSuppressedRef.current = true;
    try {
      const cc = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "" : "";
      const pp = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "" : "";
      clearMatchingAutosave(cc, pp);
      clearRestoredAutosaveAfterPersist(autosaveRestoredClearTargetRef, "exit-without-saving", { log: false });
      console.log("[autosave] cleared after exit without saving");
    } catch {
      // ignore localStorage cleanup errors
    }
    handleExitToHome();
  };

  const hl = (key: string) => reviewHighlights.has(key);
  const fieldInputClass = (key: string) =>
    `${inputClassName}${hl(key) ? " border-red-500 ring-2 ring-red-100 dark:border-red-500 dark:ring-red-900/40" : ""}`;
  const fieldSelectClass = (key: string) =>
    `${selectClassName}${hl(key) ? " border-red-500 ring-2 ring-red-100 dark:border-red-500 dark:ring-red-900/40" : ""}`;
  const fieldLabelClass = (key: string) => `${labelClassName}${hl(key) ? " text-red-600" : ""}`;
  const requiredHint = (key: string) =>
    hl(key) ? (
      <p className="mt-1 text-sm font-medium text-red-600 dark:text-red-400">
        {key === "blaxtair-equipment"
          ? "Confirm every camera and the monitor, including their required photos, before continuing."
          : key.includes("-wire-") && !key.endsWith("-description")
            ? "Add a clear photo of this wire connection."
            : key.endsWith("-description") && key.includes("-wire-")
              ? "Describe the connection point for this wire."
              : key.startsWith("photo-")
          ? "Add at least one clear photo here."
          : key === "cp4-cameraQuantity"
            ? "Select 1–4 cameras."
            : key === "ppd-jsonFile"
              ? "Select a .json configuration file."
              : key === "ppd-jsonOffline"
                ? "Connect to the internet to upload the PPD JSON file."
                : key.startsWith("product-file-")
                  ? "Upload the required installation file for this product."
                  : "Enter a value or make a selection to continue."}
      </p>
    ) : null;

  const photoPickClass = (photoKey: string, required: boolean, complete: boolean) => {
    let extra = "";
    if (hl(photoKey)) extra = " border-red-500 border-dashed ring-2 ring-red-100 dark:border-red-500 dark:ring-red-900/40";
    else if (required && complete) extra = " border-emerald-500 border-dashed";
    return `${photoPickClassName}${extra}`;
  };
  const isJobCardSubmitted = submissionStatus === "Submitted";
  const isEmailSent = emailSendStatus === "success";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const shouldTrapBrowserBack = hasCoreOrVehicleInfo && !isJobCardSubmitted;
    if (!shouldTrapBrowserBack) return;

    const historyState = { jobCardBrowserBackGuard: true as const };

    const onPopState = () => {
      setExitWithoutSavingOpen(true);
      window.history.pushState(historyState, "", window.location.href);
    };

    window.history.pushState(historyState, "", window.location.href);
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [hasCoreOrVehicleInfo, isJobCardSubmitted]);

  return (
    <div className="min-h-screen bg-slate-50 pb-32 sm:pb-36 md:pb-10">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:space-y-6 sm:px-5 sm:py-6">
        <header className={headerCardClassName}>
          <div className="flex flex-col items-start gap-1.5">
            <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Installer Sheetz</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-blue-700 ring-1 ring-inset ring-blue-200/80 sm:px-3 sm:py-1">
                <IconDocument className="h-3.5 w-3.5 shrink-0" />
                DRAFT
              </span>
            </div>
            <p className="text-base font-medium leading-tight text-gray-600">Digital Job Cards for Field Technicians</p>
            <p className="mt-2">
              <a href="/offline-drafts" className="text-sm font-semibold text-blue-700 hover:underline">
                Saved on this device
              </a>
            </p>
          </div>
        </header>

        {draftSaveStage !== "idle" && draftSaveStage !== "saved" ? (
          <div
            className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
              draftSaveStage === "failed"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-amber-200 bg-amber-50 text-amber-950"
            }`}
            role="status"
          >
            {draftSaveStageLabel(draftSaveStage) || "Working…"}
          </div>
        ) : null}
        {draftNoticeMessage && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
              draftSaveStage === "failed"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-blue-200 bg-blue-50 text-blue-900"
            }`}
            role="status"
          >
            {draftNoticeMessage}
          </div>
        )}
        {offlineProjectDetailsWarning ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950" role="status">
            {offlineProjectDetailsWarning}
          </div>
        ) : null}
        {localDeviceSaveError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" role="alert">
            {localDeviceSaveError}
          </div>
        ) : null}

        {isOffline ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status">
            Offline mode — your job card is being saved on this device.
          </div>
        ) : null}

        {autosaveRestorePayload ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">Resume your previous job card?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleResumeAutosave}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={handleDiscardAutosave}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                Discard
              </button>
            </div>
          </div>
        ) : null}

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
              Review the formatted email below. Sending is optional — the job card is already submitted. Use Review &amp;
              Send Email to confirm recipients and send mode before delivery.
            </p>
            <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-900 shadow-inner">
              <div>
                <span className="font-semibold text-gray-600">Subject:</span>{" "}
                <span className="break-words font-medium">{emailSubmissionPreview.model.subject}</span>
              </div>
              <div>
                <p className="mb-2 font-semibold text-gray-600">Body</p>
                <EmailPreviewBody model={emailSubmissionPreview.model} />
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {!isEmailSent && (
                <button
                  type="button"
                  className={btnPrimaryClassName}
                  disabled={emailSendStatus === "sending" || !pendingEmailPayload || !isJobCardSubmitted}
                  onClick={() => setEmailSendModalOpen(true)}
                >
                  Review &amp; Send Email
                </button>
              )}
              {isEmailSent && (
                <p className="text-sm font-semibold text-emerald-800" role="status">
                  Email sent successfully.
                </p>
              )}
              {postSubmitSyncWarning && (
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200" role="alert">
                  {postSubmitSyncWarning}
                </p>
              )}
              {emailSendStatus === "error" && emailSendErrorMessage && (
                <p className="text-sm font-semibold text-red-700 dark:text-red-300" role="alert">
                  {emailSendErrorMessage}
                </p>
              )}
              {isJobCardSubmitted && (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    <p className="font-semibold">
                      Submission status: Submitted
                      {isEmailSent
                        ? lastEmailMode === "internal_only"
                          ? " — emailed internally only"
                          : " — emailed to client + internal"
                        : ", not emailed"}
                    </p>
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
        {!companyContextReady || productsLoading ? (
          <section className={cardClassName}>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Loading project company before form selection…
            </p>
          </section>
        ) : !hasCompanyProducts ? (
          <section className={cardClassName}>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              This company is not assigned any forms. Select a Powerfleet, Matrix, or LinxUp
              project — or ask an admin to configure products under Form Admin.
            </p>
          </section>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <SectionStatusCard title="Core Job Info" tone="blue" icon={IconClipboard} status={coreSectionStatus} />
          <SectionStatusCard
            title={isLinxUpProfile ? "Product Selection" : "Hardware Selection"}
            tone="green"
            icon={IconChip}
            status={hardwareSectionStatus}
          />
          {!isLinxUpProfile && hardwareStatusSections.map((section) => {
            const sectionLabel = productLabel(section) || section;
            return (
            <SectionStatusCard
              key={section}
              title={["VAC4", "CP4", "PPD"].includes(section) ? `${section} hardware` : `${sectionLabel} Section`}
              tone={section === "VAC4" ? "purple" : "green"}
              icon={section === "VAC4" ? IconGear : IconChip}
              status={section === "VAC4" ? vac4SectionStatus : "In Progress"}
            />
            );
          })}
        </div>

        {reviewBlockMessage && (
          <div
            className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 text-base font-semibold text-red-900 shadow-sm dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
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

            {!isLinxUpProfile && (
              <div id="field-core-workOrder">
                <label className={fieldLabelClass("core-workOrder")}>
                  Work Order #
                  <RequiredMark />
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-4 inline-flex items-center text-base font-semibold text-gray-500">
                    WO-
                  </span>
                  <input
                    className={`${fieldInputClass("core-workOrder")} pl-16`}
                    placeholder="12345"
                    value={coreJob.workOrder}
                    onChange={(e) => setCoreField("workOrder", e.target.value)}
                  />
                </div>
                {requiredHint("core-workOrder")}
              </div>
            )}

            {!isLinxUpProfile && (
              <div id="field-core-serviceAppointment">
                <label className={fieldLabelClass("core-serviceAppointment")}>
                  Service Appointment #
                  <RequiredMark />
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-4 inline-flex items-center text-base font-semibold text-gray-500">
                    SA-
                  </span>
                  <input
                    className={`${fieldInputClass("core-serviceAppointment")} pl-16`}
                    placeholder="98765"
                    value={coreJob.serviceAppointment}
                    onChange={(e) => setCoreField("serviceAppointment", e.target.value)}
                  />
                </div>
                {requiredHint("core-serviceAppointment")}
              </div>
            )}

            {isLinxUpProfile && (
              <div id="field-core-primaryContact">
                <label className={labelClassName}>Primary Contact</label>
                <input
                  className={inputClassName}
                  placeholder="exp: Jane Doe"
                  value={coreJob.primaryContact ?? ""}
                  onChange={(e) => setCoreField("primaryContact", e.target.value)}
                />
              </div>
            )}

            {isLinxUpProfile && (
              <div id="field-core-contactNumber">
                <label className={labelClassName}>Contact Number</label>
                <input
                  className={inputClassName}
                  placeholder="exp: 555-123-4567"
                  value={coreJob.contactNumber ?? ""}
                  onChange={(e) => setCoreField("contactNumber", e.target.value)}
                />
              </div>
            )}

            {isLinxUpProfile && (
              <div id="field-core-contactEmail">
                <label className={fieldLabelClass("core-contactEmail")}>Contact Email</label>
                <input
                  className={fieldInputClass("core-contactEmail")}
                  placeholder="exp: jane@acme.com"
                  type="email"
                  value={coreJob.contactEmail ?? ""}
                  onChange={(e) => {
                    setCoreField("contactEmail", e.target.value);
                    clearFieldHighlight("core-contactEmail");
                  }}
                />
                {requiredHint("core-contactEmail")}
              </div>
            )}

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
            {isLinxUpProfile && (
              <div id="field-linxup-year">
                <label className={labelClassName}>Year</label>
                <input
                  className={inputClassName}
                  placeholder="exp: 2022"
                  value={linxupYear}
                  onChange={(e) => setLinxupYear(e.target.value)}
                />
              </div>
            )}

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
                {isLinxUpProfile ? "Serial/VIN" : "Serial #"}
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
                {isLinxUpProfile ? "Asset Number" : "Unit #"}
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

            {isLinxUpProfile ? (
              <div id="field-linxup-vehicleType">
                <label className={fieldLabelClass("linxup-vehicleType")}>
                  Vehicle Type
                  <RequiredMark />
                </label>
                <select
                  className={fieldSelectClass("linxup-vehicleType")}
                  value={linxupVehicleType}
                  onChange={(e) => {
                    setLinxupVehicleType(e.target.value);
                    clearFieldHighlight("linxup-vehicleType");
                  }}
                >
                  <option value="" className="text-gray-400">
                    Select vehicle type
                  </option>
                  {LINXUP_VEHICLE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt}>{opt}</option>
                  ))}
                </select>
                {requiredHint("linxup-vehicleType")}
              </div>
            ) : (
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
            )}

            {isLinxUpProfile ? (
              <div id="field-linxup-hoursMiles">
                <label className={fieldLabelClass("linxup-hoursMiles")}>
                  Hours / Miles
                  <RequiredMark />
                </label>
                <input
                  className={fieldInputClass("linxup-hoursMiles")}
                  placeholder="exp: 1234"
                  value={linxupHoursMiles}
                  onChange={(e) => {
                    setLinxupHoursMiles(e.target.value);
                    clearFieldHighlight("linxup-hoursMiles");
                  }}
                />
                {requiredHint("linxup-hoursMiles")}
              </div>
            ) : (
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
            )}

            {!isLinxUpProfile && vac4DriveType === "Electric" && (
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

            {!isLinxUpProfile && vac4VehicleType === "Other" && (
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

          <div className="space-y-6">
            <div id="field-photo-vehicleFront">
              <label className={fieldLabelClass("photo-vehicleFront")}>
                Vehicle front photo(s)
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
                {PHOTO_UPLOAD_LABEL_MULTI}
              </label>
              <PhotoUploadFeedback count={vehiclePictureCounts.vehicleFront} names={vehiclePictureFileNames.vehicleFront} />
              <PhotoThumbnailGrid
                files={vehiclePictureFiles.vehicleFront}
                remotePhotos={remoteThumbsForVehicleField("vehicleFront")}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField("vehicleFront", remote)}
                onRemoveLocal={(file) => removeLocalPhotoFromField("vehicleFront", file)}
              />
              <PhotoUploadedBadge
                show={vehiclePictureCounts.vehicleFront >= 1}
                status={photoFieldPersistStatus.vehicleFront || null}
              />
              <PhotoFieldError message={vehiclePictureErrors.vehicleFront} />
              {requiredHint("photo-vehicleFront")}
            </div>

            <div id="field-photo-vehicleSide">
              <label className={fieldLabelClass("photo-vehicleSide")}>
                Vehicle side photo(s)
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
                {PHOTO_UPLOAD_LABEL_MULTI}
              </label>
              <PhotoUploadFeedback count={vehiclePictureCounts.vehicleSide} names={vehiclePictureFileNames.vehicleSide} />
              <PhotoThumbnailGrid
                files={vehiclePictureFiles.vehicleSide}
                remotePhotos={remoteThumbsForVehicleField("vehicleSide")}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField("vehicleSide", remote)}
                onRemoveLocal={(file) => removeLocalPhotoFromField("vehicleSide", file)}
              />
              <PhotoUploadedBadge
                show={vehiclePictureCounts.vehicleSide >= 1}
                status={photoFieldPersistStatus.vehicleSide || null}
              />
              <PhotoFieldError message={vehiclePictureErrors.vehicleSide} />
              {requiredHint("photo-vehicleSide")}
            </div>

            <div id="field-photo-vehicleRear">
              <label className={fieldLabelClass("photo-vehicleRear")}>
                Vehicle rear photo(s)
                <RequiredMark />
              </label>
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
                className={photoPickClass("photo-vehicleRear", true, vehiclePictureCounts.vehicleRear >= 1)}
              >
                {PHOTO_UPLOAD_LABEL_MULTI}
              </label>
              <PhotoUploadFeedback count={vehiclePictureCounts.vehicleRear} names={vehiclePictureFileNames.vehicleRear} />
              <PhotoThumbnailGrid
                files={vehiclePictureFiles.vehicleRear}
                remotePhotos={remoteThumbsForVehicleField("vehicleRear")}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField("vehicleRear", remote)}
                onRemoveLocal={(file) => removeLocalPhotoFromField("vehicleRear", file)}
              />
              <PhotoUploadedBadge
                show={vehiclePictureCounts.vehicleRear >= 1}
                status={photoFieldPersistStatus.vehicleRear || null}
              />
              <PhotoFieldError message={vehiclePictureErrors.vehicleRear} />
              {requiredHint("photo-vehicleRear")}
            </div>
          </div>
        </section>

        {/* Product / Hardware Selection (normalized product-config) */}
        {isVehicleInfoComplete ? (
          <section className={cardClassName}>
            <FormSectionHeader
              title={isLinxUpProfile || companyOffersLinxUp ? "Product Selection" : "Hardware Selection"}
              tone="green"
            />

            <div className="space-y-5">
              <div id="field-hw-primary">
                <label className={fieldLabelClass("hw-primary")}>
                  {companyOffersLinxUp
                    ? "Product / Install Type"
                    : "Primary Hardware / Install Type"}
                  <RequiredMark />
                </label>
                <select
                  className={fieldSelectClass("hw-primary")}
                  value={effectivePrimary}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next) {
                      const allowed = selectableProducts.some((p) => p.sectionKey === next);
                      if (!allowed) {
                        setDraftNoticeMessage("That form is not assigned to this company.");
                        return;
                      }
                    }
                    setPrimary(next);
                    setAdditional((prev) => {
                      const allowedKeys = getAllowedAdditionalProducts(resolvedProducts, next).map(
                        (p) => p.sectionKey,
                      );
                      return prev.filter((item) => item !== next && allowedKeys.includes(item));
                    });
                    clearFieldHighlight("hw-primary");
                  }}
                >
                  <option value="" className="text-gray-400">
                    Select product / install type
                  </option>
                  {(primaryFormOptions.length > 0 ? primaryFormOptions : []).map((form) => (
                    <option key={form.sectionKey} value={form.sectionKey}>
                      {form.label}
                    </option>
                  ))}
                </select>
                {requiredHint("hw-primary")}
              </div>

              <div id="field-hw-hasAdditional">
                <label className={fieldLabelClass("hw-hasAdditional")}>
                  {isLinxUpProfile || companyOffersLinxUp
                    ? "Is any additional device being installed?"
                    : "Is any additional hardware being installed?"}
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
                    {isLinxUpProfile || companyOffersLinxUp
                      ? "Any additional device?"
                      : "Any additional hardware?"}
                  </option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
                {requiredHint("hw-hasAdditional")}
              </div>

              {hasAdditional === "Yes" && effectivePrimary ? (
                <div className="space-y-3 pt-1">
                  {availableAdditional.map((type) => (
                    <label key={type} className={checkboxRowClassName}>
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 rounded border-2 border-gray-400 text-blue-600 focus:ring-blue-500"
                        checked={additional.includes(type)}
                        onChange={() => toggleAdditional(type)}
                      />
                      <span>{productLabel(type) || type}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : (
          <section className={cardClassName}>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Complete all required Vehicle Information fields before selecting{" "}
              {companyOffersLinxUp ? "a product" : "hardware"}.
            </p>
          </section>
        )}

        {effectivePrimary && !hasAnsweredAdditionalHardwareQuestion && (
          <section className={cardClassName}>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {isLinxUpProfile || companyOffersLinxUp
                ? 'Please answer "Is any additional device being installed?" to continue.'
                : 'Please answer "Is any additional hardware being installed?" to continue.'}
            </p>
          </section>
        )}

        {hasAnsweredAdditionalHardwareQuestion && isLinxUpVehicleTracker && (
          <section className={`${cardClassName} space-y-6`}>
            <FormSectionHeader title="Vehicle Tracker" tone="green" />

            <div id={`field-${linxupVtPhotoIssueKey("vehicleTrackerTag")}`}>
              <label className={fieldLabelClass(linxupVtPhotoIssueKey("vehicleTrackerTag"))}>
                Picture of vehicle tracker tag
                <RequiredMark />
              </label>
              <input
                id="linxup-vt-photo-vehicleTrackerTag"
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/jpg"
                onChange={(e) => void applyLinxupVtPhotoUpload("vehicleTrackerTag", e)}
              />
              <label
                htmlFor="linxup-vt-photo-vehicleTrackerTag"
                className={photoPickClass(linxupVtPhotoIssueKey("vehicleTrackerTag"), true, linxupVtPc.vehicleTrackerTag >= 1)}
              >
                {PHOTO_UPLOAD_LABEL_SINGLE}
              </label>
              <PhotoUploadFeedback count={linxupVtPc.vehicleTrackerTag} names={linxupVtPhotoFileNames.vehicleTrackerTag} />
              <PhotoThumbnailGrid
                files={linxupVtPhotoFiles.vehicleTrackerTag}
                remotePhotos={remoteThumbsForLinxupVtField("vehicleTrackerTag")}
                onRemoveLocal={(file) => removeLinxupVtLocalPhoto("vehicleTrackerTag", file)}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupVtUploadFieldFor("vehicleTrackerTag"), remote)}
              />
              <PhotoUploadedBadge show={linxupVtPc.vehicleTrackerTag >= 1} />
              <PhotoFieldError message={linxupVtPhotoErrors.vehicleTrackerTag} />
              {requiredHint(linxupVtPhotoIssueKey("vehicleTrackerTag"))}
            </div>

            <div id="field-linxup-vt-obdPortConnected">
              <label className={fieldLabelClass("linxup-vt-obdPortConnected")}>
                Is tracker connected via OBD Port?
                <RequiredMark />
              </label>
              <select
                className={fieldSelectClass("linxup-vt-obdPortConnected")}
                value={linxupVtObdPortConnected}
                onChange={(e) => {
                  setLinxupVtObdPortConnected(e.target.value);
                  clearFieldHighlight("linxup-vt-obdPortConnected");
                }}
              >
                <option value="">Select Yes or No</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
              {requiredHint("linxup-vt-obdPortConnected")}
            </div>

            {linxupVtObdPortConnected === "Yes" && (
              <>
                <div id={`field-${linxupVtPhotoIssueKey("greenActivityLight")}`}>
                  <label className={labelClassName}>
                    Picture of green activity light (optional)
                  </label>
                  <input
                    id="linxup-vt-photo-greenActivityLight-obd"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupVtPhotoUpload("greenActivityLight", e)}
                  />
                  <label
                    htmlFor="linxup-vt-photo-greenActivityLight-obd"
                    className={photoPickClass(linxupVtPhotoIssueKey("greenActivityLight"), false, linxupVtPc.greenActivityLight >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupVtPc.greenActivityLight} names={linxupVtPhotoFileNames.greenActivityLight} />
                  <PhotoThumbnailGrid
                    files={linxupVtPhotoFiles.greenActivityLight}
                    remotePhotos={remoteThumbsForLinxupVtField("greenActivityLight")}
                    onRemoveLocal={(file) => removeLinxupVtLocalPhoto("greenActivityLight", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupVtUploadFieldFor("greenActivityLight"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupVtPc.greenActivityLight >= 1} />
                  <PhotoFieldError message={linxupVtPhotoErrors.greenActivityLight} />
                </div>

                <div id={`field-${linxupVtPhotoIssueKey("installation")}`}>
                  <label className={fieldLabelClass(linxupVtPhotoIssueKey("installation"))}>
                    Picture of installation
                    <RequiredMark />
                  </label>
                  <input
                    id="linxup-vt-photo-installation"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupVtPhotoUpload("installation", e)}
                  />
                  <label
                    htmlFor="linxup-vt-photo-installation"
                    className={photoPickClass(linxupVtPhotoIssueKey("installation"), true, linxupVtPc.installation >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupVtPc.installation} names={linxupVtPhotoFileNames.installation} />
                  <PhotoThumbnailGrid
                    files={linxupVtPhotoFiles.installation}
                    remotePhotos={remoteThumbsForLinxupVtField("installation")}
                    onRemoveLocal={(file) => removeLinxupVtLocalPhoto("installation", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupVtUploadFieldFor("installation"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupVtPc.installation >= 1} />
                  <PhotoFieldError message={linxupVtPhotoErrors.installation} />
                  {requiredHint(linxupVtPhotoIssueKey("installation"))}
                </div>

                <div id="field-linxup-vt-installationNotes">
                  <label className={fieldLabelClass("linxup-vt-installationNotes")}>
                    Installation notes
                    <RequiredMark />
                  </label>
                  <textarea
                    className={`${fieldInputClass("linxup-vt-installationNotes")} min-h-[80px] resize-y py-3`}
                    value={linxupVtInstallationNotes}
                    placeholder="exp: OBD plug seated under dash, cable secured"
                    onChange={(e) => {
                      setLinxupVtInstallationNotes(e.target.value);
                      clearFieldHighlight("linxup-vt-installationNotes");
                    }}
                  />
                  {requiredHint("linxup-vt-installationNotes")}
                </div>
              </>
            )}

            {linxupVtObdPortConnected === "No" && (
              <>
                <div id={`field-${linxupVtPhotoIssueKey("powerConnection")}`} className="space-y-3">
                  <label className={fieldLabelClass(linxupVtPhotoIssueKey("powerConnection"))}>
                    Power connection and picture
                    <RequiredMark />
                  </label>
                  <input
                    id="linxup-vt-photo-powerConnection"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupVtPhotoUpload("powerConnection", e)}
                  />
                  <label
                    htmlFor="linxup-vt-photo-powerConnection"
                    className={photoPickClass(linxupVtPhotoIssueKey("powerConnection"), true, linxupVtPc.powerConnection >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupVtPc.powerConnection} names={linxupVtPhotoFileNames.powerConnection} />
                  <PhotoThumbnailGrid
                    files={linxupVtPhotoFiles.powerConnection}
                    remotePhotos={remoteThumbsForLinxupVtField("powerConnection")}
                    onRemoveLocal={(file) => removeLinxupVtLocalPhoto("powerConnection", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupVtUploadFieldFor("powerConnection"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupVtPc.powerConnection >= 1} />
                  <PhotoFieldError message={linxupVtPhotoErrors.powerConnection} />
                  {requiredHint(linxupVtPhotoIssueKey("powerConnection"))}
                  <div id="field-linxup-vt-powerConnectionDescription">
                    <label className={fieldLabelClass("linxup-vt-powerConnectionDescription")}>
                      Power connection note
                      <RequiredMark />
                    </label>
                    <textarea
                      className={`${fieldInputClass("linxup-vt-powerConnectionDescription")} min-h-[80px] resize-y py-3`}
                      value={linxupVtPowerConnectionDescription}
                      placeholder="exp: Fused power tap at battery positive"
                      onChange={(e) => {
                        setLinxupVtPowerConnectionDescription(e.target.value);
                        clearFieldHighlight("linxup-vt-powerConnectionDescription");
                      }}
                    />
                    {requiredHint("linxup-vt-powerConnectionDescription")}
                  </div>
                </div>

                <div id={`field-${linxupVtPhotoIssueKey("groundConnection")}`} className="space-y-3">
                  <label className={fieldLabelClass(linxupVtPhotoIssueKey("groundConnection"))}>
                    Ground connection and picture
                    <RequiredMark />
                  </label>
                  <input
                    id="linxup-vt-photo-groundConnection"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupVtPhotoUpload("groundConnection", e)}
                  />
                  <label
                    htmlFor="linxup-vt-photo-groundConnection"
                    className={photoPickClass(linxupVtPhotoIssueKey("groundConnection"), true, linxupVtPc.groundConnection >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupVtPc.groundConnection} names={linxupVtPhotoFileNames.groundConnection} />
                  <PhotoThumbnailGrid
                    files={linxupVtPhotoFiles.groundConnection}
                    remotePhotos={remoteThumbsForLinxupVtField("groundConnection")}
                    onRemoveLocal={(file) => removeLinxupVtLocalPhoto("groundConnection", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupVtUploadFieldFor("groundConnection"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupVtPc.groundConnection >= 1} />
                  <PhotoFieldError message={linxupVtPhotoErrors.groundConnection} />
                  {requiredHint(linxupVtPhotoIssueKey("groundConnection"))}
                  <div id="field-linxup-vt-groundConnectionDescription">
                    <label className={fieldLabelClass("linxup-vt-groundConnectionDescription")}>
                      Ground connection note
                      <RequiredMark />
                    </label>
                    <textarea
                      className={`${fieldInputClass("linxup-vt-groundConnectionDescription")} min-h-[80px] resize-y py-3`}
                      value={linxupVtGroundConnectionDescription}
                      placeholder="exp: Chassis ground stud near battery box"
                      onChange={(e) => {
                        setLinxupVtGroundConnectionDescription(e.target.value);
                        clearFieldHighlight("linxup-vt-groundConnectionDescription");
                      }}
                    />
                    {requiredHint("linxup-vt-groundConnectionDescription")}
                  </div>
                </div>

                <div id={`field-${linxupVtPhotoIssueKey("ignitionConnection")}`} className="space-y-3">
                  <label className={fieldLabelClass(linxupVtPhotoIssueKey("ignitionConnection"))}>
                    Ignition connection and picture
                    <RequiredMark />
                  </label>
                  <input
                    id="linxup-vt-photo-ignitionConnection"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupVtPhotoUpload("ignitionConnection", e)}
                  />
                  <label
                    htmlFor="linxup-vt-photo-ignitionConnection"
                    className={photoPickClass(linxupVtPhotoIssueKey("ignitionConnection"), true, linxupVtPc.ignitionConnection >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupVtPc.ignitionConnection} names={linxupVtPhotoFileNames.ignitionConnection} />
                  <PhotoThumbnailGrid
                    files={linxupVtPhotoFiles.ignitionConnection}
                    remotePhotos={remoteThumbsForLinxupVtField("ignitionConnection")}
                    onRemoveLocal={(file) => removeLinxupVtLocalPhoto("ignitionConnection", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupVtUploadFieldFor("ignitionConnection"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupVtPc.ignitionConnection >= 1} />
                  <PhotoFieldError message={linxupVtPhotoErrors.ignitionConnection} />
                  {requiredHint(linxupVtPhotoIssueKey("ignitionConnection"))}
                  <div id="field-linxup-vt-ignitionConnectionDescription">
                    <label className={fieldLabelClass("linxup-vt-ignitionConnectionDescription")}>
                      Ignition connection note
                      <RequiredMark />
                    </label>
                    <textarea
                      className={`${fieldInputClass("linxup-vt-ignitionConnectionDescription")} min-h-[80px] resize-y py-3`}
                      value={linxupVtIgnitionConnectionDescription}
                      placeholder="exp: Ignition-switched circuit at fuse panel"
                      onChange={(e) => {
                        setLinxupVtIgnitionConnectionDescription(e.target.value);
                        clearFieldHighlight("linxup-vt-ignitionConnectionDescription");
                      }}
                    />
                    {requiredHint("linxup-vt-ignitionConnectionDescription")}
                  </div>
                </div>

                <div id={`field-${linxupVtPhotoIssueKey("greenActivityLight")}`}>
                  <label className={labelClassName}>
                    Picture of green activity light (optional)
                  </label>
                  <input
                    id="linxup-vt-photo-greenActivityLight-hardwire"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupVtPhotoUpload("greenActivityLight", e)}
                  />
                  <label
                    htmlFor="linxup-vt-photo-greenActivityLight-hardwire"
                    className={photoPickClass(linxupVtPhotoIssueKey("greenActivityLight"), false, linxupVtPc.greenActivityLight >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupVtPc.greenActivityLight} names={linxupVtPhotoFileNames.greenActivityLight} />
                  <PhotoThumbnailGrid
                    files={linxupVtPhotoFiles.greenActivityLight}
                    remotePhotos={remoteThumbsForLinxupVtField("greenActivityLight")}
                    onRemoveLocal={(file) => removeLinxupVtLocalPhoto("greenActivityLight", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupVtUploadFieldFor("greenActivityLight"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupVtPc.greenActivityLight >= 1} />
                  <PhotoFieldError message={linxupVtPhotoErrors.greenActivityLight} />
                </div>

                <div id={`field-${linxupVtPhotoIssueKey("finalInstall")}`}>
                  <label className={fieldLabelClass(linxupVtPhotoIssueKey("finalInstall"))}>
                    Picture of final installation
                    <RequiredMark />
                  </label>
                  <input
                    id="linxup-vt-photo-finalInstall"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupVtPhotoUpload("finalInstall", e)}
                  />
                  <label
                    htmlFor="linxup-vt-photo-finalInstall"
                    className={photoPickClass(linxupVtPhotoIssueKey("finalInstall"), true, linxupVtPc.finalInstall >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupVtPc.finalInstall} names={linxupVtPhotoFileNames.finalInstall} />
                  <PhotoThumbnailGrid
                    files={linxupVtPhotoFiles.finalInstall}
                    remotePhotos={remoteThumbsForLinxupVtField("finalInstall")}
                    onRemoveLocal={(file) => removeLinxupVtLocalPhoto("finalInstall", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupVtUploadFieldFor("finalInstall"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupVtPc.finalInstall >= 1} />
                  <PhotoFieldError message={linxupVtPhotoErrors.finalInstall} />
                  {requiredHint(linxupVtPhotoIssueKey("finalInstall"))}
                </div>

                <div id="field-linxup-vt-installationNotes">
                  <label className={fieldLabelClass("linxup-vt-installationNotes")}>
                    Installation notes
                    <RequiredMark />
                  </label>
                  <textarea
                    className={`${fieldInputClass("linxup-vt-installationNotes")} min-h-[80px] resize-y py-3`}
                    value={linxupVtInstallationNotes}
                    placeholder="exp: Hardwired under dash, cable secured away from pedals"
                    onChange={(e) => {
                      setLinxupVtInstallationNotes(e.target.value);
                      clearFieldHighlight("linxup-vt-installationNotes");
                    }}
                  />
                  {requiredHint("linxup-vt-installationNotes")}
                </div>
              </>
            )}
          </section>
        )}

        {hasAnsweredAdditionalHardwareQuestion && isLinxUpLinxCam && (
          <section className={`${cardClassName} space-y-6`}>
            <FormSectionHeader title="LinxCam" tone="green" />

            <div id={`field-${linxupLcPhotoIssueKey("linxCamTag")}`}>
              <label className={fieldLabelClass(linxupLcPhotoIssueKey("linxCamTag"))}>
                Picture of LinxCam tag
                <RequiredMark />
              </label>
              <input
                id="linxup-lc-photo-linxCamTag"
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/jpg"
                onChange={(e) => void applyLinxupLcPhotoUpload("linxCamTag", e)}
              />
              <label
                htmlFor="linxup-lc-photo-linxCamTag"
                className={photoPickClass(linxupLcPhotoIssueKey("linxCamTag"), true, linxupLcPc.linxCamTag >= 1)}
              >
                {PHOTO_UPLOAD_LABEL_SINGLE}
              </label>
              <PhotoUploadFeedback count={linxupLcPc.linxCamTag} names={linxupLcPhotoFileNames.linxCamTag} />
              <PhotoThumbnailGrid
                files={linxupLcPhotoFiles.linxCamTag}
                remotePhotos={remoteThumbsForLinxupLcField("linxCamTag")}
                onRemoveLocal={(file) => removeLinxupLcLocalPhoto("linxCamTag", file)}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupLcUploadFieldFor("linxCamTag"), remote)}
              />
              <PhotoUploadedBadge show={linxupLcPc.linxCamTag >= 1} />
              <PhotoFieldError message={linxupLcPhotoErrors.linxCamTag} />
              {requiredHint(linxupLcPhotoIssueKey("linxCamTag"))}
            </div>

            <div id="field-linxup-lc-obdPortConnected">
              <label className={fieldLabelClass("linxup-lc-obdPortConnected")}>
                Is LinxCam connected via OBD Port?
                <RequiredMark />
              </label>
              <select
                className={fieldSelectClass("linxup-lc-obdPortConnected")}
                value={linxupLcObdPortConnected}
                onChange={(e) => {
                  setLinxupLcObdPortConnected(e.target.value);
                  clearFieldHighlight("linxup-lc-obdPortConnected");
                }}
              >
                <option value="">Select Yes or No</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
              {requiredHint("linxup-lc-obdPortConnected")}
            </div>

            {linxupLcObdPortConnected === "Yes" && (
              <>
                <div id={`field-${linxupLcPhotoIssueKey("greenActivityLight")}`}>
                  <label className={labelClassName}>
                    Picture of green activity light (optional)
                  </label>
                  <input
                    id="linxup-lc-photo-greenActivityLight-obd"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupLcPhotoUpload("greenActivityLight", e)}
                  />
                  <label
                    htmlFor="linxup-lc-photo-greenActivityLight-obd"
                    className={photoPickClass(linxupLcPhotoIssueKey("greenActivityLight"), false, linxupLcPc.greenActivityLight >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupLcPc.greenActivityLight} names={linxupLcPhotoFileNames.greenActivityLight} />
                  <PhotoThumbnailGrid
                    files={linxupLcPhotoFiles.greenActivityLight}
                    remotePhotos={remoteThumbsForLinxupLcField("greenActivityLight")}
                    onRemoveLocal={(file) => removeLinxupLcLocalPhoto("greenActivityLight", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupLcUploadFieldFor("greenActivityLight"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupLcPc.greenActivityLight >= 1} />
                  <PhotoFieldError message={linxupLcPhotoErrors.greenActivityLight} />
                </div>

                <div id={`field-${linxupLcPhotoIssueKey("installation")}`}>
                  <label className={fieldLabelClass(linxupLcPhotoIssueKey("installation"))}>
                    Picture of installation
                    <RequiredMark />
                  </label>
                  <input
                    id="linxup-lc-photo-installation"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupLcPhotoUpload("installation", e)}
                  />
                  <label
                    htmlFor="linxup-lc-photo-installation"
                    className={photoPickClass(linxupLcPhotoIssueKey("installation"), true, linxupLcPc.installation >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupLcPc.installation} names={linxupLcPhotoFileNames.installation} />
                  <PhotoThumbnailGrid
                    files={linxupLcPhotoFiles.installation}
                    remotePhotos={remoteThumbsForLinxupLcField("installation")}
                    onRemoveLocal={(file) => removeLinxupLcLocalPhoto("installation", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupLcUploadFieldFor("installation"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupLcPc.installation >= 1} />
                  <PhotoFieldError message={linxupLcPhotoErrors.installation} />
                  {requiredHint(linxupLcPhotoIssueKey("installation"))}
                </div>
              </>
            )}

            {linxupLcObdPortConnected === "No" && (
              <>
                <div id={`field-${linxupLcPhotoIssueKey("powerConnection")}`} className="space-y-3">
                  <label className={fieldLabelClass(linxupLcPhotoIssueKey("powerConnection"))}>
                    Power connection and picture
                    <RequiredMark />
                  </label>
                  <input
                    id="linxup-lc-photo-powerConnection"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupLcPhotoUpload("powerConnection", e)}
                  />
                  <label
                    htmlFor="linxup-lc-photo-powerConnection"
                    className={photoPickClass(linxupLcPhotoIssueKey("powerConnection"), true, linxupLcPc.powerConnection >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupLcPc.powerConnection} names={linxupLcPhotoFileNames.powerConnection} />
                  <PhotoThumbnailGrid
                    files={linxupLcPhotoFiles.powerConnection}
                    remotePhotos={remoteThumbsForLinxupLcField("powerConnection")}
                    onRemoveLocal={(file) => removeLinxupLcLocalPhoto("powerConnection", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupLcUploadFieldFor("powerConnection"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupLcPc.powerConnection >= 1} />
                  <PhotoFieldError message={linxupLcPhotoErrors.powerConnection} />
                  {requiredHint(linxupLcPhotoIssueKey("powerConnection"))}
                  <div id="field-linxup-lc-powerConnectionDescription">
                    <label className={fieldLabelClass("linxup-lc-powerConnectionDescription")}>
                      Power connection note
                      <RequiredMark />
                    </label>
                    <textarea
                      className={`${fieldInputClass("linxup-lc-powerConnectionDescription")} min-h-[80px] resize-y py-3`}
                      value={linxupLcPowerConnectionDescription}
                      placeholder="exp: Fused power tap at battery positive"
                      onChange={(e) => {
                        setLinxupLcPowerConnectionDescription(e.target.value);
                        clearFieldHighlight("linxup-lc-powerConnectionDescription");
                      }}
                    />
                    {requiredHint("linxup-lc-powerConnectionDescription")}
                  </div>
                </div>

                <div id={`field-${linxupLcPhotoIssueKey("groundConnection")}`} className="space-y-3">
                  <label className={fieldLabelClass(linxupLcPhotoIssueKey("groundConnection"))}>
                    Ground connection and picture
                    <RequiredMark />
                  </label>
                  <input
                    id="linxup-lc-photo-groundConnection"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupLcPhotoUpload("groundConnection", e)}
                  />
                  <label
                    htmlFor="linxup-lc-photo-groundConnection"
                    className={photoPickClass(linxupLcPhotoIssueKey("groundConnection"), true, linxupLcPc.groundConnection >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupLcPc.groundConnection} names={linxupLcPhotoFileNames.groundConnection} />
                  <PhotoThumbnailGrid
                    files={linxupLcPhotoFiles.groundConnection}
                    remotePhotos={remoteThumbsForLinxupLcField("groundConnection")}
                    onRemoveLocal={(file) => removeLinxupLcLocalPhoto("groundConnection", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupLcUploadFieldFor("groundConnection"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupLcPc.groundConnection >= 1} />
                  <PhotoFieldError message={linxupLcPhotoErrors.groundConnection} />
                  {requiredHint(linxupLcPhotoIssueKey("groundConnection"))}
                  <div id="field-linxup-lc-groundConnectionDescription">
                    <label className={fieldLabelClass("linxup-lc-groundConnectionDescription")}>
                      Ground connection note
                      <RequiredMark />
                    </label>
                    <textarea
                      className={`${fieldInputClass("linxup-lc-groundConnectionDescription")} min-h-[80px] resize-y py-3`}
                      value={linxupLcGroundConnectionDescription}
                      placeholder="exp: Chassis ground stud near battery box"
                      onChange={(e) => {
                        setLinxupLcGroundConnectionDescription(e.target.value);
                        clearFieldHighlight("linxup-lc-groundConnectionDescription");
                      }}
                    />
                    {requiredHint("linxup-lc-groundConnectionDescription")}
                  </div>
                </div>

                <div id={`field-${linxupLcPhotoIssueKey("ignitionConnection")}`} className="space-y-3">
                  <label className={fieldLabelClass(linxupLcPhotoIssueKey("ignitionConnection"))}>
                    Ignition connection and picture
                    <RequiredMark />
                  </label>
                  <input
                    id="linxup-lc-photo-ignitionConnection"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupLcPhotoUpload("ignitionConnection", e)}
                  />
                  <label
                    htmlFor="linxup-lc-photo-ignitionConnection"
                    className={photoPickClass(linxupLcPhotoIssueKey("ignitionConnection"), true, linxupLcPc.ignitionConnection >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupLcPc.ignitionConnection} names={linxupLcPhotoFileNames.ignitionConnection} />
                  <PhotoThumbnailGrid
                    files={linxupLcPhotoFiles.ignitionConnection}
                    remotePhotos={remoteThumbsForLinxupLcField("ignitionConnection")}
                    onRemoveLocal={(file) => removeLinxupLcLocalPhoto("ignitionConnection", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupLcUploadFieldFor("ignitionConnection"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupLcPc.ignitionConnection >= 1} />
                  <PhotoFieldError message={linxupLcPhotoErrors.ignitionConnection} />
                  {requiredHint(linxupLcPhotoIssueKey("ignitionConnection"))}
                  <div id="field-linxup-lc-ignitionConnectionDescription">
                    <label className={fieldLabelClass("linxup-lc-ignitionConnectionDescription")}>
                      Ignition connection note
                      <RequiredMark />
                    </label>
                    <textarea
                      className={`${fieldInputClass("linxup-lc-ignitionConnectionDescription")} min-h-[80px] resize-y py-3`}
                      value={linxupLcIgnitionConnectionDescription}
                      placeholder="exp: Ignition-switched circuit at fuse panel"
                      onChange={(e) => {
                        setLinxupLcIgnitionConnectionDescription(e.target.value);
                        clearFieldHighlight("linxup-lc-ignitionConnectionDescription");
                      }}
                    />
                    {requiredHint("linxup-lc-ignitionConnectionDescription")}
                  </div>
                </div>

                <div id={`field-${linxupLcPhotoIssueKey("greenActivityLight")}`}>
                  <label className={labelClassName}>
                    Picture of green activity light (optional)
                  </label>
                  <input
                    id="linxup-lc-photo-greenActivityLight-hardwire"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupLcPhotoUpload("greenActivityLight", e)}
                  />
                  <label
                    htmlFor="linxup-lc-photo-greenActivityLight-hardwire"
                    className={photoPickClass(linxupLcPhotoIssueKey("greenActivityLight"), false, linxupLcPc.greenActivityLight >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupLcPc.greenActivityLight} names={linxupLcPhotoFileNames.greenActivityLight} />
                  <PhotoThumbnailGrid
                    files={linxupLcPhotoFiles.greenActivityLight}
                    remotePhotos={remoteThumbsForLinxupLcField("greenActivityLight")}
                    onRemoveLocal={(file) => removeLinxupLcLocalPhoto("greenActivityLight", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupLcUploadFieldFor("greenActivityLight"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupLcPc.greenActivityLight >= 1} />
                  <PhotoFieldError message={linxupLcPhotoErrors.greenActivityLight} />
                </div>

                <div id={`field-${linxupLcPhotoIssueKey("finalInstall")}`}>
                  <label className={fieldLabelClass(linxupLcPhotoIssueKey("finalInstall"))}>
                    Picture of final installation
                    <RequiredMark />
                  </label>
                  <input
                    id="linxup-lc-photo-finalInstall"
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => void applyLinxupLcPhotoUpload("finalInstall", e)}
                  />
                  <label
                    htmlFor="linxup-lc-photo-finalInstall"
                    className={photoPickClass(linxupLcPhotoIssueKey("finalInstall"), true, linxupLcPc.finalInstall >= 1)}
                  >
                    {PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  <PhotoUploadFeedback count={linxupLcPc.finalInstall} names={linxupLcPhotoFileNames.finalInstall} />
                  <PhotoThumbnailGrid
                    files={linxupLcPhotoFiles.finalInstall}
                    remotePhotos={remoteThumbsForLinxupLcField("finalInstall")}
                    onRemoveLocal={(file) => removeLinxupLcLocalPhoto("finalInstall", file)}
                    onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupLcUploadFieldFor("finalInstall"), remote)}
                  />
                  <PhotoUploadedBadge show={linxupLcPc.finalInstall >= 1} />
                  <PhotoFieldError message={linxupLcPhotoErrors.finalInstall} />
                  {requiredHint(linxupLcPhotoIssueKey("finalInstall"))}
                </div>

                <div id="field-linxup-lc-installationNotes">
                  <label className={fieldLabelClass("linxup-lc-installationNotes")}>
                    Installation notes
                    <RequiredMark />
                  </label>
                  <textarea
                    className={`${fieldInputClass("linxup-lc-installationNotes")} min-h-[80px] resize-y py-3`}
                    value={linxupLcInstallationNotes}
                    placeholder="exp: Hardwired under dash, cable secured away from pedals"
                    onChange={(e) => {
                      setLinxupLcInstallationNotes(e.target.value);
                      clearFieldHighlight("linxup-lc-installationNotes");
                    }}
                  />
                  {requiredHint("linxup-lc-installationNotes")}
                </div>
              </>
            )}
          </section>
        )}

        {hasAnsweredAdditionalHardwareQuestion && isLinxUpAssetTracker && (
          <section className={`${cardClassName} space-y-6`}>
            <FormSectionHeader title="Asset Tracker" tone="green" />

            <div id={`field-${linxupAtPhotoIssueKey("assetTrackerTag")}`}>
              <label className={fieldLabelClass(linxupAtPhotoIssueKey("assetTrackerTag"))}>
                Picture of asset tracker tag
                <RequiredMark />
              </label>
              <input
                id="linxup-at-photo-assetTrackerTag"
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/jpg"
                onChange={(e) => void applyLinxupAtPhotoUpload("assetTrackerTag", e)}
              />
              <label
                htmlFor="linxup-at-photo-assetTrackerTag"
                className={photoPickClass(linxupAtPhotoIssueKey("assetTrackerTag"), true, linxupAtPc.assetTrackerTag >= 1)}
              >
                {PHOTO_UPLOAD_LABEL_SINGLE}
              </label>
              <PhotoUploadFeedback count={linxupAtPc.assetTrackerTag} names={linxupAtPhotoFileNames.assetTrackerTag} />
              <PhotoThumbnailGrid
                files={linxupAtPhotoFiles.assetTrackerTag}
                remotePhotos={remoteThumbsForLinxupAtField("assetTrackerTag")}
                onRemoveLocal={(file) => removeLinxupAtLocalPhoto("assetTrackerTag", file)}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupAtUploadFieldFor("assetTrackerTag"), remote)}
              />
              <PhotoUploadedBadge show={linxupAtPc.assetTrackerTag >= 1} />
              <PhotoFieldError message={linxupAtPhotoErrors.assetTrackerTag} />
              {requiredHint(linxupAtPhotoIssueKey("assetTrackerTag"))}
            </div>

            <div id={`field-${linxupAtPhotoIssueKey("powerConnection")}`} className="space-y-3">
              <label className={fieldLabelClass(linxupAtPhotoIssueKey("powerConnection"))}>
                Power connection and picture
                <RequiredMark />
              </label>
              <input
                id="linxup-at-photo-powerConnection"
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/jpg"
                onChange={(e) => void applyLinxupAtPhotoUpload("powerConnection", e)}
              />
              <label
                htmlFor="linxup-at-photo-powerConnection"
                className={photoPickClass(linxupAtPhotoIssueKey("powerConnection"), true, linxupAtPc.powerConnection >= 1)}
              >
                {PHOTO_UPLOAD_LABEL_SINGLE}
              </label>
              <PhotoUploadFeedback count={linxupAtPc.powerConnection} names={linxupAtPhotoFileNames.powerConnection} />
              <PhotoThumbnailGrid
                files={linxupAtPhotoFiles.powerConnection}
                remotePhotos={remoteThumbsForLinxupAtField("powerConnection")}
                onRemoveLocal={(file) => removeLinxupAtLocalPhoto("powerConnection", file)}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupAtUploadFieldFor("powerConnection"), remote)}
              />
              <PhotoUploadedBadge show={linxupAtPc.powerConnection >= 1} />
              <PhotoFieldError message={linxupAtPhotoErrors.powerConnection} />
              {requiredHint(linxupAtPhotoIssueKey("powerConnection"))}
              <div id="field-linxup-at-powerConnectionDescription">
                <label className={fieldLabelClass("linxup-at-powerConnectionDescription")}>
                  Power connection note
                  <RequiredMark />
                </label>
                <textarea
                  className={`${fieldInputClass("linxup-at-powerConnectionDescription")} min-h-[80px] resize-y py-3`}
                  value={linxupPowerConnectionDescription}
                  placeholder="exp: Fused power tap at battery positive, ring terminal crimped"
                  onChange={(e) => {
                    setLinxupPowerConnectionDescription(e.target.value);
                    clearFieldHighlight("linxup-at-powerConnectionDescription");
                  }}
                />
                {requiredHint("linxup-at-powerConnectionDescription")}
              </div>
            </div>

            <div id={`field-${linxupAtPhotoIssueKey("groundConnection")}`} className="space-y-3">
              <label className={fieldLabelClass(linxupAtPhotoIssueKey("groundConnection"))}>
                Ground connection and picture
                <RequiredMark />
              </label>
              <input
                id="linxup-at-photo-groundConnection"
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/jpg"
                onChange={(e) => void applyLinxupAtPhotoUpload("groundConnection", e)}
              />
              <label
                htmlFor="linxup-at-photo-groundConnection"
                className={photoPickClass(linxupAtPhotoIssueKey("groundConnection"), true, linxupAtPc.groundConnection >= 1)}
              >
                {PHOTO_UPLOAD_LABEL_SINGLE}
              </label>
              <PhotoUploadFeedback count={linxupAtPc.groundConnection} names={linxupAtPhotoFileNames.groundConnection} />
              <PhotoThumbnailGrid
                files={linxupAtPhotoFiles.groundConnection}
                remotePhotos={remoteThumbsForLinxupAtField("groundConnection")}
                onRemoveLocal={(file) => removeLinxupAtLocalPhoto("groundConnection", file)}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupAtUploadFieldFor("groundConnection"), remote)}
              />
              <PhotoUploadedBadge show={linxupAtPc.groundConnection >= 1} />
              <PhotoFieldError message={linxupAtPhotoErrors.groundConnection} />
              {requiredHint(linxupAtPhotoIssueKey("groundConnection"))}
              <div id="field-linxup-at-groundConnectionDescription">
                <label className={fieldLabelClass("linxup-at-groundConnectionDescription")}>
                  Ground connection note
                  <RequiredMark />
                </label>
                <textarea
                  className={`${fieldInputClass("linxup-at-groundConnectionDescription")} min-h-[80px] resize-y py-3`}
                  value={linxupGroundConnectionDescription}
                  placeholder="exp: Chassis ground stud near battery box"
                  onChange={(e) => {
                    setLinxupGroundConnectionDescription(e.target.value);
                    clearFieldHighlight("linxup-at-groundConnectionDescription");
                  }}
                />
                {requiredHint("linxup-at-groundConnectionDescription")}
              </div>
            </div>

            <div id={`field-${linxupAtPhotoIssueKey("ignitionConnection")}`} className="space-y-3">
              <label className={fieldLabelClass(linxupAtPhotoIssueKey("ignitionConnection"))}>
                Ignition connection and picture
                <RequiredMark />
              </label>
              <input
                id="linxup-at-photo-ignitionConnection"
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/jpg"
                onChange={(e) => void applyLinxupAtPhotoUpload("ignitionConnection", e)}
              />
              <label
                htmlFor="linxup-at-photo-ignitionConnection"
                className={photoPickClass(linxupAtPhotoIssueKey("ignitionConnection"), true, linxupAtPc.ignitionConnection >= 1)}
              >
                {PHOTO_UPLOAD_LABEL_SINGLE}
              </label>
              <PhotoUploadFeedback count={linxupAtPc.ignitionConnection} names={linxupAtPhotoFileNames.ignitionConnection} />
              <PhotoThumbnailGrid
                files={linxupAtPhotoFiles.ignitionConnection}
                remotePhotos={remoteThumbsForLinxupAtField("ignitionConnection")}
                onRemoveLocal={(file) => removeLinxupAtLocalPhoto("ignitionConnection", file)}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupAtUploadFieldFor("ignitionConnection"), remote)}
              />
              <PhotoUploadedBadge show={linxupAtPc.ignitionConnection >= 1} />
              <PhotoFieldError message={linxupAtPhotoErrors.ignitionConnection} />
              {requiredHint(linxupAtPhotoIssueKey("ignitionConnection"))}
              <div id="field-linxup-at-ignitionConnectionDescription">
                <label className={fieldLabelClass("linxup-at-ignitionConnectionDescription")}>
                  Ignition connection note
                  <RequiredMark />
                </label>
                <textarea
                  className={`${fieldInputClass("linxup-at-ignitionConnectionDescription")} min-h-[80px] resize-y py-3`}
                  value={linxupIgnitionConnectionDescription}
                  placeholder="exp: Ignition-switched circuit at fuse panel"
                  onChange={(e) => {
                    setLinxupIgnitionConnectionDescription(e.target.value);
                    clearFieldHighlight("linxup-at-ignitionConnectionDescription");
                  }}
                />
                {requiredHint("linxup-at-ignitionConnectionDescription")}
              </div>
            </div>

            <div id={`field-${linxupAtPhotoIssueKey("finalInstall")}`}>
              <label className={fieldLabelClass(linxupAtPhotoIssueKey("finalInstall"))}>
                Picture of final install
                <RequiredMark />
              </label>
              <input
                id="linxup-at-photo-finalInstall"
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/jpg"
                onChange={(e) => void applyLinxupAtPhotoUpload("finalInstall", e)}
              />
              <label
                htmlFor="linxup-at-photo-finalInstall"
                className={photoPickClass(linxupAtPhotoIssueKey("finalInstall"), true, linxupAtPc.finalInstall >= 1)}
              >
                {PHOTO_UPLOAD_LABEL_SINGLE}
              </label>
              <PhotoUploadFeedback count={linxupAtPc.finalInstall} names={linxupAtPhotoFileNames.finalInstall} />
              <PhotoThumbnailGrid
                files={linxupAtPhotoFiles.finalInstall}
                remotePhotos={remoteThumbsForLinxupAtField("finalInstall")}
                onRemoveLocal={(file) => removeLinxupAtLocalPhoto("finalInstall", file)}
                onRemoveRemote={(remote) => void removeUploadedPhotoFromField(linxupAtUploadFieldFor("finalInstall"), remote)}
              />
              <PhotoUploadedBadge show={linxupAtPc.finalInstall >= 1} />
              <PhotoFieldError message={linxupAtPhotoErrors.finalInstall} />
              {requiredHint(linxupAtPhotoIssueKey("finalInstall"))}
            </div>
          </section>
        )}

        {hasAnsweredAdditionalHardwareQuestion && selectedSections.includes("VAC4") && (
          <VAC4Section>
            <section className={`${cardClassName} space-y-5`}>
              <FormSectionHeader title="VAC4 hardware" tone="purple" />

                <div id="field-vac4-clientApproval">
                  <label className={fieldLabelClass("vac4-clientApproval")}>
                    Client rep. approval — name, role, date/time
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

                <div className="space-y-6 rounded-2xl border-2 border-gray-200 bg-gray-50/90 p-4 dark:border-gray-600 dark:bg-gray-800/90 sm:p-5">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">VAC4 required photos</h3>

                  <div id="field-photo-vacMounting">
                    <label className={fieldLabelClass("photo-vacMounting")}>
                      VAC4 mounting photo
                      <RequiredMark />
                    </label>
                    <input
                      id="vacMountingPhoto"
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={(e) => applyVacPhotoUpload("vacMounting", e, "single")}
                    />
                    <label
                      htmlFor="vacMountingPhoto"
                      className={photoPickClass("photo-vacMounting", true, pc.vacMounting >= 1)}
                    >
                      {PHOTO_UPLOAD_LABEL_SINGLE}
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
                      Wire path photos
                      <RequiredMark />
                    </label>
                    <input
                      id="wirePathPhotos"
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      multiple
                      onChange={(e) => applyVacPhotoUpload("wirePath", e, "multi")}
                    />
                    <label
                      htmlFor="wirePathPhotos"
                      className={photoPickClass("photo-wirePath", true, pc.wirePath >= 1)}
                    >
                      {PHOTO_UPLOAD_LABEL_MULTI}
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
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                      Show the full harness route (bends, clips, through panels) in one or more photos.
                    </p>
                  </div>

                  <div id="field-photo-redWire">
                    <label className={fieldLabelClass("photo-redWire")}>
                      Red (+) battery photo
                      <RequiredMark />
                    </label>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Battery positive (+) terminal or bus.</p>
                    <input
                      id="redWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={(e) => applyVacPhotoUpload("redWire", e, "single")}
                    />
                    <label
                      htmlFor="redWirePhoto"
                      className={`${photoPickClass("photo-redWire", true, pc.redWire >= 1)} mb-2`}
                    >
                      {PHOTO_UPLOAD_LABEL_SINGLE}
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
                        Red wire — connection note
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
                      Black (−) battery photo
                      <RequiredMark />
                    </label>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Battery negative (−) or chassis ground.</p>
                    <input
                      id="blackWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={(e) => applyVacPhotoUpload("blackWire", e, "single")}
                    />
                    <label
                      htmlFor="blackWirePhoto"
                      className={`${photoPickClass("photo-blackWire", true, pc.blackWire >= 1)} mb-2`}
                    >
                      {PHOTO_UPLOAD_LABEL_SINGLE}
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
                        Black wire — connection note
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
                      Blue wire photo
                      <RequiredMark />
                    </label>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{blueWireHelperText}</p>
                    <input
                      id="blueWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={(e) => applyVacPhotoUpload("blueWire", e, "single")}
                    />
                    <label
                      htmlFor="blueWirePhoto"
                      className={`${photoPickClass("photo-blueWire", true, pc.blueWire >= 1)} mb-2`}
                    >
                      {PHOTO_UPLOAD_LABEL_SINGLE}
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
                        Blue wire — connection note
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
                        Purple wire photo
                        <RequiredMark />
                      </label>
                      <p className="text-sm text-gray-600 dark:text-gray-300">Operator-presence circuit.</p>
                    <input
                      id="purpleWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={(e) => applyVacPhotoUpload("purpleWire", e, "single")}
                    />
                    <label
                      htmlFor="purpleWirePhoto"
                        className={`${photoPickClass("photo-purpleWire", true, pc.purpleWire >= 1)} mb-2`}
                    >
                      {PHOTO_UPLOAD_LABEL_SINGLE}
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
                          Purple wire — connection note
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
                        Brown wire photo
                        <RequiredMark />
                      </label>
                      <p className="text-sm text-gray-600 dark:text-gray-300">{brownWireHelperText}</p>
                      <input
                        id="brownWirePhoto"
                        type="file"
                        className="hidden"
                        accept="image/png,image/jpeg,image/jpg"
                        onChange={(e) => applyVacPhotoUpload("brownWire", e, "single")}
                      />
                      <label
                        htmlFor="brownWirePhoto"
                        className={`${photoPickClass("photo-brownWire", true, pc.brownWire >= 1)} mb-2`}
                      >
                        {PHOTO_UPLOAD_LABEL_SINGLE}
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
                          Brown wire — connection note
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
                      Relay access photo
                      <RequiredMark />
                    </label>
                    <input
                      id="relayAccessControlPhoto"
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      required
                      onChange={(e) => applyVacPhotoUpload("relayAccess", e, "single")}
                    />
                    <label
                      htmlFor="relayAccessControlPhoto"
                      className={`${photoPickClass("photo-relayAccess", false, pc.relayAccess >= 1)} mb-2`}
                    >
                      {PHOTO_UPLOAD_LABEL_SINGLE}
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
                      Relay access — connection note
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
                      Impact sensor photo
                      <RequiredMark />
                    </label>
                    <input
                      id="impactSensorMountingPhoto"
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      required
                      onChange={(e) => applyVacPhotoUpload("impactSensor", e, "single")}
                    />
                    <label
                      htmlFor="impactSensorMountingPhoto"
                      className={`${photoPickClass("photo-impactSensor", false, pc.impactSensor >= 1)} mb-2`}
                    >
                      {PHOTO_UPLOAD_LABEL_SINGLE}
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
                      Impact sensor — mounting note
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

                <div id="field-vac4-sensorHubInstalled">
                  <label className={fieldLabelClass("vac4-sensorHubInstalled")}>
                    Sensor Hub Installed?
                    <RequiredMark />
                  </label>
                  <select
                    className={fieldSelectClass("vac4-sensorHubInstalled")}
                    value={sensorHubInstalled}
                    onChange={(e) => {
                      setSensorHubInstalled(e.target.value);
                      clearFieldHighlight("vac4-sensorHubInstalled");
                    }}
                  >
                    <option value="" className="text-gray-400">
                      Select Yes or No
                    </option>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                  {requiredHint("vac4-sensorHubInstalled")}
                </div>

                {sensorHubInstalled === "Yes" && (
                  <div className="space-y-5 rounded-2xl border-2 border-gray-200 bg-gray-50/90 p-4 dark:border-gray-600 dark:bg-gray-800/90 sm:p-5">
                    <div>
                      <label className={labelClassName}>Sensor Hub Mounting Location</label>
                      <input className={inputClassName} placeholder="exp: Under dash panel" />
                    </div>
                    <div id="field-photo-sensorHubMounting">
                      <label className={fieldLabelClass("photo-sensorHubMounting")}>
                        Sensor hub mounting photo
                        <RequiredMark />
                      </label>
                      <input
                        id="sensorHubMountingPhoto"
                        type="file"
                        className="hidden"
                        accept="image/png,image/jpeg,image/jpg"
                        onChange={(e) => applyVacPhotoUpload("sensorHubMounting", e, "single")}
                      />
                      <label
                        htmlFor="sensorHubMountingPhoto"
                        className={photoPickClass("photo-sensorHubMounting", true, pc.sensorHubMounting >= 1)}
                      >
                        {PHOTO_UPLOAD_LABEL_SINGLE}
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
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 dark:border-gray-600 dark:bg-gray-900 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Speed Sense Details</h3>
                        <div id="field-photo-speedSense">
                          <label className={fieldLabelClass("photo-speedSense")}>
                            Speed sense photo
                            <RequiredMark />
                          </label>
                          <input
                            id="speedSensePhoto"
                            type="file"
                            className="hidden"
                            accept="image/png,image/jpeg,image/jpg"
                            onChange={(e) => applyVacPhotoUpload("speedSense", e, "single")}
                          />
                          <label
                            htmlFor="speedSensePhoto"
                            className={photoPickClass("photo-speedSense", true, pc.speedSense >= 1)}
                          >
                            {PHOTO_UPLOAD_LABEL_SINGLE}
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
                            Speed sense — installation note
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
                            Speed sense pulse count
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
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 dark:border-gray-600 dark:bg-gray-900 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Load Sense Details</h3>
                        <div id="field-photo-loadSense">
                          <label className={fieldLabelClass("photo-loadSense")}>
                            Load sense photo
                            <RequiredMark />
                          </label>
                          <input
                            id="loadSensePhoto"
                            type="file"
                            className="hidden"
                            accept="image/png,image/jpeg,image/jpg"
                            onChange={(e) => applyVacPhotoUpload("loadSense", e, "single")}
                          />
                          <label
                            htmlFor="loadSensePhoto"
                            className={photoPickClass("photo-loadSense", true, pc.loadSense >= 1)}
                          >
                            {PHOTO_UPLOAD_LABEL_SINGLE}
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
                            Load sense VAC thresholds
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
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 dark:border-gray-600 dark:bg-gray-900 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">GPS Details</h3>
                        <div id="field-photo-gps">
                          <label className={fieldLabelClass("photo-gps")}>
                            GPS mounting photo
                            <RequiredMark />
                          </label>
                          <input
                            id="gpsMountingPhoto"
                            type="file"
                            className="hidden"
                            accept="image/png,image/jpeg,image/jpg"
                            onChange={(e) => applyVacPhotoUpload("gps", e, "single")}
                          />
                          <label
                            htmlFor="gpsMountingPhoto"
                            className={photoPickClass("photo-gps", true, pc.gps >= 1)}
                          >
                            {PHOTO_UPLOAD_LABEL_SINGLE}
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
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 dark:border-gray-600 dark:bg-gray-900 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">External Indicator Details</h3>
                        <div id="field-photo-externalIndicator">
                          <label className={fieldLabelClass("photo-externalIndicator")}>
                            External indicator mounting photo
                            <RequiredMark />
                          </label>
                          <input
                            id="externalIndicatorPhoto"
                            type="file"
                            className="hidden"
                            accept="image/png,image/jpeg,image/jpg"
                            onChange={(e) => applyVacPhotoUpload("externalIndicator", e, "single")}
                          />
                          <label
                            htmlFor="externalIndicatorPhoto"
                            className={photoPickClass("photo-externalIndicator", true, pc.externalIndicator >= 1)}
                          >
                            {PHOTO_UPLOAD_LABEL_SINGLE}
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

        {/* Dynamic Sections — only products with dedicated form UI (CP4 / PPD + aliases). */}
        {hasAnsweredAdditionalHardwareQuestion &&
          !isLinxUpProfile &&
          selectedSections
            .filter((section) => {
              const renderKey = resolveEffective(section);
              return renderKey === "CP4" || renderKey === "PPD" || renderKey === "Speed SSC";
            })
            .map((section) => {
              const renderKey = resolveEffective(section);
              const ppdSectionTitle =
                section === "PPD" ? "PPD / Pedestrian hardware" : productLabel(section) || section;
              return renderKey === "CP4" ? (
                <section key={section} className={cardClassName}>
                  <FormSectionHeader title="CP4 hardware" tone="green" />
                  <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                    <p className="font-semibold">Uses Vehicle Information from this card</p>
                    <p className="mt-1 text-emerald-900/90 dark:text-emerald-200/90">
                      Drive type: <span className="font-medium">{vac4DriveType.trim() || "—"}</span>
                      {vac4DriveType === "Electric" ? (
                        <>
                          {" "}
                          · Voltage:{" "}
                          <span className="font-medium">
                            {vac4VehicleVoltage === "Other"
                              ? vac4VehicleVoltageOther.trim() || "Other (not specified)"
                              : vac4VehicleVoltage.trim() || "—"}
                          </span>
                          {cp4ShowPowerConverterMounting ? (
                            <span className="block pt-1 text-xs font-normal text-emerald-800 dark:text-emerald-300">
                              Power converter section required (&gt;24 V).
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </p>
                  </div>

                  <div className="space-y-6">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div id="field-cp4-drid">
                        <SerialInput
                          label="DRID"
                          required
                          labelClassName={fieldLabelClass("cp4-drid")}
                          inputClassName={fieldInputClass("cp4-drid")}
                          value={cp4Drid}
                          placeholder="exp: DRID-8FBE20U01 (manual / scan later)"
                          onChange={(v) => {
                            setCp4Drid(v);
                            clearFieldHighlight("cp4-drid");
                          }}
                        />
                        {requiredHint("cp4-drid")}
                      </div>
                      <div id="field-cp4-serial">
                        <SerialInput
                          label="CP4 serial number"
                          required
                          labelClassName={fieldLabelClass("cp4-serial")}
                          inputClassName={fieldInputClass("cp4-serial")}
                          value={cp4Serial}
                          placeholder="Scan or type serial"
                          onChange={(v) => {
                            setCp4Serial(v);
                            clearFieldHighlight("cp4-serial");
                          }}
                        />
                        {requiredHint("cp4-serial")}
                      </div>
                      <div id="field-cp4-cameraQuantity">
                        <label className={fieldLabelClass("cp4-cameraQuantity")}>
                          Quantity of cameras
                          <RequiredMark />
                        </label>
                        <select
                          className={fieldSelectClass("cp4-cameraQuantity")}
                          value={
                            cp4CameraQuantity === "1" ||
                            cp4CameraQuantity === "2" ||
                            cp4CameraQuantity === "3" ||
                            cp4CameraQuantity === "4"
                              ? cp4CameraQuantity
                              : ""
                          }
                          onChange={(e) => {
                            setCp4CameraQuantity(e.target.value);
                            clearFieldHighlight("cp4-cameraQuantity");
                          }}
                        >
                          <option value="">Select</option>
                          <option value="1">1</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                          <option value="4">4</option>
                        </select>
                        {requiredHint("cp4-cameraQuantity")}
                      </div>
                      <div id="field-cp4-monitorInstalled">
                        <label className={fieldLabelClass("cp4-monitorInstalled")}>
                          Is monitor installed?
                          <RequiredMark />
                        </label>
                        <select
                          className={fieldSelectClass("cp4-monitorInstalled")}
                          value={cp4MonitorInstalled}
                          onChange={(e) => {
                            const value = e.target.value;
                            setCp4MonitorInstalled(value);
                            clearFieldHighlight("cp4-monitorInstalled");
                            if (value !== "Yes") {
                              clearCp4PhotoSlotAndStorage("monitorMounting");
                              setCp4PhotoErrors((er) => ({ ...er, monitorMounting: null }));
                              setCp4MonitorMountingDescription("");
                              clearFieldHighlight(cp4PhotoIssueKey("monitorMounting"));
                              clearFieldHighlight("cp4-monitorMountingDescription");
                            }
                          }}
                        >
                          <option value="">Select</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                        {requiredHint("cp4-monitorInstalled")}
                      </div>
                    </div>

                    <div id="field-cp4-clientApproval">
                      <label className={fieldLabelClass("cp4-clientApproval")}>
                        Client rep. approval — mounting locations, camera positions, and views
                        <RequiredMark />
                      </label>
                      <textarea
                        className={`${fieldInputClass("cp4-clientApproval")} min-h-[88px] resize-y py-3`}
                        value={cp4ClientApproval}
                        placeholder="exp: Jane Doe, approved 5/04 2:15 PM"
                        onChange={(e) => {
                          setCp4ClientApproval(e.target.value);
                          clearFieldHighlight("cp4-clientApproval");
                        }}
                      />
                      {requiredHint("cp4-clientApproval")}
                    </div>

                    <div id="field-cp4-customBracketsNeeded">
                      <label className={fieldLabelClass("cp4-customBracketsNeeded")}>
                        Were any modifications or custom brackets needed to install cameras?
                        <RequiredMark />
                      </label>
                      <select
                        className={fieldSelectClass("cp4-customBracketsNeeded")}
                        value={cp4CustomBracketsNeeded}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCp4CustomBracketsNeeded(value);
                          clearFieldHighlight("cp4-customBracketsNeeded");
                          if (value !== "Yes") {
                            setCp4CustomBracketNotes("");
                            clearFieldHighlight("cp4-customBracketNotes");
                          }
                        }}
                      >
                        <option value="">Select</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                      {requiredHint("cp4-customBracketsNeeded")}
                    </div>

                    {cp4CustomBracketsNeeded === "Yes" ? (
                      <div id="field-cp4-customBracketNotes">
                        <label className={fieldLabelClass("cp4-customBracketNotes")}>
                          Modification / custom bracket notes
                          <RequiredMark />
                        </label>
                        <textarea
                          className={`${fieldInputClass("cp4-customBracketNotes")} min-h-[88px] resize-y py-3`}
                          value={cp4CustomBracketNotes}
                          placeholder="exp: Custom L-bracket on overhead guard, painted to match"
                          onChange={(e) => {
                            setCp4CustomBracketNotes(e.target.value);
                            clearFieldHighlight("cp4-customBracketNotes");
                          }}
                        />
                        {requiredHint("cp4-customBracketNotes")}
                      </div>
                    ) : null}

                    <div className="space-y-6 border-t border-gray-100 pt-6 dark:border-gray-700">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">CP4 required photos</h3>

                      <div id={`field-${cp4PhotoIssueKey("cameraMounting")}`}>
                        <label className={fieldLabelClass(cp4PhotoIssueKey("cameraMounting"))}>
                          Camera mounting photos
                          <RequiredMark />
                        </label>
                        <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                          Include brackets and safety cable on mounts where applicable.
                        </p>
                        <input
                          id="cp4-photo-cameraMounting"
                          type="file"
                          className="hidden"
                          accept="image/png,image/jpeg,image/jpg"
                          multiple
                          onChange={(e) => void applyCp4PhotoUpload("cameraMounting", e, "multi")}
                        />
                        <label
                          htmlFor="cp4-photo-cameraMounting"
                          className={photoPickClass(cp4PhotoIssueKey("cameraMounting"), true, cp4Pc.cameraMounting >= 1)}
                        >
                          {PHOTO_UPLOAD_LABEL_MULTI}
                        </label>
                        <PhotoUploadFeedback count={cp4Pc.cameraMounting} names={cp4PhotoFileNames.cameraMounting} />
                        <PhotoThumbnailGrid
                          files={cp4PhotoFiles.cameraMounting}
                          remotePhotos={remoteThumbsForCp4Field("cameraMounting")}
                          onRemoveLocal={(file) => removeCp4LocalPhoto("cameraMounting", file)}
                          onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("cameraMounting"), remote)}
                        />
                        <PhotoUploadedBadge show={cp4Pc.cameraMounting >= 1} />
                        <PhotoFieldError message={cp4PhotoErrors.cameraMounting} />
                        {requiredHint(cp4PhotoIssueKey("cameraMounting"))}
                      </div>

                      <div id={`field-${cp4PhotoIssueKey("wirePath")}`}>
                        <label className={fieldLabelClass(cp4PhotoIssueKey("wirePath"))}>
                          Wire path photos
                          <RequiredMark />
                        </label>
                        <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                          Add multiple angles if the harness changes direction or passes through panels.
                        </p>
                        <input
                          id="cp4-photo-wirePath"
                          type="file"
                          className="hidden"
                          accept="image/png,image/jpeg,image/jpg"
                          multiple
                          onChange={(e) => void applyCp4PhotoUpload("wirePath", e, "multi")}
                        />
                        <label
                          htmlFor="cp4-photo-wirePath"
                          className={photoPickClass(cp4PhotoIssueKey("wirePath"), true, cp4Pc.wirePath >= 1)}
                        >
                          {PHOTO_UPLOAD_LABEL_MULTI}
                        </label>
                        <PhotoUploadFeedback count={cp4Pc.wirePath} names={cp4PhotoFileNames.wirePath} />
                        <PhotoThumbnailGrid
                          files={cp4PhotoFiles.wirePath}
                          remotePhotos={remoteThumbsForCp4Field("wirePath")}
                          onRemoveLocal={(file) => removeCp4LocalPhoto("wirePath", file)}
                          onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("wirePath"), remote)}
                        />
                        <PhotoUploadedBadge show={cp4Pc.wirePath >= 1} />
                        <PhotoFieldError message={cp4PhotoErrors.wirePath} />
                        {requiredHint(cp4PhotoIssueKey("wirePath"))}
                      </div>

                      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-700 dark:bg-gray-900/40 sm:p-5">
                        <h4 className="mb-4 text-base font-bold text-gray-900 dark:text-gray-100">Mounting locations</h4>
                        <div className="space-y-6">
                          <div id={`field-${cp4PhotoIssueKey("hubMounting")}`}>
                            <label className={fieldLabelClass(cp4PhotoIssueKey("hubMounting"))}>DVR Mounting Location<RequiredMark /></label>
                            <input id="cp4-photo-hubMounting" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("hubMounting", e, "single")} />
                            <label htmlFor="cp4-photo-hubMounting" className={photoPickClass(cp4PhotoIssueKey("hubMounting"), true, cp4Pc.hubMounting >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                            <PhotoUploadFeedback count={cp4Pc.hubMounting} names={cp4PhotoFileNames.hubMounting} />
                            <PhotoThumbnailGrid
                              files={cp4PhotoFiles.hubMounting}
                              remotePhotos={remoteThumbsForCp4Field("hubMounting")}
                              onRemoveLocal={(file) => removeCp4LocalPhoto("hubMounting", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("hubMounting"), remote)}
                            />
                            <PhotoUploadedBadge show={cp4Pc.hubMounting >= 1} />
                            <PhotoFieldError message={cp4PhotoErrors.hubMounting} />
                            {requiredHint(cp4PhotoIssueKey("hubMounting"))}
                            <div id="field-cp4-hubMountingDescription" className="mt-3">
                              <label className={fieldLabelClass("cp4-hubMountingDescription")}>Mounting note<RequiredMark /></label>
                              <textarea
                                className={`${fieldInputClass("cp4-hubMountingDescription")} min-h-[80px] resize-y py-3`}
                                value={cp4HubMountingDescription}
                                placeholder="exp: DVR bracketed to dash center, harness exits left kick panel"
                                onChange={(e) => {
                                  setCp4HubMountingDescription(e.target.value);
                                  clearFieldHighlight("cp4-hubMountingDescription");
                                }}
                              />
                              {requiredHint("cp4-hubMountingDescription")}
                            </div>
                          </div>

                          <div id={`field-${cp4PhotoIssueKey("microphoneMounting")}`}>
                            <label className={fieldLabelClass(cp4PhotoIssueKey("microphoneMounting"))}>Microphone mounting location<RequiredMark /></label>
                            <input id="cp4-photo-microphoneMounting" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("microphoneMounting", e, "single")} />
                            <label htmlFor="cp4-photo-microphoneMounting" className={photoPickClass(cp4PhotoIssueKey("microphoneMounting"), true, cp4Pc.microphoneMounting >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                            <PhotoUploadFeedback count={cp4Pc.microphoneMounting} names={cp4PhotoFileNames.microphoneMounting} />
                            <PhotoThumbnailGrid
                              files={cp4PhotoFiles.microphoneMounting}
                              remotePhotos={remoteThumbsForCp4Field("microphoneMounting")}
                              onRemoveLocal={(file) => removeCp4LocalPhoto("microphoneMounting", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("microphoneMounting"), remote)}
                            />
                            <PhotoUploadedBadge show={cp4Pc.microphoneMounting >= 1} />
                            <PhotoFieldError message={cp4PhotoErrors.microphoneMounting} />
                            {requiredHint(cp4PhotoIssueKey("microphoneMounting"))}
                            <div id="field-cp4-microphoneMountingDescription" className="mt-3">
                              <label className={fieldLabelClass("cp4-microphoneMountingDescription")}>Mounting note<RequiredMark /></label>
                              <textarea
                                className={`${fieldInputClass("cp4-microphoneMountingDescription")} min-h-[80px] resize-y py-3`}
                                value={cp4MicrophoneMountingDescription}
                                placeholder="exp: Mic on A-pillar clip, cable tucked in headliner to DVR"
                                onChange={(e) => {
                                  setCp4MicrophoneMountingDescription(e.target.value);
                                  clearFieldHighlight("cp4-microphoneMountingDescription");
                                }}
                              />
                              {requiredHint("cp4-microphoneMountingDescription")}
                            </div>
                          </div>

                          <div id={`field-${cp4PhotoIssueKey("remoteControlMounting")}`}>
                            <label className={fieldLabelClass(cp4PhotoIssueKey("remoteControlMounting"))}>Remote control mounting location<RequiredMark /></label>
                            <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">Include illuminated lights.</p>
                            <input id="cp4-photo-remoteControlMounting" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("remoteControlMounting", e, "single")} />
                            <label htmlFor="cp4-photo-remoteControlMounting" className={photoPickClass(cp4PhotoIssueKey("remoteControlMounting"), true, cp4Pc.remoteControlMounting >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                            <PhotoUploadFeedback count={cp4Pc.remoteControlMounting} names={cp4PhotoFileNames.remoteControlMounting} />
                            <PhotoThumbnailGrid
                              files={cp4PhotoFiles.remoteControlMounting}
                              remotePhotos={remoteThumbsForCp4Field("remoteControlMounting")}
                              onRemoveLocal={(file) => removeCp4LocalPhoto("remoteControlMounting", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("remoteControlMounting"), remote)}
                            />
                            <PhotoUploadedBadge show={cp4Pc.remoteControlMounting >= 1} />
                            <PhotoFieldError message={cp4PhotoErrors.remoteControlMounting} />
                            {requiredHint(cp4PhotoIssueKey("remoteControlMounting"))}
                            <div id="field-cp4-remoteControlMountingDescription" className="mt-3">
                              <label className={fieldLabelClass("cp4-remoteControlMountingDescription")}>Mounting note<RequiredMark /></label>
                              <textarea
                                className={`${fieldInputClass("cp4-remoteControlMountingDescription")} min-h-[80px] resize-y py-3`}
                                value={cp4RemoteControlMountingDescription}
                                placeholder="exp: Handset in dash cubby; green/red status LEDs visible in photo"
                                onChange={(e) => {
                                  setCp4RemoteControlMountingDescription(e.target.value);
                                  clearFieldHighlight("cp4-remoteControlMountingDescription");
                                }}
                              />
                              {requiredHint("cp4-remoteControlMountingDescription")}
                            </div>
                          </div>

                          <div id={`field-${cp4PhotoIssueKey("gpsSensorMounting")}`}>
                            <label className={fieldLabelClass(cp4PhotoIssueKey("gpsSensorMounting"))}>GPS sensor mounting location<RequiredMark /></label>
                            <input id="cp4-photo-gpsSensorMounting" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("gpsSensorMounting", e, "single")} />
                            <label htmlFor="cp4-photo-gpsSensorMounting" className={photoPickClass(cp4PhotoIssueKey("gpsSensorMounting"), true, cp4Pc.gpsSensorMounting >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                            <PhotoUploadFeedback count={cp4Pc.gpsSensorMounting} names={cp4PhotoFileNames.gpsSensorMounting} />
                            <PhotoThumbnailGrid
                              files={cp4PhotoFiles.gpsSensorMounting}
                              remotePhotos={remoteThumbsForCp4Field("gpsSensorMounting")}
                              onRemoveLocal={(file) => removeCp4LocalPhoto("gpsSensorMounting", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("gpsSensorMounting"), remote)}
                            />
                            <PhotoUploadedBadge show={cp4Pc.gpsSensorMounting >= 1} />
                            <PhotoFieldError message={cp4PhotoErrors.gpsSensorMounting} />
                            {requiredHint(cp4PhotoIssueKey("gpsSensorMounting"))}
                            <div id="field-cp4-gpsSensorMountingDescription" className="mt-3">
                              <label className={fieldLabelClass("cp4-gpsSensorMountingDescription")}>Mounting note<RequiredMark /></label>
                              <textarea
                                className={`${fieldInputClass("cp4-gpsSensorMountingDescription")} min-h-[80px] resize-y py-3`}
                                value={cp4GpsSensorMountingDescription}
                                placeholder="exp: GPS puck on roof center, 12 in. from cab obstruction"
                                onChange={(e) => {
                                  setCp4GpsSensorMountingDescription(e.target.value);
                                  clearFieldHighlight("cp4-gpsSensorMountingDescription");
                                }}
                              />
                              {requiredHint("cp4-gpsSensorMountingDescription")}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-700 dark:bg-gray-900/40 sm:p-5">
                        <h4 className="mb-4 text-base font-bold text-gray-900 dark:text-gray-100">Wire connections</h4>
                        <div className="space-y-6">
                          <div id={`field-${cp4PhotoIssueKey("redBattery")}`}>
                            <label className={fieldLabelClass(cp4PhotoIssueKey("redBattery"))}>Red wire — battery positive (+) connection<RequiredMark /></label>
                            <input id="cp4-photo-redBattery" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("redBattery", e, "single")} />
                            <label htmlFor="cp4-photo-redBattery" className={photoPickClass(cp4PhotoIssueKey("redBattery"), true, cp4Pc.redBattery >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                            <PhotoUploadFeedback count={cp4Pc.redBattery} names={cp4PhotoFileNames.redBattery} />
                            <PhotoThumbnailGrid
                              files={cp4PhotoFiles.redBattery}
                              remotePhotos={remoteThumbsForCp4Field("redBattery")}
                              onRemoveLocal={(file) => removeCp4LocalPhoto("redBattery", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("redBattery"), remote)}
                            />
                            <PhotoUploadedBadge show={cp4Pc.redBattery >= 1} />
                            <PhotoFieldError message={cp4PhotoErrors.redBattery} />
                            {requiredHint(cp4PhotoIssueKey("redBattery"))}
                            <div id="field-cp4-redWireDescription" className="mt-3">
                              <label className={fieldLabelClass("cp4-redWireDescription")}>Connection note<RequiredMark /></label>
                              <textarea
                                className={`${fieldInputClass("cp4-redWireDescription")} min-h-[80px] resize-y py-3`}
                                value={cp4RedWireDescription}
                                placeholder="exp: Battery + terminal post, fused link to CP4 red"
                                onChange={(e) => {
                                  setCp4RedWireDescription(e.target.value);
                                  clearFieldHighlight("cp4-redWireDescription");
                                }}
                              />
                              {requiredHint("cp4-redWireDescription")}
                            </div>
                          </div>
                          <div id={`field-${cp4PhotoIssueKey("blackBattery")}`}>
                            <label className={fieldLabelClass(cp4PhotoIssueKey("blackBattery"))}>Black wire — battery negative (−) connection<RequiredMark /></label>
                            <input id="cp4-photo-blackBattery" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("blackBattery", e, "single")} />
                            <label htmlFor="cp4-photo-blackBattery" className={photoPickClass(cp4PhotoIssueKey("blackBattery"), true, cp4Pc.blackBattery >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                            <PhotoUploadFeedback count={cp4Pc.blackBattery} names={cp4PhotoFileNames.blackBattery} />
                            <PhotoThumbnailGrid
                              files={cp4PhotoFiles.blackBattery}
                              remotePhotos={remoteThumbsForCp4Field("blackBattery")}
                              onRemoveLocal={(file) => removeCp4LocalPhoto("blackBattery", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("blackBattery"), remote)}
                            />
                            <PhotoUploadedBadge show={cp4Pc.blackBattery >= 1} />
                            <PhotoFieldError message={cp4PhotoErrors.blackBattery} />
                            {requiredHint(cp4PhotoIssueKey("blackBattery"))}
                            <div id="field-cp4-blackWireDescription" className="mt-3">
                              <label className={fieldLabelClass("cp4-blackWireDescription")}>Connection note<RequiredMark /></label>
                              <textarea
                                className={`${fieldInputClass("cp4-blackWireDescription")} min-h-[80px] resize-y py-3`}
                                value={cp4BlackWireDescription}
                                placeholder="exp: Frame ground stud near battery box, ring terminal crimped"
                                onChange={(e) => {
                                  setCp4BlackWireDescription(e.target.value);
                                  clearFieldHighlight("cp4-blackWireDescription");
                                }}
                              />
                              {requiredHint("cp4-blackWireDescription")}
                            </div>
                          </div>
                          <div id={`field-${cp4PhotoIssueKey("whiteIgnition")}`}>
                            <label className={fieldLabelClass(cp4PhotoIssueKey("whiteIgnition"))}>White wire — ignition / power trigger connection<RequiredMark /></label>
                            <input id="cp4-photo-whiteIgnition" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("whiteIgnition", e, "single")} />
                            <label htmlFor="cp4-photo-whiteIgnition" className={photoPickClass(cp4PhotoIssueKey("whiteIgnition"), true, cp4Pc.whiteIgnition >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                            <PhotoUploadFeedback count={cp4Pc.whiteIgnition} names={cp4PhotoFileNames.whiteIgnition} />
                            <PhotoThumbnailGrid
                              files={cp4PhotoFiles.whiteIgnition}
                              remotePhotos={remoteThumbsForCp4Field("whiteIgnition")}
                              onRemoveLocal={(file) => removeCp4LocalPhoto("whiteIgnition", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("whiteIgnition"), remote)}
                            />
                            <PhotoUploadedBadge show={cp4Pc.whiteIgnition >= 1} />
                            <PhotoFieldError message={cp4PhotoErrors.whiteIgnition} />
                            {requiredHint(cp4PhotoIssueKey("whiteIgnition"))}
                            <div id="field-cp4-whiteWireDescription" className="mt-3">
                              <label className={fieldLabelClass("cp4-whiteWireDescription")}>Connection note<RequiredMark /></label>
                              <textarea
                                className={`${fieldInputClass("cp4-whiteWireDescription")} min-h-[80px] resize-y py-3`}
                                value={cp4WhiteWireDescription}
                                placeholder="exp: Ignition-on at key switch, 12 V when engine running only"
                                onChange={(e) => {
                                  setCp4WhiteWireDescription(e.target.value);
                                  clearFieldHighlight("cp4-whiteWireDescription");
                                }}
                              />
                              {requiredHint("cp4-whiteWireDescription")}
                            </div>
                          </div>
                        </div>
                      </div>

                      {cp4ShowMonitorMounting ? (
                        <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-800 dark:bg-indigo-950/30 sm:p-5">
                          <h4 className="mb-2 text-base font-bold text-gray-900 dark:text-gray-100">Monitor mounting location<RequiredMark /></h4>
                          <div id={`field-${cp4PhotoIssueKey("monitorMounting")}`}>
                            <input id="cp4-photo-monitorMounting" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("monitorMounting", e, "single")} />
                            <label htmlFor="cp4-photo-monitorMounting" className={photoPickClass(cp4PhotoIssueKey("monitorMounting"), true, cp4Pc.monitorMounting >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                            <PhotoUploadFeedback count={cp4Pc.monitorMounting} names={cp4PhotoFileNames.monitorMounting} />
                            <PhotoThumbnailGrid
                              files={cp4PhotoFiles.monitorMounting}
                              remotePhotos={remoteThumbsForCp4Field("monitorMounting")}
                              onRemoveLocal={(file) => removeCp4LocalPhoto("monitorMounting", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("monitorMounting"), remote)}
                            />
                            <PhotoUploadedBadge show={cp4Pc.monitorMounting >= 1} />
                            <PhotoFieldError message={cp4PhotoErrors.monitorMounting} />
                            {requiredHint(cp4PhotoIssueKey("monitorMounting"))}
                            <div id="field-cp4-monitorMountingDescription" className="mt-3">
                              <label className={fieldLabelClass("cp4-monitorMountingDescription")}>Connection note<RequiredMark /></label>
                              <textarea
                                className={`${fieldInputClass("cp4-monitorMountingDescription")} min-h-[80px] resize-y py-3`}
                                value={cp4MonitorMountingDescription}
                                placeholder="exp: 7 in. monitor RAM-mounted left of column, power from keyed fuse"
                                onChange={(e) => {
                                  setCp4MonitorMountingDescription(e.target.value);
                                  clearFieldHighlight("cp4-monitorMountingDescription");
                                }}
                              />
                              {requiredHint("cp4-monitorMountingDescription")}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {cp4ShowPowerConverterMounting ? (
                        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/30 sm:p-5">
                          <h4 className="mb-2 text-base font-bold text-gray-900 dark:text-gray-100">Power converter mounting and wiring<RequiredMark /></h4>
                          <div id={`field-${cp4PhotoIssueKey("powerConverter")}`}>
                            <input id="cp4-photo-powerConverter" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("powerConverter", e, "single")} />
                            <label htmlFor="cp4-photo-powerConverter" className={photoPickClass(cp4PhotoIssueKey("powerConverter"), true, cp4Pc.powerConverter >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                            <PhotoUploadFeedback count={cp4Pc.powerConverter} names={cp4PhotoFileNames.powerConverter} />
                            <PhotoThumbnailGrid
                              files={cp4PhotoFiles.powerConverter}
                              remotePhotos={remoteThumbsForCp4Field("powerConverter")}
                              onRemoveLocal={(file) => removeCp4LocalPhoto("powerConverter", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("powerConverter"), remote)}
                            />
                            <PhotoUploadedBadge show={cp4Pc.powerConverter >= 1} />
                            <PhotoFieldError message={cp4PhotoErrors.powerConverter} />
                            {requiredHint(cp4PhotoIssueKey("powerConverter"))}
                            <div id="field-cp4-powerConverterDescription" className="mt-3">
                              <label className={fieldLabelClass("cp4-powerConverterDescription")}>Connection note<RequiredMark /></label>
                              <textarea
                                className={`${fieldInputClass("cp4-powerConverterDescription")} min-h-[80px] resize-y py-3`}
                                value={cp4PowerConverterDescription}
                                placeholder="exp: 48-to-12 V converter on frame rail, fused input, short run to DVR"
                                onChange={(e) => {
                                  setCp4PowerConverterDescription(e.target.value);
                                  clearFieldHighlight("cp4-powerConverterDescription");
                                }}
                              />
                              {requiredHint("cp4-powerConverterDescription")}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-600 dark:bg-gray-900 sm:p-5">
                        <h4 className="mb-3 text-base font-bold text-gray-900 dark:text-gray-100">Alarm IN relay connections</h4>
                        <div className="space-y-6">
                          <div id="field-cp4-alarmIn1RelayInstalled">
                            <label className={fieldLabelClass("cp4-alarmIn1RelayInstalled")}>Relay installed for ALARM IN 1?<RequiredMark /></label>
                            <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">Usually tied to VAC4 impact trigger.</p>
                            <select className={fieldSelectClass("cp4-alarmIn1RelayInstalled")} value={cp4AlarmIn1RelayInstalled} onChange={(e) => { const value = e.target.value; setCp4AlarmIn1RelayInstalled(value); clearFieldHighlight("cp4-alarmIn1RelayInstalled"); if (value !== "Yes") { clearCp4PhotoSlotAndStorage("alarmIn1"); setCp4PhotoErrors((er) => ({ ...er, alarmIn1: null })); setCp4AlarmIn1Description(""); clearFieldHighlight(cp4PhotoIssueKey("alarmIn1")); clearFieldHighlight("cp4-alarmIn1Description"); } }}>
                              <option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option>
                            </select>
                            {requiredHint("cp4-alarmIn1RelayInstalled")}
                          </div>
                          {cp4ShowAlarmIn1 ? (
                            <div id={`field-${cp4PhotoIssueKey("alarmIn1")}`}>
                              <input id="cp4-photo-alarmIn1" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("alarmIn1", e, "single")} />
                              <label htmlFor="cp4-photo-alarmIn1" className={photoPickClass(cp4PhotoIssueKey("alarmIn1"), true, cp4Pc.alarmIn1 >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                              <PhotoUploadFeedback count={cp4Pc.alarmIn1} names={cp4PhotoFileNames.alarmIn1} />
                              <PhotoThumbnailGrid
                                files={cp4PhotoFiles.alarmIn1}
                                remotePhotos={remoteThumbsForCp4Field("alarmIn1")}
                                onRemoveLocal={(file) => removeCp4LocalPhoto("alarmIn1", file)}
                                onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("alarmIn1"), remote)}
                              />
                              <PhotoUploadedBadge show={cp4Pc.alarmIn1 >= 1} />
                              <PhotoFieldError message={cp4PhotoErrors.alarmIn1} />
                              {requiredHint(cp4PhotoIssueKey("alarmIn1"))}
                              <div id="field-cp4-alarmIn1Description" className="mt-3">
                                <label className={fieldLabelClass("cp4-alarmIn1Description")}>Connection note<RequiredMark /></label>
                                <textarea
                                  className={`${fieldInputClass("cp4-alarmIn1Description")} min-h-[80px] resize-y py-3`}
                                  value={cp4AlarmIn1Description}
                                  placeholder="exp: VAC4 impact NO to ALARM IN 1, common at chassis ground"
                                  onChange={(e) => {
                                    setCp4AlarmIn1Description(e.target.value);
                                    clearFieldHighlight("cp4-alarmIn1Description");
                                  }}
                                />
                                {requiredHint("cp4-alarmIn1Description")}
                              </div>
                            </div>
                          ) : null}

                          <div id="field-cp4-alarmIn2RelayInstalled">
                            <label className={fieldLabelClass("cp4-alarmIn2RelayInstalled")}>Relay installed for ALARM IN 2?<RequiredMark /></label>
                            <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">Used for second trigger such as PPD.</p>
                            <select className={fieldSelectClass("cp4-alarmIn2RelayInstalled")} value={cp4AlarmIn2RelayInstalled} onChange={(e) => { const value = e.target.value; setCp4AlarmIn2RelayInstalled(value); clearFieldHighlight("cp4-alarmIn2RelayInstalled"); if (value !== "Yes") { clearCp4PhotoSlotAndStorage("alarmIn2"); setCp4PhotoErrors((er) => ({ ...er, alarmIn2: null })); setCp4AlarmIn2Description(""); clearFieldHighlight(cp4PhotoIssueKey("alarmIn2")); clearFieldHighlight("cp4-alarmIn2Description"); } }}>
                              <option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option>
                            </select>
                            {requiredHint("cp4-alarmIn2RelayInstalled")}
                          </div>
                          {cp4ShowAlarmIn2 ? (
                            <div id={`field-${cp4PhotoIssueKey("alarmIn2")}`}>
                              <input id="cp4-photo-alarmIn2" type="file" className="hidden" accept="image/png,image/jpeg,image/jpg" onChange={(e) => void applyCp4PhotoUpload("alarmIn2", e, "single")} />
                              <label htmlFor="cp4-photo-alarmIn2" className={photoPickClass(cp4PhotoIssueKey("alarmIn2"), true, cp4Pc.alarmIn2 >= 1)}>{PHOTO_UPLOAD_LABEL_SINGLE}</label>
                              <PhotoUploadFeedback count={cp4Pc.alarmIn2} names={cp4PhotoFileNames.alarmIn2} />
                              <PhotoThumbnailGrid
                                files={cp4PhotoFiles.alarmIn2}
                                remotePhotos={remoteThumbsForCp4Field("alarmIn2")}
                                onRemoveLocal={(file) => removeCp4LocalPhoto("alarmIn2", file)}
                                onRemoveRemote={(remote) => void removeUploadedPhotoFromField(cp4UploadFieldFor("alarmIn2"), remote)}
                              />
                              <PhotoUploadedBadge show={cp4Pc.alarmIn2 >= 1} />
                              <PhotoFieldError message={cp4PhotoErrors.alarmIn2} />
                              {requiredHint(cp4PhotoIssueKey("alarmIn2"))}
                              <div id="field-cp4-alarmIn2Description" className="mt-3">
                                <label className={fieldLabelClass("cp4-alarmIn2Description")}>Connection note<RequiredMark /></label>
                                <textarea
                                  className={`${fieldInputClass("cp4-alarmIn2Description")} min-h-[80px] resize-y py-3`}
                                  value={cp4AlarmIn2Description}
                                  placeholder="exp: PPD alarm output tied to ALARM IN 2 per install sheet"
                                  onChange={(e) => {
                                    setCp4AlarmIn2Description(e.target.value);
                                    clearFieldHighlight("cp4-alarmIn2Description");
                                  }}
                                />
                                {requiredHint("cp4-alarmIn2Description")}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              ) : renderKey === "Speed SSC" ? (
                <section key={section} className={cardClassName}>
                  <FormSectionHeader title={productLabel(section) || "SSC Speed"} tone="green" />
                  <BlaxtairSscSpeedSection
                    value={sscFields}
                    onChange={(field, value) => setSscFields((prev) => ({ ...prev, [field]: value }))}
                    getPhotoSlot={getSscPhotoSlot}
                    configFile={sscConfigFile}
                    configFileUploading={sscConfigFileUploading}
                    configFileError={sscConfigFileError}
                    onConfigFileChange={(e) => void handleSscConfigFileUpload(e)}
                    fieldLabelClass={fieldLabelClass}
                    fieldInputClass={fieldInputClass}
                    fieldSelectClass={fieldSelectClass}
                    photoPickClass={photoPickClass}
                    requiredHint={requiredHint}
                  />
                </section>
              ) : renderKey === "PPD" ? (
                <section key={section} className={cardClassName}>
                  <FormSectionHeader title={ppdSectionTitle} tone="green" />
                  {section === "blaxtair_ahd" ? (
                    <BlaxtairAhdEquipmentSection
                      system={blaxtairSystem}
                      onChangeSystem={setBlaxtairSystem}
                      fieldLabelClass={fieldLabelClass}
                      fieldInputClass={fieldInputClass}
                      fieldSelectClass={fieldSelectClass}
                      photoPickClass={photoPickClass}
                      requiredHint={requiredHint}
                      clearFieldHighlight={clearFieldHighlight}
                      getPhotoSlot={getBlaxtairPhotoSlot}
                      reviewHighlights={reviewHighlights}
                    />
                  ) : (
                    <>
                  <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                    <p className="font-semibold">Uses Vehicle Information from this card</p>
                    <p className="mt-1 text-emerald-900/90 dark:text-emerald-200/90">
                      Drive type: <span className="font-medium">{vac4DriveType.trim() || "—"}</span>
                      {vac4DriveType === "Electric" ? (
                        <>
                          {" "}
                          · Voltage:{" "}
                          <span className="font-medium">
                            {vac4VehicleVoltage === "Other"
                              ? vac4VehicleVoltageOther.trim() || "Other (not specified)"
                              : vac4VehicleVoltage.trim() || "—"}
                          </span>
                          {ppdVehicleVolts !== null ? (
                            <span className="block pt-1 text-xs font-normal text-emerald-800 dark:text-emerald-300">
                              Parsed for PPD conditionals: {ppdVehicleVolts} V
                              {ppdShowPowerConverterMounting ? " · Power converter section required (>36 V)." : ""}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </p>
                    {ppdShowAlarmOutConnections ? (
                      <p className="mt-2 text-xs font-medium text-emerald-900 dark:text-emerald-200">
                        Alarm-out photo fields are shown because VAC4 and/or Speed-family hardware is on this job card.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-6">
                    {ppdProductsWithFiles.map((product) =>
                      product.productFileDefinitions.map((def) => {
                        const slotId = productFileSlotId({
                          productKey: product.productKey,
                          fileKey: def.key,
                        });
                        const isSharedPpdJson = def.key === PPD_JSON_FILE_KEY;
                        const highlightKey = isSharedPpdJson
                          ? isOffline
                            ? "ppd-jsonOffline"
                            : "ppd-jsonFile"
                          : `product-file-${product.productKey}-${def.key}`;
                        return (
                          <ProductFileUpload
                            key={slotId}
                            productKey={product.productKey}
                            productLabel={product.displayLabel}
                            definition={def}
                            slot={productFileSlots[slotId]}
                            isOffline={isOffline}
                            highlight={hl(highlightKey)}
                            fieldDomId={isSharedPpdJson ? "field-ppd-jsonFile" : undefined}
                            requiredHint={requiredHint(highlightKey)}
                            onChange={applyProductFileSlotChange}
                            onValidationError={(message) => setDraftNoticeMessage(message)}
                            onClearHighlight={() => {
                              clearFieldHighlight(highlightKey);
                              if (isSharedPpdJson) {
                                clearFieldHighlight("ppd-jsonFile");
                                clearFieldHighlight("ppd-jsonOffline");
                              }
                            }}
                            secondaryButtonClassName={btnSecondaryClassName}
                            fieldLabelClassName={fieldLabelClass(highlightKey)}
                          />
                        );
                      }),
                    )}

                    {ppdProjectCustomerId === null &&
                    !isOffline &&
                    ppdProductsWithFiles.some((p) =>
                      p.productFileDefinitions.some((d) => d.key === PPD_JSON_FILE_KEY),
                    ) ? (
                      <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                        No customer/site linked on this project — file will be stored under customer-sites/unassigned.
                      </p>
                    ) : null}

                    <div className="grid gap-5 sm:grid-cols-2">
                      <div id="field-ppd-hubSerial" className="sm:col-span-2">
                        <SerialInput
                          label="Hub serial number"
                          required
                          labelClassName={fieldLabelClass("ppd-hubSerial")}
                          inputClassName={fieldInputClass("ppd-hubSerial")}
                          value={ppdHubSerial}
                          placeholder="Scan or type serial"
                          onChange={(v) => {
                            setPpdHubSerial(normalizePpdSerialInput(v));
                            clearFieldHighlight("ppd-hubSerial");
                          }}
                        />
                        {requiredHint("ppd-hubSerial")}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <p className={labelClassName}>Camera install locations (check all that apply)</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {PPD_CAMERA_LOCATION_OPTIONS.map(({ key, label }) => (
                          <label key={key} className={checkboxRowClassName}>
                            <input
                              type="checkbox"
                              className="h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={ppdCameraLocations.includes(key)}
                              onChange={() => togglePpdCameraLocation(key)}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                      {PPD_CAMERA_LOCATION_OPTIONS.filter((o) => ppdCameraLocations.includes(o.key)).map(({ key, serialLabel }) => (
                        <div key={key} id={`field-ppd-cameraSerial-${key}`}>
                          <SerialInput
                            label={serialLabel}
                            required
                            labelClassName={fieldLabelClass(`ppd-cameraSerial-${key}`)}
                            inputClassName={fieldInputClass(`ppd-cameraSerial-${key}`)}
                            value={ppdCameraSerialsByLocation[key]}
                            placeholder="Scan or type serial"
                            onChange={(v) => {
                              setPpdCameraSerialsByLocation((prev) => ({
                                ...prev,
                                [key]: normalizePpdSerialInput(v),
                              }));
                              clearFieldHighlight(`ppd-cameraSerial-${key}`);
                            }}
                          />
                          {requiredHint(`ppd-cameraSerial-${key}`)}
                        </div>
                      ))}
                    </div>

                    <div id="field-ppd-clientApproval" className="space-y-2">
                      <label className={fieldLabelClass("ppd-clientApproval")}>
                        Client rep. approval — name, role, date/time
                        <RequiredMark />
                      </label>
                      <textarea
                        className={`${fieldInputClass("ppd-clientApproval")} min-h-[100px] resize-y py-3`}
                        value={ppdClientApproval}
                        onChange={(e) => {
                          setPpdClientApproval(e.target.value);
                          clearFieldHighlight("ppd-clientApproval");
                        }}
                      />
                      {requiredHint("ppd-clientApproval")}
                    </div>

                    <div id="field-ppd-customBracketsNeeded">
                      <label className={fieldLabelClass("ppd-customBracketsNeeded")}>
                        Were modifications or custom brackets needed for cameras and/or hub?
                        <RequiredMark />
                      </label>
                      <select
                        className={fieldSelectClass("ppd-customBracketsNeeded")}
                        value={ppdCustomBracketsNeeded}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPpdCustomBracketsNeeded(v);
                          clearFieldHighlight("ppd-customBracketsNeeded");
                          if (v !== "Yes") {
                            setPpdCustomBracketNotes("");
                            clearFieldHighlight("ppd-customBracketNotes");
                          }
                        }}
                      >
                        <option value="">Select</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                      {requiredHint("ppd-customBracketsNeeded")}
                    </div>

                    {ppdCustomBracketsNeeded === "Yes" ? (
                      <div id="field-ppd-customBracketNotes">
                        <label className={fieldLabelClass("ppd-customBracketNotes")}>
                          Notes about modifications or custom brackets
                          <RequiredMark />
                        </label>
                        <textarea
                          className={`${fieldInputClass("ppd-customBracketNotes")} min-h-[88px] resize-y py-3`}
                          value={ppdCustomBracketNotes}
                          onChange={(e) => {
                            setPpdCustomBracketNotes(e.target.value);
                            clearFieldHighlight("ppd-customBracketNotes");
                          }}
                        />
                        {requiredHint("ppd-customBracketNotes")}
                      </div>
                    ) : null}

                    <div id="field-ppd-monitorInstalled">
                      <label className={fieldLabelClass("ppd-monitorInstalled")}>
                        Is monitor installed?
                        <RequiredMark />
                      </label>
                      <select
                        className={fieldSelectClass("ppd-monitorInstalled")}
                        value={ppdMonitorInstalled}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPpdMonitorInstalled(v);
                          clearFieldHighlight("ppd-monitorInstalled");
                          if (v !== "Yes") {
                            clearPpdPhotoSlotAndStorage("monitorInstalled");
                            setPpdPhotoErrors((er) => ({ ...er, monitorInstalled: null }));
                            clearFieldHighlight(ppdPhotoIssueKey("monitorInstalled"));
                          }
                        }}
                      >
                        <option value="">Select</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                      {requiredHint("ppd-monitorInstalled")}
                    </div>

                    {ppdMonitorInstalled === "Yes" ? (
                      <div id={`field-${ppdPhotoIssueKey("monitorInstalled")}`} className="space-y-2">
                        <label className={fieldLabelClass(ppdPhotoIssueKey("monitorInstalled"))}>
                          Monitor installation photo
                          <RequiredMark />
                        </label>
                        <input
                          id="ppd-photo-monitorInstalled"
                          type="file"
                          className="hidden"
                          accept="image/png,image/jpeg,image/jpg"
                          onChange={(e) => void applyPpdPhotoUpload("monitorInstalled", e, "single")}
                        />
                        <label
                          htmlFor="ppd-photo-monitorInstalled"
                          className={photoPickClass(ppdPhotoIssueKey("monitorInstalled"), true, ppdPc.monitorInstalled >= 1)}
                        >
                          {PHOTO_UPLOAD_LABEL_SINGLE}
                        </label>
                        <PhotoUploadFeedback count={ppdPc.monitorInstalled} names={ppdPhotoFileNames.monitorInstalled} />
                        <PhotoThumbnailGrid
                          files={ppdPhotoFiles.monitorInstalled}
                          remotePhotos={remoteThumbsForPpdField("monitorInstalled")}
                          onRemoveLocal={(file) => removePpdLocalPhoto("monitorInstalled", file)}
                          onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("monitorInstalled"), remote)}
                        />
                        <PhotoUploadedBadge show={ppdPc.monitorInstalled >= 1} />
                        <PhotoFieldError message={ppdPhotoErrors.monitorInstalled} />
                        {requiredHint(ppdPhotoIssueKey("monitorInstalled"))}
                      </div>
                    ) : null}

                    {ppdShowRelaysSpeedControlQuestion ? (
                      <div id="field-ppd-relaysSpeedControl">
                        <label className={fieldLabelClass("ppd-relaysSpeedControl")}>
                          Are relays being used for speed control?
                          <RequiredMark />
                        </label>
                        <select
                          className={fieldSelectClass("ppd-relaysSpeedControl")}
                          value={ppdRelaysUsedForSpeedControl}
                          onChange={(e) => {
                            setPpdRelaysUsedForSpeedControl(e.target.value);
                            clearFieldHighlight("ppd-relaysSpeedControl");
                          }}
                        >
                          <option value="">Select</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                        {requiredHint("ppd-relaysSpeedControl")}
                        {ppdShowBlackAlarmGround ? (
                          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                            Black wire alarm out ground photos are required when relays are used.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {/* PPD photos — uploads go to Supabase; metadata in `photoUploads` for drafts */}
                    <div className="space-y-6 border-t border-gray-100 pt-6 dark:border-gray-700">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">PPD required photos</h3>

                      <div id={`field-${ppdPhotoIssueKey("cameraHubMounting")}`}>
                        <label className={fieldLabelClass(ppdPhotoIssueKey("cameraHubMounting"))}>
                          Camera and hub mounting locations
                          <RequiredMark />
                        </label>
                        <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                          Include safety cable installation on camera mounts where applicable.
                        </p>
                        <input
                          id="ppd-photo-cameraHubMounting"
                          type="file"
                          className="hidden"
                          accept="image/png,image/jpeg,image/jpg"
                          multiple
                          onChange={(e) => void applyPpdPhotoUpload("cameraHubMounting", e, "multi")}
                        />
                        <label
                          htmlFor="ppd-photo-cameraHubMounting"
                          className={photoPickClass(ppdPhotoIssueKey("cameraHubMounting"), true, ppdPc.cameraHubMounting >= 1)}
                        >
                          {PHOTO_UPLOAD_LABEL_MULTI}
                        </label>
                        <PhotoUploadFeedback count={ppdPc.cameraHubMounting} names={ppdPhotoFileNames.cameraHubMounting} />
                        <PhotoThumbnailGrid
                          files={ppdPhotoFiles.cameraHubMounting}
                          remotePhotos={remoteThumbsForPpdField("cameraHubMounting")}
                          onRemoveLocal={(file) => removePpdLocalPhoto("cameraHubMounting", file)}
                          onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("cameraHubMounting"), remote)}
                        />
                        <PhotoUploadedBadge show={ppdPc.cameraHubMounting >= 1} />
                        <PhotoFieldError message={ppdPhotoErrors.cameraHubMounting} />
                        {requiredHint(ppdPhotoIssueKey("cameraHubMounting"))}
                      </div>

                      <div id={`field-${ppdPhotoIssueKey("wirePath")}`}>
                        <label className={fieldLabelClass(ppdPhotoIssueKey("wirePath"))}>
                          Wire path
                          <RequiredMark />
                        </label>
                        <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                          Add at least {PPD_WIRE_PATH_MIN_PHOTOS} photos (turns, clips, panel exits).
                        </p>
                        <input
                          id="ppd-photo-wirePath"
                          type="file"
                          className="hidden"
                          accept="image/png,image/jpeg,image/jpg"
                          multiple
                          onChange={(e) => void applyPpdPhotoUpload("wirePath", e, "multi")}
                        />
                        <label
                          htmlFor="ppd-photo-wirePath"
                          className={photoPickClass(
                            ppdPhotoIssueKey("wirePath"),
                            true,
                            ppdPc.wirePath >= PPD_WIRE_PATH_MIN_PHOTOS,
                          )}
                        >
                          {PHOTO_UPLOAD_LABEL_MULTI}
                        </label>
                        <PhotoUploadFeedback count={ppdPc.wirePath} names={ppdPhotoFileNames.wirePath} />
                        <PhotoThumbnailGrid
                          files={ppdPhotoFiles.wirePath}
                          remotePhotos={remoteThumbsForPpdField("wirePath")}
                          onRemoveLocal={(file) => removePpdLocalPhoto("wirePath", file)}
                          onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("wirePath"), remote)}
                        />
                        <PhotoUploadedBadge show={ppdPc.wirePath >= PPD_WIRE_PATH_MIN_PHOTOS} />
                        <PhotoFieldError message={ppdPhotoErrors.wirePath} />
                        {requiredHint(ppdPhotoIssueKey("wirePath"))}
                      </div>

                      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-700 dark:bg-gray-900/40 sm:p-5">
                        <h4 className="mb-4 text-base font-bold text-gray-900 dark:text-gray-100">Wire connections</h4>
                        <div className="space-y-6">
                          <div id={`field-${ppdPhotoIssueKey("redBattery")}`}>
                            <label className={fieldLabelClass(ppdPhotoIssueKey("redBattery"))}>
                              Red wire — battery positive (+) connection
                              <RequiredMark />
                            </label>
                            <input
                              id="ppd-photo-redBattery"
                              type="file"
                              className="hidden"
                              accept="image/png,image/jpeg,image/jpg"
                              onChange={(e) => void applyPpdPhotoUpload("redBattery", e, "single")}
                            />
                            <label
                              htmlFor="ppd-photo-redBattery"
                              className={photoPickClass(ppdPhotoIssueKey("redBattery"), true, ppdPc.redBattery >= 1)}
                            >
                              {PHOTO_UPLOAD_LABEL_SINGLE}
                            </label>
                            <PhotoUploadFeedback count={ppdPc.redBattery} names={ppdPhotoFileNames.redBattery} />
                            <PhotoThumbnailGrid
                              files={ppdPhotoFiles.redBattery}
                              remotePhotos={remoteThumbsForPpdField("redBattery")}
                              onRemoveLocal={(file) => removePpdLocalPhoto("redBattery", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("redBattery"), remote)}
                            />
                            <PhotoUploadedBadge show={ppdPc.redBattery >= 1} />
                            <PhotoFieldError message={ppdPhotoErrors.redBattery} />
                            {requiredHint(ppdPhotoIssueKey("redBattery"))}
                            <div id="field-ppd-redWireDescription" className="mt-3">
                              <label className={fieldLabelClass("ppd-redWireDescription")}>
                                Connection note
                                <RequiredMark />
                              </label>
                              <textarea
                                className={`${fieldInputClass("ppd-redWireDescription")} min-h-[80px] resize-y py-3`}
                                placeholder="exp: Battery + terminal post"
                                value={ppdRedWireDescription}
                                onChange={(e) => {
                                  setPpdRedWireDescription(e.target.value);
                                  clearFieldHighlight("ppd-redWireDescription");
                                }}
                              />
                              {requiredHint("ppd-redWireDescription")}
                            </div>
                          </div>

                          <div id={`field-${ppdPhotoIssueKey("blackBattery")}`}>
                            <label className={fieldLabelClass(ppdPhotoIssueKey("blackBattery"))}>
                              Black wire — battery negative (−) connection
                              <RequiredMark />
                            </label>
                            <input
                              id="ppd-photo-blackBattery"
                              type="file"
                              className="hidden"
                              accept="image/png,image/jpeg,image/jpg"
                              onChange={(e) => void applyPpdPhotoUpload("blackBattery", e, "single")}
                            />
                            <label
                              htmlFor="ppd-photo-blackBattery"
                              className={photoPickClass(ppdPhotoIssueKey("blackBattery"), true, ppdPc.blackBattery >= 1)}
                            >
                              {PHOTO_UPLOAD_LABEL_SINGLE}
                            </label>
                            <PhotoUploadFeedback count={ppdPc.blackBattery} names={ppdPhotoFileNames.blackBattery} />
                            <PhotoThumbnailGrid
                              files={ppdPhotoFiles.blackBattery}
                              remotePhotos={remoteThumbsForPpdField("blackBattery")}
                              onRemoveLocal={(file) => removePpdLocalPhoto("blackBattery", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("blackBattery"), remote)}
                            />
                            <PhotoUploadedBadge show={ppdPc.blackBattery >= 1} />
                            <PhotoFieldError message={ppdPhotoErrors.blackBattery} />
                            {requiredHint(ppdPhotoIssueKey("blackBattery"))}
                            <div id="field-ppd-blackWireDescription" className="mt-3">
                              <label className={fieldLabelClass("ppd-blackWireDescription")}>
                                Connection note
                                <RequiredMark />
                              </label>
                              <textarea
                                className={`${fieldInputClass("ppd-blackWireDescription")} min-h-[80px] resize-y py-3`}
                                placeholder="exp: Frame ground stud"
                                value={ppdBlackWireDescription}
                                onChange={(e) => {
                                  setPpdBlackWireDescription(e.target.value);
                                  clearFieldHighlight("ppd-blackWireDescription");
                                }}
                              />
                              {requiredHint("ppd-blackWireDescription")}
                            </div>
                          </div>

                          <div id={`field-${ppdPhotoIssueKey("yellowIgnition")}`}>
                            <label className={fieldLabelClass(ppdPhotoIssueKey("yellowIgnition"))}>
                              Yellow wire — ignition / power trigger connection
                              <RequiredMark />
                            </label>
                            <input
                              id="ppd-photo-yellowIgnition"
                              type="file"
                              className="hidden"
                              accept="image/png,image/jpeg,image/jpg"
                              onChange={(e) => void applyPpdPhotoUpload("yellowIgnition", e, "single")}
                            />
                            <label
                              htmlFor="ppd-photo-yellowIgnition"
                              className={photoPickClass(ppdPhotoIssueKey("yellowIgnition"), true, ppdPc.yellowIgnition >= 1)}
                            >
                              {PHOTO_UPLOAD_LABEL_SINGLE}
                            </label>
                            <PhotoUploadFeedback count={ppdPc.yellowIgnition} names={ppdPhotoFileNames.yellowIgnition} />
                            <PhotoThumbnailGrid
                              files={ppdPhotoFiles.yellowIgnition}
                              remotePhotos={remoteThumbsForPpdField("yellowIgnition")}
                              onRemoveLocal={(file) => removePpdLocalPhoto("yellowIgnition", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("yellowIgnition"), remote)}
                            />
                            <PhotoUploadedBadge show={ppdPc.yellowIgnition >= 1} />
                            <PhotoFieldError message={ppdPhotoErrors.yellowIgnition} />
                            {requiredHint(ppdPhotoIssueKey("yellowIgnition"))}
                            <div id="field-ppd-yellowWireDescription" className="mt-3">
                              <label className={fieldLabelClass("ppd-yellowWireDescription")}>
                                Connection note
                                <RequiredMark />
                              </label>
                              <textarea
                                className={`${fieldInputClass("ppd-yellowWireDescription")} min-h-[80px] resize-y py-3`}
                                placeholder="exp: Ignition-on signal at key switch"
                                value={ppdYellowWireDescription}
                                onChange={(e) => {
                                  setPpdYellowWireDescription(e.target.value);
                                  clearFieldHighlight("ppd-yellowWireDescription");
                                }}
                              />
                              {requiredHint("ppd-yellowWireDescription")}
                            </div>
                          </div>

                          <div id={`field-${ppdPhotoIssueKey("greyMotion")}`}>
                            <label className={fieldLabelClass(ppdPhotoIssueKey("greyMotion"))}>
                              Grey wire — motion connection
                              <RequiredMark />
                            </label>
                            <input
                              id="ppd-photo-greyMotion"
                              type="file"
                              className="hidden"
                              accept="image/png,image/jpeg,image/jpg"
                              onChange={(e) => void applyPpdPhotoUpload("greyMotion", e, "single")}
                            />
                            <label
                              htmlFor="ppd-photo-greyMotion"
                              className={photoPickClass(ppdPhotoIssueKey("greyMotion"), true, ppdPc.greyMotion >= 1)}
                            >
                              {PHOTO_UPLOAD_LABEL_SINGLE}
                            </label>
                            <PhotoUploadFeedback count={ppdPc.greyMotion} names={ppdPhotoFileNames.greyMotion} />
                            <PhotoThumbnailGrid
                              files={ppdPhotoFiles.greyMotion}
                              remotePhotos={remoteThumbsForPpdField("greyMotion")}
                              onRemoveLocal={(file) => removePpdLocalPhoto("greyMotion", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("greyMotion"), remote)}
                            />
                            <PhotoUploadedBadge show={ppdPc.greyMotion >= 1} />
                            <PhotoFieldError message={ppdPhotoErrors.greyMotion} />
                            {requiredHint(ppdPhotoIssueKey("greyMotion"))}
                            <div id="field-ppd-greyWireDescription" className="mt-3">
                              <label className={fieldLabelClass("ppd-greyWireDescription")}>
                                Connection note
                                <RequiredMark />
                              </label>
                              <textarea
                                className={`${fieldInputClass("ppd-greyWireDescription")} min-h-[80px] resize-y py-3`}
                                placeholder="exp: Motion output at controller"
                                value={ppdGreyWireDescription}
                                onChange={(e) => {
                                  setPpdGreyWireDescription(e.target.value);
                                  clearFieldHighlight("ppd-greyWireDescription");
                                }}
                              />
                              {requiredHint("ppd-greyWireDescription")}
                            </div>
                          </div>

                          <div id={`field-${ppdPhotoIssueKey("blueDirection")}`}>
                            <label className={fieldLabelClass(ppdPhotoIssueKey("blueDirection"))}>
                              Blue wire — direction connection
                              <RequiredMark />
                            </label>
                            <input
                              id="ppd-photo-blueDirection"
                              type="file"
                              className="hidden"
                              accept="image/png,image/jpeg,image/jpg"
                              onChange={(e) => void applyPpdPhotoUpload("blueDirection", e, "single")}
                            />
                            <label
                              htmlFor="ppd-photo-blueDirection"
                              className={photoPickClass(ppdPhotoIssueKey("blueDirection"), true, ppdPc.blueDirection >= 1)}
                            >
                              {PHOTO_UPLOAD_LABEL_SINGLE}
                            </label>
                            <PhotoUploadFeedback count={ppdPc.blueDirection} names={ppdPhotoFileNames.blueDirection} />
                            <PhotoThumbnailGrid
                              files={ppdPhotoFiles.blueDirection}
                              remotePhotos={remoteThumbsForPpdField("blueDirection")}
                              onRemoveLocal={(file) => removePpdLocalPhoto("blueDirection", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("blueDirection"), remote)}
                            />
                            <PhotoUploadedBadge show={ppdPc.blueDirection >= 1} />
                            <PhotoFieldError message={ppdPhotoErrors.blueDirection} />
                            {requiredHint(ppdPhotoIssueKey("blueDirection"))}
                            <div id="field-ppd-blueWireDescription" className="mt-3">
                              <label className={fieldLabelClass("ppd-blueWireDescription")}>
                                Connection note
                                <RequiredMark />
                              </label>
                              <textarea
                                className={`${fieldInputClass("ppd-blueWireDescription")} min-h-[80px] resize-y py-3`}
                                placeholder="exp: Direction signal at traction controller"
                                value={ppdBlueWireDescription}
                                onChange={(e) => {
                                  setPpdBlueWireDescription(e.target.value);
                                  clearFieldHighlight("ppd-blueWireDescription");
                                }}
                              />
                              {requiredHint("ppd-blueWireDescription")}
                            </div>
                          </div>
                        </div>
                      </div>

                      {ppdShowPowerConverterMounting ? (
                        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/30 sm:p-5">
                          <h4 className="mb-2 text-base font-bold text-gray-900 dark:text-gray-100">
                            Power converter mounting and wiring
                            <RequiredMark />
                          </h4>
                          <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
                            Shown because vehicle voltage is above 36 V (from Vehicle Information).
                          </p>
                          <div id={`field-${ppdPhotoIssueKey("powerConverter")}`}>
                            <input
                              id="ppd-photo-powerConverter"
                              type="file"
                              className="hidden"
                              accept="image/png,image/jpeg,image/jpg"
                              onChange={(e) => void applyPpdPhotoUpload("powerConverter", e, "single")}
                            />
                            <label
                              htmlFor="ppd-photo-powerConverter"
                              className={photoPickClass(ppdPhotoIssueKey("powerConverter"), true, ppdPc.powerConverter >= 1)}
                            >
                              {PHOTO_UPLOAD_LABEL_SINGLE}
                            </label>
                            <PhotoUploadFeedback count={ppdPc.powerConverter} names={ppdPhotoFileNames.powerConverter} />
                            <PhotoThumbnailGrid
                              files={ppdPhotoFiles.powerConverter}
                              remotePhotos={remoteThumbsForPpdField("powerConverter")}
                              onRemoveLocal={(file) => removePpdLocalPhoto("powerConverter", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("powerConverter"), remote)}
                            />
                            <PhotoUploadedBadge show={ppdPc.powerConverter >= 1} />
                            <PhotoFieldError message={ppdPhotoErrors.powerConverter} />
                            {requiredHint(ppdPhotoIssueKey("powerConverter"))}
                            <div id="field-ppd-powerConverterDescription" className="mt-3">
                              <label className={fieldLabelClass("ppd-powerConverterDescription")}>
                                Connection note
                                <RequiredMark />
                              </label>
                              <textarea
                                className={`${fieldInputClass("ppd-powerConverterDescription")} min-h-[80px] resize-y py-3`}
                                placeholder="exp: Converter mounted on frame rail near battery box"
                                value={ppdPowerConverterDescription}
                                onChange={(e) => {
                                  setPpdPowerConverterDescription(e.target.value);
                                  clearFieldHighlight("ppd-powerConverterDescription");
                                }}
                              />
                              {requiredHint("ppd-powerConverterDescription")}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {ppdShowAlarmOutConnections ? (
                        <div className="space-y-6 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-600 dark:bg-gray-900 sm:p-5">
                          <h4 className="text-base font-bold text-gray-900 dark:text-gray-100">Alarm-out connections</h4>
                          <div id={`field-${ppdPhotoIssueKey("redAlarmOut")}`}>
                            <label className={fieldLabelClass(ppdPhotoIssueKey("redAlarmOut"))}>
                              Red wire — alarm out connection(s)
                              <RequiredMark />
                            </label>
                            <input
                              id="ppd-photo-redAlarmOut"
                              type="file"
                              className="hidden"
                              accept="image/png,image/jpeg,image/jpg"
                              onChange={(e) => void applyPpdPhotoUpload("redAlarmOut", e, "single")}
                            />
                            <label
                              htmlFor="ppd-photo-redAlarmOut"
                              className={photoPickClass(ppdPhotoIssueKey("redAlarmOut"), true, ppdPc.redAlarmOut >= 1)}
                            >
                              {PHOTO_UPLOAD_LABEL_SINGLE}
                            </label>
                            <PhotoUploadFeedback count={ppdPc.redAlarmOut} names={ppdPhotoFileNames.redAlarmOut} />
                            <PhotoThumbnailGrid
                              files={ppdPhotoFiles.redAlarmOut}
                              remotePhotos={remoteThumbsForPpdField("redAlarmOut")}
                              onRemoveLocal={(file) => removePpdLocalPhoto("redAlarmOut", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("redAlarmOut"), remote)}
                            />
                            <PhotoUploadedBadge show={ppdPc.redAlarmOut >= 1} />
                            <PhotoFieldError message={ppdPhotoErrors.redAlarmOut} />
                            {requiredHint(ppdPhotoIssueKey("redAlarmOut"))}
                            <div id="field-ppd-redAlarmOutDescription" className="mt-3">
                              <label className={fieldLabelClass("ppd-redAlarmOutDescription")}>
                                Connection note
                                <RequiredMark />
                              </label>
                              <textarea
                                className={`${fieldInputClass("ppd-redAlarmOutDescription")} min-h-[80px] resize-y py-3`}
                                placeholder="exp: Alarm out red tied to relay coil input"
                                value={ppdRedAlarmOutDescription}
                                onChange={(e) => {
                                  setPpdRedAlarmOutDescription(e.target.value);
                                  clearFieldHighlight("ppd-redAlarmOutDescription");
                                }}
                              />
                              {requiredHint("ppd-redAlarmOutDescription")}
                            </div>
                          </div>
                          <div id={`field-${ppdPhotoIssueKey("yellowAlarmOut")}`}>
                            <label className={fieldLabelClass(ppdPhotoIssueKey("yellowAlarmOut"))}>
                              Yellow wire — alarm out connection(s)
                              <RequiredMark />
                            </label>
                            <input
                              id="ppd-photo-yellowAlarmOut"
                              type="file"
                              className="hidden"
                              accept="image/png,image/jpeg,image/jpg"
                              onChange={(e) => void applyPpdPhotoUpload("yellowAlarmOut", e, "single")}
                            />
                            <label
                              htmlFor="ppd-photo-yellowAlarmOut"
                              className={photoPickClass(ppdPhotoIssueKey("yellowAlarmOut"), true, ppdPc.yellowAlarmOut >= 1)}
                            >
                              {PHOTO_UPLOAD_LABEL_SINGLE}
                            </label>
                            <PhotoUploadFeedback count={ppdPc.yellowAlarmOut} names={ppdPhotoFileNames.yellowAlarmOut} />
                            <PhotoThumbnailGrid
                              files={ppdPhotoFiles.yellowAlarmOut}
                              remotePhotos={remoteThumbsForPpdField("yellowAlarmOut")}
                              onRemoveLocal={(file) => removePpdLocalPhoto("yellowAlarmOut", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("yellowAlarmOut"), remote)}
                            />
                            <PhotoUploadedBadge show={ppdPc.yellowAlarmOut >= 1} />
                            <PhotoFieldError message={ppdPhotoErrors.yellowAlarmOut} />
                            {requiredHint(ppdPhotoIssueKey("yellowAlarmOut"))}
                            <div id="field-ppd-yellowAlarmOutDescription" className="mt-3">
                              <label className={fieldLabelClass("ppd-yellowAlarmOutDescription")}>
                                Connection note
                                <RequiredMark />
                              </label>
                              <textarea
                                className={`${fieldInputClass("ppd-yellowAlarmOutDescription")} min-h-[80px] resize-y py-3`}
                                placeholder="exp: Alarm out yellow tied to strobe trigger input"
                                value={ppdYellowAlarmOutDescription}
                                onChange={(e) => {
                                  setPpdYellowAlarmOutDescription(e.target.value);
                                  clearFieldHighlight("ppd-yellowAlarmOutDescription");
                                }}
                              />
                              {requiredHint("ppd-yellowAlarmOutDescription")}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {ppdShowBlackAlarmGround ? (
                        <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/80 p-4 dark:border-slate-600 dark:bg-slate-900/50 sm:p-5">
                          <h4 className="mb-2 text-base font-bold text-gray-900 dark:text-gray-100">
                            Black wire — alarm out ground
                            <RequiredMark />
                          </h4>
                          <div id={`field-${ppdPhotoIssueKey("blackAlarmGround")}`}>
                            <input
                              id="ppd-photo-blackAlarmGround"
                              type="file"
                              className="hidden"
                              accept="image/png,image/jpeg,image/jpg"
                              onChange={(e) => void applyPpdPhotoUpload("blackAlarmGround", e, "single")}
                            />
                            <label
                              htmlFor="ppd-photo-blackAlarmGround"
                              className={photoPickClass(ppdPhotoIssueKey("blackAlarmGround"), true, ppdPc.blackAlarmGround >= 1)}
                            >
                              {PHOTO_UPLOAD_LABEL_SINGLE}
                            </label>
                            <PhotoUploadFeedback count={ppdPc.blackAlarmGround} names={ppdPhotoFileNames.blackAlarmGround} />
                            <PhotoThumbnailGrid
                              files={ppdPhotoFiles.blackAlarmGround}
                              remotePhotos={remoteThumbsForPpdField("blackAlarmGround")}
                              onRemoveLocal={(file) => removePpdLocalPhoto("blackAlarmGround", file)}
                              onRemoveRemote={(remote) => void removeUploadedPhotoFromField(ppdUploadFieldFor("blackAlarmGround"), remote)}
                            />
                            <PhotoUploadedBadge show={ppdPc.blackAlarmGround >= 1} />
                            <PhotoFieldError message={ppdPhotoErrors.blackAlarmGround} />
                            {requiredHint(ppdPhotoIssueKey("blackAlarmGround"))}
                            <div id="field-ppd-blackAlarmGroundDescription" className="mt-3">
                              <label className={fieldLabelClass("ppd-blackAlarmGroundDescription")}>
                                Connection note
                                <RequiredMark />
                              </label>
                              <textarea
                                className={`${fieldInputClass("ppd-blackAlarmGroundDescription")} min-h-[80px] resize-y py-3`}
                                placeholder="exp: Alarm ground tied to chassis ground stud"
                                value={ppdBlackAlarmGroundDescription}
                                onChange={(e) => {
                                  setPpdBlackAlarmGroundDescription(e.target.value);
                                  clearFieldHighlight("ppd-blackAlarmGroundDescription");
                                }}
                              />
                              {requiredHint("ppd-blackAlarmGroundDescription")}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                    </>
                  )}
                </section>
              ) : null;
            })}

        {nonPpdProductsWithFiles.length > 0 ? (
          <section className={cardClassName}>
            <FormSectionHeader title="Product Files" tone="green" />
            <div className="space-y-6">
              {nonPpdProductsWithFiles.map((product) =>
                product.productFileDefinitions.map((def) => {
                  const slotId = productFileSlotId({
                    productKey: product.productKey,
                    fileKey: def.key,
                  });
                  const highlightKey = `product-file-${product.productKey}-${def.key}`;
                  return (
                    <ProductFileUpload
                      key={slotId}
                      productKey={product.productKey}
                      productLabel={product.displayLabel}
                      definition={def}
                      slot={productFileSlots[slotId]}
                      isOffline={isOffline}
                      highlight={hl(highlightKey)}
                      requiredHint={requiredHint(highlightKey)}
                      onChange={applyProductFileSlotChange}
                      onValidationError={(message) => setDraftNoticeMessage(message)}
                      onClearHighlight={() => clearFieldHighlight(highlightKey)}
                      secondaryButtonClassName={btnSecondaryClassName}
                      fieldLabelClassName={fieldLabelClass(highlightKey)}
                    />
                  );
                }),
              )}
            </div>
          </section>
        ) : null}

        <div className="hidden md:flex md:flex-row md:flex-wrap md:justify-end md:gap-3 md:pt-2">
          <button type="button" className={btnSecondaryClassName} onClick={(event) => void handleSaveToDevice(event)}>
            <IconFloppy className="h-5 w-5" />
            Save to this device
          </button>
          <button
            type="button"
            className={btnSecondaryClassName}
            onClick={hasCoreOrVehicleInfo ? handleSaveDraftAndExit : handleExitToHome}
            disabled={isOffline}
          >
              <IconFloppy className="h-5 w-5" />
            {hasCoreOrVehicleInfo ? (isOffline ? "Save Draft (online only)" : "Save Draft and Exit") : "Exit"}
          </button>
          {hasCoreOrVehicleInfo ? (
            <button type="button" className={btnExitWithoutSaveClassName} onClick={handleExitWithoutSavingRequest}>
              Exit Without Saving
            </button>
          ) : null}
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
          <p className="text-base leading-relaxed text-gray-600 dark:text-gray-300">
            Grouped by section—confirm against the truck before you submit. Photo rows list filenames when the browser
            provides them at upload time.
          </p>
        </section>

        <section className={cardClassName}>
          <FormSectionHeader title="Core Job Info" tone="blue" />
          <div>
            <SummaryRow label="Customer" value={coreJob.customer} />
            <SummaryRow label="Location" value={coreJob.location} />
            {isLinxUpProfile ? (
              <>
                <SummaryRow label="Primary contact" value={coreJob.primaryContact ?? ""} />
                <SummaryRow label="Contact number" value={coreJob.contactNumber ?? ""} />
                <SummaryRow label="Contact email" value={coreJob.contactEmail ?? ""} />
              </>
            ) : (
              <>
                <SummaryRow label="Work order #" value={formatWorkOrder(coreJob.workOrder)} />
                <SummaryRow label="Service appointment #" value={formatServiceAppointment(coreJob.serviceAppointment)} />
              </>
            )}
            <SummaryRow label="Installer name" value={coreJob.installerName} />
          </div>
        </section>

        <section className={cardClassName}>
          <FormSectionHeader title="Vehicle Information" tone="purple" />
          <div>
            {isLinxUpProfile && <SummaryRow label="Year" value={linxupYear} />}
            <SummaryRow label="Make" value={coreJob.equipmentMake} />
            <SummaryRow label="Model" value={coreJob.equipmentModel} />
            <SummaryRow
              label={isLinxUpProfile ? "Serial/VIN" : "Serial #"}
              value={coreJob.equipmentSerial}
            />
            <SummaryRow
              label={isLinxUpProfile ? "Asset Number" : "Unit #"}
              value={coreJob.unitNumber}
            />
            {isLinxUpProfile ? (
              <>
                <SummaryRow label="Vehicle type" value={linxupVehicleType} />
                <SummaryRow label="Hours / miles" value={linxupHoursMiles} />
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </section>

        <section className={cardClassName}>
          <FormSectionHeader title="Vehicle Pictures" tone="purple" />
          <div>
            <SummaryRow
              label="Vehicle front photo(s)"
              value={reviewPhotoSummary(vehiclePictureCounts.vehicleFront, vehiclePictureFileNames.vehicleFront)}
            />
            <SummaryRow
              label="Vehicle side photo(s)"
              value={reviewPhotoSummary(vehiclePictureCounts.vehicleSide, vehiclePictureFileNames.vehicleSide)}
            />
            <SummaryRow
              label="Vehicle rear photo(s)"
              value={reviewPhotoSummary(vehiclePictureCounts.vehicleRear, vehiclePictureFileNames.vehicleRear)}
            />
          </div>
        </section>

        <section className={cardClassName}>
          <FormSectionHeader
            title={isLinxUpProfile ? "Product Selection" : "Hardware Selection"}
            tone="green"
          />
          <div>
            <SummaryRow
              label={isLinxUpProfile ? "Product / install type" : "Primary hardware / install type"}
              value={selectedPrimaryForm?.label || effectivePrimary}
            />
            <SummaryRow
              label={isLinxUpProfile ? "Additional device being installed?" : "Additional hardware being installed?"}
              value={hasAdditional}
            />
            <SummaryRow
              label={isLinxUpProfile ? "Additional devices" : "Additional hardware types"}
              value={
                selectedAdditional.length
                  ? selectedAdditional.map((type) => productLabel(type) || type).join(", ")
                  : "—"
              }
            />
            {!isLinxUpProfile && (
              <SummaryRow
                label="Hardware units on this card"
                value={
                  selectedSections.length
                    ? selectedSections.map((type) => productLabel(type) || type).join(", ")
                    : "—"
                }
              />
            )}
            {isLinxUpProfile && (
              <SummaryRow
                label="Devices on this card"
                value={
                  selectedSections.length
                    ? selectedSections.map((type) => productLabel(type) || type).join(", ")
                    : "—"
                }
              />
            )}
            {isLinxUpProfile && selectedPrimaryForm && (
              <SummaryRow label="Submission type" value={selectedPrimaryForm.submissionType} />
            )}
          </div>
        </section>

        {isLinxUpVehicleTracker && (
          <section className={cardClassName}>
            <FormSectionHeader title="Vehicle Tracker" tone="green" />
            <div>
              <SummaryRow
                label="Vehicle tracker tag photo"
                value={reviewPhotoSummary(linxupVtPc.vehicleTrackerTag, linxupVtPhotoFileNames.vehicleTrackerTag)}
              />
              <SummaryRow label="Connected via OBD Port" value={linxupVtObdPortConnected || "—"} />
              {linxupVtObdPortConnected === "Yes" && (
                <>
                  <SummaryRow
                    label="Green activity light photo"
                    value={reviewPhotoSummary(linxupVtPc.greenActivityLight, linxupVtPhotoFileNames.greenActivityLight)}
                  />
                  <SummaryRow
                    label="Installation photo"
                    value={reviewPhotoSummary(linxupVtPc.installation, linxupVtPhotoFileNames.installation)}
                  />
                  <SummaryRow label="Installation notes" value={linxupVtInstallationNotes} />
                </>
              )}
              {linxupVtObdPortConnected === "No" && (
                <>
                  <SummaryRow
                    label="Power connection photo"
                    value={reviewPhotoSummary(linxupVtPc.powerConnection, linxupVtPhotoFileNames.powerConnection)}
                  />
                  <SummaryRow label="Power connection note" value={linxupVtPowerConnectionDescription} />
                  <SummaryRow
                    label="Ground connection photo"
                    value={reviewPhotoSummary(linxupVtPc.groundConnection, linxupVtPhotoFileNames.groundConnection)}
                  />
                  <SummaryRow label="Ground connection note" value={linxupVtGroundConnectionDescription} />
                  <SummaryRow
                    label="Ignition connection photo"
                    value={reviewPhotoSummary(linxupVtPc.ignitionConnection, linxupVtPhotoFileNames.ignitionConnection)}
                  />
                  <SummaryRow label="Ignition connection note" value={linxupVtIgnitionConnectionDescription} />
                  <SummaryRow
                    label="Green activity light photo"
                    value={reviewPhotoSummary(linxupVtPc.greenActivityLight, linxupVtPhotoFileNames.greenActivityLight)}
                  />
                  <SummaryRow
                    label="Final installation photo"
                    value={reviewPhotoSummary(linxupVtPc.finalInstall, linxupVtPhotoFileNames.finalInstall)}
                  />
                  <SummaryRow label="Installation notes" value={linxupVtInstallationNotes} />
                </>
              )}
            </div>
          </section>
        )}

        {isLinxUpLinxCam && (
          <section className={cardClassName}>
            <FormSectionHeader title="LinxCam" tone="green" />
            <div>
              <SummaryRow
                label="LinxCam tag photo"
                value={reviewPhotoSummary(linxupLcPc.linxCamTag, linxupLcPhotoFileNames.linxCamTag)}
              />
              <SummaryRow label="Connected via OBD Port" value={linxupLcObdPortConnected || "—"} />
              {linxupLcObdPortConnected === "Yes" && (
                <>
                  <SummaryRow
                    label="Green activity light photo"
                    value={reviewPhotoSummary(linxupLcPc.greenActivityLight, linxupLcPhotoFileNames.greenActivityLight)}
                  />
                  <SummaryRow
                    label="Installation photo"
                    value={reviewPhotoSummary(linxupLcPc.installation, linxupLcPhotoFileNames.installation)}
                  />
                </>
              )}
              {linxupLcObdPortConnected === "No" && (
                <>
                  <SummaryRow
                    label="Power connection photo"
                    value={reviewPhotoSummary(linxupLcPc.powerConnection, linxupLcPhotoFileNames.powerConnection)}
                  />
                  <SummaryRow label="Power connection note" value={linxupLcPowerConnectionDescription} />
                  <SummaryRow
                    label="Ground connection photo"
                    value={reviewPhotoSummary(linxupLcPc.groundConnection, linxupLcPhotoFileNames.groundConnection)}
                  />
                  <SummaryRow label="Ground connection note" value={linxupLcGroundConnectionDescription} />
                  <SummaryRow
                    label="Ignition connection photo"
                    value={reviewPhotoSummary(linxupLcPc.ignitionConnection, linxupLcPhotoFileNames.ignitionConnection)}
                  />
                  <SummaryRow label="Ignition connection note" value={linxupLcIgnitionConnectionDescription} />
                  <SummaryRow
                    label="Green activity light photo"
                    value={reviewPhotoSummary(linxupLcPc.greenActivityLight, linxupLcPhotoFileNames.greenActivityLight)}
                  />
                  <SummaryRow
                    label="Final installation photo"
                    value={reviewPhotoSummary(linxupLcPc.finalInstall, linxupLcPhotoFileNames.finalInstall)}
                  />
                  <SummaryRow label="Installation notes" value={linxupLcInstallationNotes} />
                </>
              )}
            </div>
          </section>
        )}

        {isLinxUpAssetTracker && (
          <section className={cardClassName}>
            <FormSectionHeader title="Asset Tracker" tone="green" />
            <div>
              <SummaryRow
                label="Asset tracker tag photo"
                value={reviewPhotoSummary(linxupAtPc.assetTrackerTag, linxupAtPhotoFileNames.assetTrackerTag)}
              />
              <SummaryRow
                label="Power connection photo"
                value={reviewPhotoSummary(linxupAtPc.powerConnection, linxupAtPhotoFileNames.powerConnection)}
              />
              <SummaryRow label="Power connection note" value={linxupPowerConnectionDescription} />
              <SummaryRow
                label="Ground connection photo"
                value={reviewPhotoSummary(linxupAtPc.groundConnection, linxupAtPhotoFileNames.groundConnection)}
              />
              <SummaryRow label="Ground connection note" value={linxupGroundConnectionDescription} />
              <SummaryRow
                label="Ignition connection photo"
                value={reviewPhotoSummary(linxupAtPc.ignitionConnection, linxupAtPhotoFileNames.ignitionConnection)}
              />
              <SummaryRow label="Ignition connection note" value={linxupIgnitionConnectionDescription} />
              <SummaryRow
                label="Final install photo"
                value={reviewPhotoSummary(linxupAtPc.finalInstall, linxupAtPhotoFileNames.finalInstall)}
              />
            </div>
          </section>
        )}

        {!isLinxUpProfile && selectedSections
          .filter((s) => resolveEffective(s) !== "VAC4")
            .map((section) => {
              const renderKey = resolveEffective(section);
              const ppdSectionTitle =
                section === "PPD" ? "PPD / Pedestrian hardware" : productLabel(section) || section;
              return renderKey === "CP4" ? (
              <section key={`review-hw-${section}`} className={cardClassName}>
                <FormSectionHeader title="CP4 hardware" tone="green" />
                <div>
                  <SummaryRow label="DRID" value={cp4Drid} />
                  <SummaryRow label="Serial #" value={cp4Serial} />
                  <SummaryRow label="Camera count" value={cp4CameraQuantity} />
                  <SummaryRow label="Monitor installed?" value={cp4MonitorInstalled} />
                  <SummaryRow label="Client rep. approval" value={cp4ClientApproval} />
                  <SummaryRow label="Custom brackets needed?" value={cp4CustomBracketsNeeded} />
                  {cp4CustomBracketsNeeded === "Yes" ? <SummaryRow label="Custom bracket notes" value={cp4CustomBracketNotes} /> : null}
                  <SummaryRow label="Vehicle voltage (from Vehicle Info)" value={String(cp4VehicleVolts ?? "—")} />
                  <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
                    <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Photos</p>
                    <SummaryRow label="Camera mount" value={reviewPhotoSummary(cp4Pc.cameraMounting, cp4PhotoFileNames.cameraMounting)} />
                    <SummaryRow label="Wire path" value={reviewPhotoSummary(cp4Pc.wirePath, cp4PhotoFileNames.wirePath)} />
                    <SummaryRow label="DVR mount" value={reviewPhotoSummary(cp4Pc.hubMounting, cp4PhotoFileNames.hubMounting)} />
                    <SummaryRow label="DVR mount — note" value={cp4HubMountingDescription} />
                    <SummaryRow
                      label="Microphone mount"
                      value={reviewPhotoSummary(cp4Pc.microphoneMounting, cp4PhotoFileNames.microphoneMounting)}
                    />
                    <SummaryRow label="Microphone — note" value={cp4MicrophoneMountingDescription} />
                    <SummaryRow
                      label="Remote control mount"
                      value={reviewPhotoSummary(cp4Pc.remoteControlMounting, cp4PhotoFileNames.remoteControlMounting)}
                    />
                    <SummaryRow label="Remote control — note" value={cp4RemoteControlMountingDescription} />
                    <SummaryRow
                      label="GPS sensor mount"
                      value={reviewPhotoSummary(cp4Pc.gpsSensorMounting, cp4PhotoFileNames.gpsSensorMounting)}
                    />
                    <SummaryRow label="GPS sensor — note" value={cp4GpsSensorMountingDescription} />
                    <SummaryRow label="Red (+) battery" value={reviewPhotoSummary(cp4Pc.redBattery, cp4PhotoFileNames.redBattery)} />
                    <SummaryRow label="Red (+) — note" value={cp4RedWireDescription} />
                    <SummaryRow
                      label="Black (−) battery"
                      value={reviewPhotoSummary(cp4Pc.blackBattery, cp4PhotoFileNames.blackBattery)}
                    />
                    <SummaryRow label="Black (−) — note" value={cp4BlackWireDescription} />
                    <SummaryRow
                      label="White ignition / trigger"
                      value={reviewPhotoSummary(cp4Pc.whiteIgnition, cp4PhotoFileNames.whiteIgnition)}
                    />
                    <SummaryRow label="White — note" value={cp4WhiteWireDescription} />
                    {cp4ShowMonitorMounting ? (
                      <>
                        <SummaryRow label="Monitor mount" value={reviewPhotoSummary(cp4Pc.monitorMounting, cp4PhotoFileNames.monitorMounting)} />
                        <SummaryRow label="Monitor — note" value={cp4MonitorMountingDescription} />
                      </>
                    ) : null}
                    {cp4ShowPowerConverterMounting ? (
                      <>
                        <SummaryRow label="Power converter" value={reviewPhotoSummary(cp4Pc.powerConverter, cp4PhotoFileNames.powerConverter)} />
                        <SummaryRow label="Power converter — note" value={cp4PowerConverterDescription} />
                      </>
                    ) : null}
                    <SummaryRow label="Relay installed for ALARM IN 1?" value={cp4AlarmIn1RelayInstalled} />
                    {cp4ShowAlarmIn1 ? (
                      <>
                        <SummaryRow label="Alarm IN 1 photo" value={reviewPhotoSummary(cp4Pc.alarmIn1, cp4PhotoFileNames.alarmIn1)} />
                        <SummaryRow label="Alarm IN 1 — note" value={cp4AlarmIn1Description} />
                      </>
                    ) : null}
                    <SummaryRow label="Relay installed for ALARM IN 2?" value={cp4AlarmIn2RelayInstalled} />
                    {cp4ShowAlarmIn2 ? (
                      <>
                        <SummaryRow label="Alarm IN 2 photo" value={reviewPhotoSummary(cp4Pc.alarmIn2, cp4PhotoFileNames.alarmIn2)} />
                        <SummaryRow label="Alarm IN 2 — note" value={cp4AlarmIn2Description} />
                      </>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : renderKey === "Speed SSC" ? (
              <section key={`review-hw-${section}`} className={cardClassName}>
                <FormSectionHeader title={productLabel(section) || "SSC Speed"} tone="green" />
                <div>
                  <SummaryRow label="Connected via" value={sscFields.connectionType} />
                  <SummaryRow label="Power connection" value={sscFields.powerDescription} />
                  <SummaryRow label="Ground connection" value={sscFields.groundDescription} />
                  <SummaryRow label="Ignition connection" value={sscFields.ignitionDescription} />
                  {sscFields.connectionType === "Hardwire" ? (
                    <>
                      <SummaryRow label="Speed signal" value={sscFields.speedSignalDescription} />
                      <SummaryRow label="Has direction signal?" value={sscFields.hasDirectionSignal ? "Yes" : "No"} />
                      {sscFields.hasDirectionSignal ? (
                        <SummaryRow label="Direction signal" value={sscFields.directionDescription} />
                      ) : null}
                    </>
                  ) : null}
                  <SummaryRow label="Configuration file" value={sscConfigFile?.originalFileName ?? ""} />
                </div>
              </section>
            ) : renderKey === "PPD" ? (
              <section key={`review-hw-${section}`} className={cardClassName}>
                <FormSectionHeader title={ppdSectionTitle} tone="green" />
                {section === "blaxtair_ahd" ? (
                  <BlaxtairAhdReviewSummary system={blaxtairSystem} getPhotoSlot={getBlaxtairPhotoSlot} />
                ) : (
                <div>
                  <SummaryRow label="Hub serial #" value={ppdHubSerial} />
                  <SummaryRow label="Camera serials" value={ppdCameraSerialsReviewSummary} />
                  <SummaryRow label="Client rep. approval" value={ppdClientApproval} />
                  <SummaryRow
                    label="PPD JSON file"
                    value={ppdJsonLocalFile?.name || ppdJsonFileName || "—"}
                  />
                  {ppdProductsWithFiles.flatMap((product) =>
                    product.productFileDefinitions
                      .filter(
                        (d) =>
                          d.includeInReview &&
                          d.active &&
                          d.key !== PPD_JSON_FILE_KEY,
                      )
                      .map((def) => {
                        const slotId = productFileSlotId({
                          productKey: product.productKey,
                          fileKey: def.key,
                        });
                        const slot = productFileSlots[slotId];
                        const names = [
                          ...(slot?.localFiles.map((f) => f.name) ?? []),
                          ...(slot?.uploaded.map((u) => u.originalFileName) ?? []),
                        ];
                        return (
                          <SummaryRow
                            key={slotId}
                            label={`${def.label} (${product.displayLabel})`}
                            value={names.length ? names.join(", ") : "—"}
                          />
                        );
                      }),
                  )}
                  <SummaryRow label="Modifications or custom brackets needed?" value={ppdCustomBracketsNeeded} />
                  {ppdCustomBracketsNeeded === "Yes" ? (
                    <SummaryRow label="Notes (modifications / brackets)" value={ppdCustomBracketNotes} />
                  ) : null}
                  <SummaryRow label="Monitor installed?" value={ppdMonitorInstalled} />
                  {ppdMonitorInstalled === "Yes" ? (
                    <SummaryRow
                      label="Monitor installation photo"
                      value={reviewPhotoSummary(ppdPc.monitorInstalled, ppdPhotoFileNames.monitorInstalled)}
                    />
                  ) : null}
                  {ppdShowRelaysSpeedControlQuestion ? (
                    <SummaryRow label="Relays used for speed control?" value={ppdRelaysUsedForSpeedControl} />
                  ) : null}
                  <SummaryRow label="Vehicle voltage (from Vehicle Info)" value={String(ppdVehicleVolts ?? "—")} />
                  <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
                    <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Photos</p>
                    <SummaryRow
                      label="Camera & hub mounting"
                      value={reviewPhotoSummary(ppdPc.cameraHubMounting, ppdPhotoFileNames.cameraHubMounting)}
                    />
                    <SummaryRow label="Wire path" value={reviewPhotoSummary(ppdPc.wirePath, ppdPhotoFileNames.wirePath)} />
                    <SummaryRow
                      label="Red — battery +"
                      value={reviewPhotoSummary(ppdPc.redBattery, ppdPhotoFileNames.redBattery)}
                    />
                    <SummaryRow label="Red (+) — note" value={ppdRedWireDescription} />
                    <SummaryRow
                      label="Black — battery −"
                      value={reviewPhotoSummary(ppdPc.blackBattery, ppdPhotoFileNames.blackBattery)}
                    />
                    <SummaryRow label="Black (−) — note" value={ppdBlackWireDescription} />
                    <SummaryRow
                      label="Yellow — ignition / power trigger"
                      value={reviewPhotoSummary(ppdPc.yellowIgnition, ppdPhotoFileNames.yellowIgnition)}
                    />
                    <SummaryRow label="Yellow — note" value={ppdYellowWireDescription} />
                    <SummaryRow label="Grey — motion" value={reviewPhotoSummary(ppdPc.greyMotion, ppdPhotoFileNames.greyMotion)} />
                    <SummaryRow label="Grey — note" value={ppdGreyWireDescription} />
                    <SummaryRow
                      label="Blue — direction"
                      value={reviewPhotoSummary(ppdPc.blueDirection, ppdPhotoFileNames.blueDirection)}
                    />
                    <SummaryRow label="Blue — note" value={ppdBlueWireDescription} />
                    {ppdShowPowerConverterMounting ? (
                      <>
                        <SummaryRow
                          label="Power converter"
                          value={reviewPhotoSummary(ppdPc.powerConverter, ppdPhotoFileNames.powerConverter)}
                        />
                        <SummaryRow label="Power converter — note" value={ppdPowerConverterDescription} />
                      </>
                    ) : null}
                    {ppdShowAlarmOutConnections ? (
                      <>
                        <SummaryRow
                          label="Red alarm out"
                          value={reviewPhotoSummary(ppdPc.redAlarmOut, ppdPhotoFileNames.redAlarmOut)}
                        />
                        <SummaryRow label="Red alarm out — note" value={ppdRedAlarmOutDescription} />
                        <SummaryRow
                          label="Yellow alarm out"
                          value={reviewPhotoSummary(ppdPc.yellowAlarmOut, ppdPhotoFileNames.yellowAlarmOut)}
                        />
                        <SummaryRow label="Yellow alarm out — note" value={ppdYellowAlarmOutDescription} />
                      </>
                    ) : null}
                    {ppdShowBlackAlarmGround ? (
                      <>
                        <SummaryRow
                          label="Black alarm out ground"
                          value={reviewPhotoSummary(ppdPc.blackAlarmGround, ppdPhotoFileNames.blackAlarmGround)}
                        />
                        <SummaryRow label="Black alarm ground — note" value={ppdBlackAlarmGroundDescription} />
                      </>
                    ) : null}
                  </div>
                </div>
                )}
              </section>
            ) : (
              <section key={`review-hw-${section}`} className={cardClassName}>
                <FormSectionHeader
                  title={`${productLabel(section) || section} Section`}
                  tone="green"
                />
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                  This hardware type is on the card; use the form for full details (not shown in this summary).
                </p>
              </section>
            );
          })}

        {!isLinxUpProfile && selectedIncludeEffective(selectedSections, "VAC4") && (
          <section className={cardClassName}>
            <FormSectionHeader title="VAC4 hardware" tone="purple" />
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
              <SummaryRow label="Client rep. approval" value={vac4ClientApproval} />
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
                      <SummaryRow label="Speed sense — note" value={speedSenseDescription} />
                      <SummaryRow label="Speed sense pulse count" value={speedSensePulseCount} />
                    </>
                  )}
                  {loadSenseInstalled === "Yes" && <SummaryRow label="Load sense thresholds (VAC)" value={loadSenseThresholds} />}
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
              <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Photos</p>
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
          <button
            type="button"
            className={btnPrimaryClassName}
            onClick={handleFinalSubmit}
            disabled={isOffline || submitPersistStatus === "saving"}
          >
            <IconSend className="h-5 w-5" />
            {isOffline
              ? "Offline — Submit Disabled"
              : submitPersistStatus === "saving"
                ? "Submitting…"
                : "Confirm & Submit"}
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
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
            {step === "form" ? (
              <>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className={`${btnSecondaryClassName} min-w-0 flex-1 text-sm sm:text-base`}
                    onClick={(event) => void handleSaveToDevice(event)}
                  >
                    <IconFloppy className="h-5 w-5 shrink-0" />
                    <span className="truncate">Save to this device</span>
                  </button>
                  <button
                    type="button"
                    className={`${btnSecondaryClassName} min-w-0 flex-1 text-sm sm:text-base`}
                    onClick={hasCoreOrVehicleInfo ? handleSaveDraftAndExit : handleExitToHome}
                    disabled={isOffline}
                  >
                    <IconFloppy className="h-5 w-5 shrink-0" />
                    <span className="truncate">
                      {hasCoreOrVehicleInfo ? (isOffline ? "Save Draft (online only)" : "Save Draft and Exit") : "Exit"}
                    </span>
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
                </div>
                {hasCoreOrVehicleInfo ? (
                  <button
                    type="button"
                    className={`${btnExitWithoutSaveClassName} w-full text-sm sm:text-base`}
                    onClick={handleExitWithoutSavingRequest}
                  >
                    Exit Without Saving
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button type="button" className={`${btnSecondaryClassName} min-w-0 flex-1 text-sm sm:text-base`} onClick={handleBackToForm}>
                  <span className="truncate">Back to Edit</span>
                </button>
                <button
                  type="button"
                  className={`${btnPrimaryClassName} min-w-0 flex-1 text-sm sm:text-base`}
                  onClick={handleFinalSubmit}
                  disabled={isOffline || submitPersistStatus === "saving"}
                >
                  <IconSend className="h-5 w-5 shrink-0" />
                  <span className="line-clamp-2 text-left leading-tight">
                    {isOffline
                      ? "Offline — Submit Disabled"
                      : submitPersistStatus === "saving"
                        ? "Submitting…"
                        : "Confirm & Submit"}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {emailSubmissionPreview && pendingEmailPayload ? (
        <EmailSendConfirmModal
          open={emailSendModalOpen}
          title="Confirm & Send Email"
          confirmLabel="Send Email"
          model={emailSubmissionPreview.model}
          payload={pendingEmailPayload}
          sending={emailSendStatus === "sending"}
          errorMessage={emailSendStatus === "error" ? emailSendErrorMessage : null}
          onClose={() => setEmailSendModalOpen(false)}
          onConfirm={(mode) => void handleConfirmSendEmail(mode)}
        />
      ) : null}

      {exitWithoutSavingOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="presentation"
          onClick={handleExitWithoutSavingDismiss}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-without-saving-title"
            className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-600 dark:bg-gray-900 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="exit-without-saving-title" className="text-lg font-bold text-gray-950 dark:text-gray-100">
              Exit without saving?
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Any unsaved changes will be lost.</p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" className={btnSecondaryClassName} onClick={handleExitWithoutSavingDismiss}>
                Stay
              </button>
              <button type="button" className={btnExitWithoutSaveClassName} onClick={handleExitWithoutSavingConfirm}>
                Leave
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Supabase may rewrite invite redirect_to to Site URL (/). Keep the root
    // page from bouncing invite sessions into /home -> /login before accept-invite.
    if (typeof window !== "undefined" && urlLooksLikeInviteAuthCallback(window.location.href)) {
      return;
    }
    router.replace("/home");
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl px-4 sm:px-5 sm:py-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <p className="text-sm font-medium text-gray-700">Opening home...</p>
          <Link href="/home" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:underline">
            Continue
          </Link>
        </section>
      </div>
    </main>
  );
}
