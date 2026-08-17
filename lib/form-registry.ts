/**
 * Central registry: form/product definitions and per-company assignments.
 * Form availability for New Submission must come from this module — not scattered company-name checks.
 *
 * Job-card catalog consumption should prefer lib/product-config (normalized products + lookup maps).
 * These helpers remain the registry fallback for historical email/review and companies without DB rows.
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
   * Blaxtair products use unique keys even when they alias a shared base form.
   */
  sectionKey: string;
  displayOrder: number;
  active: boolean;
  /**
   * Optional shared base form to reuse (UI, validation, email/photo inclusion)
   * without duplicating field components. Alias products keep their own id/sectionKey.
   */
  baseFormId?: string;
};

export type CompanySlug = "powerfleet" | "matrix" | "linxup" | "blaxtair";

/** Existing Blaxtair company row in production Supabase (do not re-seed). */
export const BLAXTAIR_COMPANY_ID = "b3d9abe4-e457-4bb4-935b-4bb01920df89";
export const BLAXTAIR_COMPANY_NAME = "Blaxtair";

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
  // Blaxtair products — unique ids; PPD-family reuse Matrix PPD via baseFormId.
  {
    id: "blaxtair_ahd",
    label: "Blaxtair AHD",
    submissionType: "blaxtair_ahd",
    profileId: "legacy_hardware",
    draftKey: "blaxtair_ahd",
    sectionKey: "blaxtair_ahd",
    baseFormId: "ppd",
    displayOrder: 200,
    active: true,
  },
  {
    id: "blaxtair_mr130_mr260",
    label: "Blaxtair MR130-MR260",
    submissionType: "blaxtair_mr130_mr260",
    profileId: "legacy_hardware",
    draftKey: "blaxtair_mr130_mr260",
    sectionKey: "blaxtair_mr130_mr260",
    baseFormId: "ppd",
    displayOrder: 210,
    active: true,
  },
  {
    id: "blaxtair_origin",
    label: "Blaxtair Origin",
    submissionType: "blaxtair_origin",
    profileId: "legacy_hardware",
    draftKey: "blaxtair_origin",
    sectionKey: "blaxtair_origin",
    baseFormId: "ppd",
    displayOrder: 220,
    active: true,
  },
  {
    id: "blaxtair_3",
    label: "Blaxtair 3",
    submissionType: "blaxtair_3",
    profileId: "legacy_hardware",
    draftKey: "blaxtair_3",
    sectionKey: "blaxtair_3",
    baseFormId: "ppd",
    displayOrder: 230,
    active: true,
  },
  {
    id: "blaxtair_ssc_speed",
    label: "SSC Speed",
    submissionType: "blaxtair_ssc_speed",
    profileId: "legacy_hardware",
    draftKey: "blaxtair_ssc_speed",
    sectionKey: "blaxtair_ssc_speed",
    baseFormId: "speed_ssc",
    displayOrder: 240,
    active: true,
  },
  {
    id: "blaxtair_5",
    label: "Blaxtair 5",
    submissionType: "blaxtair_5",
    profileId: "legacy_hardware",
    draftKey: "blaxtair_5",
    sectionKey: "blaxtair_5",
    baseFormId: "ppd",
    displayOrder: 250,
    active: true,
  },
] as const;

/** Company display name → slug (compatibility helper only). */
export const COMPANY_NAME_TO_SLUG: Record<string, CompanySlug> = {
  powerfleet: "powerfleet",
  matrix: "matrix",
  linxup: "linxup",
  blaxtair: "blaxtair",
};

export const COMPANY_FORM_ASSIGNMENTS: Record<CompanySlug, readonly string[]> = {
  powerfleet: ["vac4", "cp4", "ppd", "speed_transmon", "speed_ssc", "ftxw"],
  /** Confirmed: Pedestrian/PPD + both Speed Control forms (Transmon and SSC). */
  matrix: ["ppd", "speed_transmon", "speed_ssc"],
  linxup: ["linxup_vehicle_tracker", "linxup_asset_tracker", "linxup_linxcam", "linxup_dash_cam"],
  blaxtair: [
    "blaxtair_ahd",
    "blaxtair_mr130_mr260",
    "blaxtair_origin",
    "blaxtair_3",
    "blaxtair_5",
    "blaxtair_ssc_speed",
  ],
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

/**
 * Resolve the section key used for shared UI/validation (follows baseFormId aliases).
 * Example: blaxtair_ahd → PPD; blaxtair_ssc_speed → Speed SSC; PPD → PPD.
 * Registry-only — for DB-backed products pass ProductLookupMaps via
 * resolveEffectiveSectionKeyWithLookup in lib/product-config.
 */
export function resolveEffectiveSectionKey(sectionKey: string | null | undefined): string {
  if (!sectionKey) return "";
  const def = getFormDefinitionBySectionKey(sectionKey);
  if (def?.baseFormId) {
    const base = getFormDefinitionById(def.baseFormId);
    return base?.sectionKey ?? sectionKey;
  }
  return sectionKey;
}

/** True when any selected section (or its base alias) matches the target section key. */
export function selectedSectionsIncludeEffective(
  selectedSections: readonly string[] | null | undefined,
  targetSectionKey: string,
): boolean {
  return (selectedSections ?? []).some((s) => resolveEffectiveSectionKey(s) === targetSectionKey);
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

/** Blaxtair PPD-family devices (AHD / MR130-MR260 / Origin / Blaxtair 3), not SSC Speed. */
export function isBlaxtairDeviceSectionKey(sectionKey: string | null | undefined): boolean {
  const def = getFormDefinitionBySectionKey(sectionKey);
  return !!def && def.id.startsWith("blaxtair_") && def.baseFormId === "ppd";
}

export function isBlaxtairSscSpeedSectionKey(sectionKey: string | null | undefined): boolean {
  return (sectionKey || "").trim() === "blaxtair_ssc_speed";
}

/**
 * Friendly UI/email label for a section key (registry only).
 * For DB-backed display labels, use getProductLabelWithLookup + ProductDisplayContext.
 */
export function getFormLabelBySectionKey(sectionKey: string | null | undefined): string {
  const key = (sectionKey || "").trim();
  if (!key) return "";
  return getFormDefinitionBySectionKey(key)?.label || key;
}

/** Join section keys as registry labels (stable IDs stay in storage). */
export function formatSectionKeysAsLabels(sectionKeys: readonly string[] | null | undefined): string {
  return (sectionKeys ?? [])
    .map((key) => getFormLabelBySectionKey(key))
    .filter(Boolean)
    .join(", ");
}

/**
 * Forms shown in the primary product dropdown.
 * Blaxtair: SSC Speed may also be primary (added standalone to an already-installed system) —
 * getAllowedAdditionalSectionKeys already handles the SSC-as-primary pairing case below.
 */
export function getAllowedPrimaryForms(companyName: string | null | undefined): FormDefinition[] {
  return getFormsForCompanyName(companyName);
}

/**
 * Additional/secondary options for the current primary.
 * Blaxtair: device primary → SSC Speed only (never two PPD devices).
 * SSC Speed primary (e.g. added standalone to an existing system) → a device only.
 * Matrix / other companies: unchanged (all other assigned forms).
 */
export function getAllowedAdditionalSectionKeys(
  companyName: string | null | undefined,
  primarySectionKey: string | null | undefined,
): string[] {
  const primary = (primarySectionKey || "").trim();
  const allowed = getFormsForCompanyName(companyName)
    .map((f) => f.sectionKey)
    .filter((key) => key !== primary);

  if (resolveCompanySlug(companyName) !== "blaxtair") {
    return allowed;
  }

  if (isBlaxtairDeviceSectionKey(primary)) {
    return allowed.filter((key) => key === "blaxtair_ssc_speed");
  }

  // SSC Speed as primary (added standalone to an existing system) may pair with one device.
  if (isBlaxtairSscSpeedSectionKey(primary)) {
    return allowed.filter((key) => isBlaxtairDeviceSectionKey(key));
  }

  return allowed;
}

/** True when additional selections obey Blaxtair/Matrix pairing rules for the primary. */
export function areAdditionalSectionKeysAllowed(
  companyName: string | null | undefined,
  primarySectionKey: string | null | undefined,
  additionalSectionKeys: readonly string[] | null | undefined,
): boolean {
  const allowed = new Set(getAllowedAdditionalSectionKeys(companyName, primarySectionKey));
  const extras = additionalSectionKeys ?? [];
  if (extras.some((key) => !allowed.has(key))) return false;

  // Never allow two Blaxtair PPD devices on one card (primary + additional, or two additionals).
  const deviceKeys = [primarySectionKey, ...extras].filter((key) => isBlaxtairDeviceSectionKey(key));
  if (new Set(deviceKeys).size > 1) return false;

  return true;
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
