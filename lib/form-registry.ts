/**
 * Central registry: form/product definitions and per-company assignments.
 * Form availability for New Submission must come from this module — not scattered company-name checks.
 */

export type FormProfileId = "legacy_hardware" | "linxup_install";

export type FormDefinition = {
  /** Stable registry id (also used as submissionType for new forms). */
  id: string;
  /** UI label */
  label: string;
  /** Persisted on submissions; for legacy forms matches historical selectedSections values. */
  submissionType: string;
  /** Which field profile / UI to render */
  profileId: FormProfileId;
  /** Base draft/autosave key segment */
  draftKey: string;
  /**
   * Value stored in hardwareSelection.primary / selectedSections for backward compatibility.
   * Legacy forms keep VAC4/CP4/PPD/etc. LinxUp forms use their stable id.
   */
  sectionKey: string;
  displayOrder: number;
  active: boolean;
};

export type CompanySlug = "powerfleet" | "matrix" | "linxup";

export const FORM_DEFINITIONS: readonly FormDefinition[] = [
  {
    id: "vac4",
    label: "VAC4",
    submissionType: "VAC4",
    profileId: "legacy_hardware",
    draftKey: "vac4",
    sectionKey: "VAC4",
    displayOrder: 10,
    active: true,
  },
  {
    id: "cp4",
    label: "CP4",
    submissionType: "CP4",
    profileId: "legacy_hardware",
    draftKey: "cp4",
    sectionKey: "CP4",
    displayOrder: 20,
    active: true,
  },
  {
    id: "ppd",
    label: "PPD",
    submissionType: "PPD",
    profileId: "legacy_hardware",
    draftKey: "ppd",
    sectionKey: "PPD",
    displayOrder: 30,
    active: true,
  },
  {
    id: "speed_transmon",
    label: "Speed Transmon",
    submissionType: "Speed Transmon",
    profileId: "legacy_hardware",
    draftKey: "speed_transmon",
    sectionKey: "Speed Transmon",
    displayOrder: 40,
    active: true,
  },
  {
    id: "speed_ssc",
    label: "Speed SSC",
    submissionType: "Speed SSC",
    profileId: "legacy_hardware",
    draftKey: "speed_ssc",
    sectionKey: "Speed SSC",
    displayOrder: 50,
    active: true,
  },
  {
    id: "ftxw",
    label: "FTxw",
    submissionType: "FTxw",
    profileId: "legacy_hardware",
    draftKey: "ftxw",
    sectionKey: "FTxw",
    displayOrder: 60,
    active: true,
  },
  {
    id: "linxup_vehicle_tracker",
    label: "Vehicle Tracker",
    submissionType: "linxup_vehicle_tracker",
    profileId: "linxup_install",
    draftKey: "linxup_vehicle_tracker",
    sectionKey: "linxup_vehicle_tracker",
    displayOrder: 100,
    active: true,
  },
  {
    id: "linxup_asset_tracker",
    label: "Asset Tracker",
    submissionType: "linxup_asset_tracker",
    profileId: "linxup_install",
    draftKey: "linxup_asset_tracker",
    sectionKey: "linxup_asset_tracker",
    displayOrder: 110,
    active: true,
  },
  {
    id: "linxup_linxcam",
    label: "LinxCam",
    submissionType: "linxup_linxcam",
    profileId: "linxup_install",
    draftKey: "linxup_linxcam",
    sectionKey: "linxup_linxcam",
    displayOrder: 120,
    active: true,
  },
  {
    id: "linxup_dash_cam",
    label: "Dash Cam",
    submissionType: "linxup_dash_cam",
    profileId: "linxup_install",
    draftKey: "linxup_dash_cam",
    sectionKey: "linxup_dash_cam",
    displayOrder: 130,
    active: true,
  },
] as const;

/** Company display name → slug (compatibility helper only). */
export const COMPANY_NAME_TO_SLUG: Record<string, CompanySlug> = {
  powerfleet: "powerfleet",
  matrix: "matrix",
  linxup: "linxup",
};

export const COMPANY_FORM_ASSIGNMENTS: Record<CompanySlug, readonly string[]> = {
  powerfleet: ["vac4", "cp4", "ppd", "speed_transmon", "speed_ssc", "ftxw"],
  /** Confirmed: Pedestrian/PPD + both Speed Control forms (Transmon and SSC). */
  matrix: ["ppd", "speed_transmon", "speed_ssc"],
  linxup: ["linxup_vehicle_tracker", "linxup_asset_tracker", "linxup_linxcam", "linxup_dash_cam"],
};

const formsById = new Map(FORM_DEFINITIONS.map((f) => [f.id, f]));
const formsBySectionKey = new Map(FORM_DEFINITIONS.map((f) => [f.sectionKey, f]));

export function resolveCompanySlug(companyName: string | null | undefined): CompanySlug | null {
  const key = (companyName || "").trim().toLowerCase();
  if (!key) return null;
  return COMPANY_NAME_TO_SLUG[key] ?? null;
}

export function getFormDefinitionById(id: string | null | undefined): FormDefinition | undefined {
  if (!id) return undefined;
  return formsById.get(id);
}

export function getFormDefinitionBySectionKey(sectionKey: string | null | undefined): FormDefinition | undefined {
  if (!sectionKey) return undefined;
  return formsBySectionKey.get(sectionKey);
}

export function getFormsForCompanySlug(slug: CompanySlug | null | undefined): FormDefinition[] {
  if (!slug) return [];
  const ids = COMPANY_FORM_ASSIGNMENTS[slug] || [];
  return ids
    .map((id) => formsById.get(id))
    .filter((f): f is FormDefinition => !!f && f.active)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

export function getFormsForCompanyName(companyName: string | null | undefined): FormDefinition[] {
  return getFormsForCompanySlug(resolveCompanySlug(companyName));
}

/** True if sectionKey (primary/additional) is allowed for this company. */
export function isSectionKeyAllowedForCompany(
  companyName: string | null | undefined,
  sectionKey: string | null | undefined,
): boolean {
  if (!sectionKey) return false;
  const allowed = getFormsForCompanyName(companyName);
  return allowed.some((f) => f.sectionKey === sectionKey);
}

export function isLinxUpFormId(formId: string | null | undefined): boolean {
  const def = getFormDefinitionById(formId);
  return def?.profileId === "linxup_install";
}

export function isLinxUpSectionKey(sectionKey: string | null | undefined): boolean {
  const def = getFormDefinitionBySectionKey(sectionKey);
  return def?.profileId === "linxup_install";
}

export function buildFormScopedAutosaveKey(args: {
  companyId: string;
  projectId: string;
  formId: string;
}): string {
  return `jobCard_autosave:${args.companyId}:${args.projectId}:${args.formId}`;
}
