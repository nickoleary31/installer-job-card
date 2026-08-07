/**
 * Full local demo job-card data model — extends the equipment-only prototype into a complete,
 * realistic installation record. Still entirely local: no Supabase, no Storage, no Resend.
 * See docs/Blaxtair_Demo_Duplicate_Detection.md and docs/Blaxtair_Demo_Full_Job_Card.md.
 */

import type { InstalledProductSystem } from "../product-devices/types.ts";
import type { PhotoCategory } from "./photo-dedup-registry.ts";

export const JOB_CARD_STAGES = [
  "job_site",
  "vehicle",
  "equipment",
  "connections",
  "photos",
  "notes",
  "review",
] as const;

export type JobCardStage = (typeof JOB_CARD_STAGES)[number];

export type JobCardStatus = "draft" | "completed";

export type BlaxtairJobSiteInfo = {
  company: string;
  project: string;
  customer: string;
  siteName: string;
  siteAddress: string;
  siteContactName: string;
  siteContactPhone: string;
  siteContactEmail: string;
  technician: string;
  installationDate: string;
};

export type BlaxtairVehicleInfo = {
  unitNumber: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  licensePlate: string;
  odometerOrHours: string;
  assetType: string;
  notes: string;
};

/** A connection point the technician can mark "Not applicable" instead of forcing empty text. */
export type ConnectionDetail = {
  applicable: boolean;
  point: string;
  description: string;
};

export type BlaxtairInstallationDetails = {
  power: ConnectionDetail;
  ground: ConnectionDetail;
  ignition: ConnectionDetail;
  deviceMountingLocation: string;
  cableRouting: string;
  cameraMountingNotes: string;
  generalNotes: string;
};

export type BlaxtairJobCardPhoto = {
  id: string;
  category: PhotoCategory;
  label: string;
  description: string;
  localPreview: string;
  contentFingerprint: string;
  uploadedAt: string;
};

export type BlaxtairRevisionMeta = {
  /** Null for the first submission in a chain; the chain root's id for every later revision. */
  originalSubmissionId: string | null;
  revisionNumber: number;
  /** id of the record this one supersedes — null for the first submission. */
  supersedes: string | null;
  reason: string | null;
  revisedBy: string | null;
  revisedAt: string | null;
  changedFields: string[];
};

export type BlaxtairDemoJobCard = {
  id: string;
  status: JobCardStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  currentStage: JobCardStage;
  jobSite: BlaxtairJobSiteInfo;
  vehicle: BlaxtairVehicleInfo;
  installation: BlaxtairInstallationDetails;
  equipment: InstalledProductSystem | null;
  photos: BlaxtairJobCardPhoto[];
  technicianNotes: string;
  revision: BlaxtairRevisionMeta;
};

function emptyConnection(): ConnectionDetail {
  return { applicable: true, point: "", description: "" };
}

export function emptyJobSiteInfo(): BlaxtairJobSiteInfo {
  return {
    company: "",
    project: "",
    customer: "",
    siteName: "",
    siteAddress: "",
    siteContactName: "",
    siteContactPhone: "",
    siteContactEmail: "",
    technician: "",
    installationDate: new Date().toISOString().slice(0, 10),
  };
}

export function emptyVehicleInfo(): BlaxtairVehicleInfo {
  return {
    unitNumber: "",
    vin: "",
    year: "",
    make: "",
    model: "",
    licensePlate: "",
    odometerOrHours: "",
    assetType: "",
    notes: "",
  };
}

export function emptyInstallationDetails(): BlaxtairInstallationDetails {
  return {
    power: emptyConnection(),
    ground: emptyConnection(),
    ignition: emptyConnection(),
    deviceMountingLocation: "",
    cableRouting: "",
    cameraMountingNotes: "",
    generalNotes: "",
  };
}

export function emptyRevisionMeta(): BlaxtairRevisionMeta {
  return {
    originalSubmissionId: null,
    revisionNumber: 1,
    supersedes: null,
    reason: null,
    revisedBy: null,
    revisedAt: null,
    changedFields: [],
  };
}

export function createEmptyJobCard(id: string, nowIso?: string): BlaxtairDemoJobCard {
  const now = nowIso ?? new Date().toISOString();
  return {
    id,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    currentStage: "job_site",
    jobSite: emptyJobSiteInfo(),
    vehicle: emptyVehicleInfo(),
    installation: emptyInstallationDetails(),
    equipment: null,
    photos: [],
    technicianNotes: "",
    revision: emptyRevisionMeta(),
  };
}

/** Every fingerprint on this job card — equipment label photos plus the general gallery. */
export function collectJobCardPhotoFingerprints(jobCard: BlaxtairDemoJobCard): Array<{ id: string; fingerprint: string }> {
  const out: Array<{ id: string; fingerprint: string }> = [];
  for (const p of jobCard.photos) {
    if (p.contentFingerprint.trim()) out.push({ id: p.id, fingerprint: p.contentFingerprint });
  }
  for (const c of jobCard.equipment?.components ?? []) {
    const fp = c.labelPhoto?.contentFingerprint?.trim();
    if (fp) out.push({ id: c.id, fingerprint: fp });
  }
  return out;
}

/** Every (partNumber, serialNumber) pair on this job card's confirmed equipment. */
export function collectJobCardDeviceKeys(
  jobCard: BlaxtairDemoJobCard,
): Array<{ componentId: string; partNumber: string; serialNumber: string }> {
  return (jobCard.equipment?.components ?? [])
    .filter((c) => (c.identifiers.serialNumber ?? "").trim())
    .map((c) => ({
      componentId: c.id,
      partNumber: c.identifiers.partNumber ?? "",
      serialNumber: c.identifiers.serialNumber ?? "",
    }));
}

/** Same-form photo-reuse guard across the WHOLE job card (gallery + equipment labels), not just one list. */
export function findDuplicateFingerprintInJobCard(
  jobCard: BlaxtairDemoJobCard,
  excludeId: string,
  fingerprint: string,
): { id: string; fingerprint: string } | null {
  const target = fingerprint.trim();
  if (!target) return null;
  return collectJobCardPhotoFingerprints(jobCard).find((f) => f.id !== excludeId && f.fingerprint === target) ?? null;
}

const REQUIRED_PHOTO_CATEGORIES: Array<{ category: PhotoCategory; label: string; connection?: "power" | "ground" | "ignition" }> = [
  { category: "vehicle_overview", label: "Vehicle / asset overview" },
  { category: "vin", label: "VIN / identifying label" },
  { category: "odometer", label: "Odometer / engine-hours display" },
  { category: "power_connection", label: "Power connection", connection: "power" },
  { category: "ground_connection", label: "Ground connection", connection: "ground" },
  { category: "ignition_connection", label: "Ignition connection", connection: "ignition" },
  { category: "device_mounting", label: "Device / monitor mounting" },
  { category: "camera_mounting", label: "Camera mounting" },
  { category: "camera_view", label: "Camera viewing position" },
  { category: "completed_installation", label: "Completed installation" },
];

export type ValidationIssue = { stage: JobCardStage; message: string };

export type JobCardValidationResult = {
  /** Missing-but-required items. Blocking in "technician_strict" mode, warning-only in "qa_relaxed". */
  required: ValidationIssue[];
  /** Missing-but-optional items. Never blocks, in either mode — informational only. */
  optional: ValidationIssue[];
};

function connectionLabel(key: "power" | "ground" | "ignition"): string {
  return key === "power" ? "Power" : key === "ground" ? "Ground" : "Ignition";
}

/**
 * Classifies every missing-info gap on the job card into "required" (a production form would
 * treat this as mandatory) vs "optional" (nice to have, never enforced). Severity — whether a
 * "required" gap actually blocks completion — is a function of the demo's validation mode, not
 * of this classification; see `lib/prototype/blaxtair-validation-mode.ts` and `ReviewSection.tsx`.
 *
 * The demo does not currently define a required technician acknowledgement/notes field — notes
 * are always optional here. A production form config could add one; this function is the single
 * place that would need a new required check for it.
 */
export function computeJobCardValidation(jobCard: BlaxtairDemoJobCard): JobCardValidationResult {
  const required: ValidationIssue[] = [];
  const optional: ValidationIssue[] = [];

  // Job / Site
  if (!jobCard.jobSite.company.trim()) required.push({ stage: "job_site", message: "Company is not set." });
  if (!jobCard.jobSite.customer.trim()) required.push({ stage: "job_site", message: "Customer is not set." });
  if (!jobCard.jobSite.technician.trim()) required.push({ stage: "job_site", message: "Technician is not set." });
  if (!jobCard.jobSite.siteName.trim()) required.push({ stage: "job_site", message: "Site name is not set." });
  if (!jobCard.jobSite.project.trim() || !jobCard.jobSite.siteAddress.trim() || !jobCard.jobSite.siteContactName.trim()) {
    optional.push({ stage: "job_site", message: "Project, site address, and/or site contact details are not filled in." });
  }

  // Vehicle / asset
  if (!jobCard.vehicle.vin.trim() && !jobCard.vehicle.unitNumber.trim()) {
    required.push({ stage: "vehicle", message: "Neither a VIN/asset identifier nor a unit number is set." });
  }
  if (!jobCard.vehicle.year.trim() || !jobCard.vehicle.make.trim() || !jobCard.vehicle.model.trim() || !jobCard.vehicle.licensePlate.trim()) {
    optional.push({ stage: "vehicle", message: "Some vehicle details (year/make/model/plate) are not filled in." });
  }

  // Equipment
  if (!jobCard.equipment) {
    required.push({ stage: "equipment", message: "No equipment has been added yet." });
  } else {
    const unconfirmed = jobCard.equipment.components.filter((c) => !c.technicianConfirmed);
    if (unconfirmed.length) {
      required.push({
        stage: "equipment",
        message: `${unconfirmed.length} equipment component${unconfirmed.length === 1 ? " is" : "s are"} not yet confirmed.`,
      });
    }
  }

  // Connections & installation details
  for (const key of ["power", "ground", "ignition"] as const) {
    const c = jobCard.installation[key];
    if (!c.applicable) continue;
    if (!c.point.trim() || !c.description.trim()) {
      required.push({
        stage: "connections",
        message: `${connectionLabel(key)} connection point/description is required (or mark Not applicable).`,
      });
    }
  }
  if (!jobCard.installation.deviceMountingLocation.trim()) {
    required.push({ stage: "connections", message: "Device/monitor mounting location is required." });
  }
  if (!jobCard.installation.cableRouting.trim() || !jobCard.installation.cameraMountingNotes.trim() || !jobCard.installation.generalNotes.trim()) {
    optional.push({ stage: "connections", message: "Cable routing and/or additional mounting notes are not filled in." });
  }

  // Photos
  for (const req of REQUIRED_PHOTO_CATEGORIES) {
    if (req.connection && !jobCard.installation[req.connection].applicable) continue;
    if (!jobCard.photos.some((p) => p.category === req.category)) {
      required.push({ stage: "photos", message: `Missing photo: ${req.label}.` });
    }
  }
  if (!jobCard.photos.some((p) => p.category === "equipment_label")) {
    optional.push({ stage: "photos", message: "Optional equipment label / rating-plate photo not added." });
  }

  // Technician notes — optional in this demo; see doc comment above.
  if (!jobCard.technicianNotes.trim()) {
    optional.push({ stage: "notes", message: "Technician notes are empty." });
  }

  return { required, optional };
}

/**
 * @deprecated Prefer `computeJobCardValidation(jobCard).required` — kept for callers that only
 * need the flat required-issue message list.
 */
export function computeJobCardWarnings(jobCard: BlaxtairDemoJobCard): string[] {
  return computeJobCardValidation(jobCard).required.map((issue) => issue.message);
}
