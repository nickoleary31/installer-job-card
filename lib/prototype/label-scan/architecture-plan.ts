/**
 * Architecture plan notes for label-scan + install guides (prototype only).
 * Not imported by production job-card code.
 */

export const LABEL_SCAN_ARCHITECTURE_PLAN = {
  scope: "initial_three_families",
  deviceFamilies: [
    "linxup_asset_tracker",
    "linxup_vehicle_tracker",
    "linxup_linxcam",
  ] as const,
  classifierTargets: "deviceFamily only — never OBD vs JBUS from label",
  vehicleTrackerVariants: ["obd_ii", "jbus"] as const,
  guideUx: {
    placement: "top of identified device section",
    actions: ["View Installation Guide"],
    openMode: ["new_tab", "in_app_viewer_preserving_form"],
    neverNavigateAwayWithoutWarning: true,
    nonBlockingIfUnavailable: true,
  },
  dataModel: "vehicle job + installedDevices[] + shared vehicle block outside array",
  formRegistry: {
    keepLegacyFormIds: true,
    dualWriteLegacyLinxupPayload: true,
    futureFieldsOnFormDefinition: [
      "deviceFamilyId",
      "labelExtractionProfileId",
      "installGuideByVariant",
    ],
  },
  admin: {
    planned: [
      "edit sourceUrl",
      "upload/replace cached PDF",
      "set version + lastVerifiedAt",
      "preferred/fallback source",
      "disable outdated guide",
    ],
    storage: "private guides bucket + signed/internal URL API — separate from job-card photos",
  },
  pwaOffline: {
    recommend: "cache_on_first_open",
    invalidateOn: "guide.version change",
    note: "PDF size may be several MB each — do not pre-cache all guides on install of the PWA",
  },
  licensing: "Flag cached manufacturer PDFs for copyright/redistribution review before production hosting",
  rolloutSequence: [
    "1. Prototype: classify family → confirm → VT variant → guide link → identifiers",
    "2. Pilot: single device on existing formId dual-path",
    "3. installedDevices[] + another-device loop",
    "4. Admin guide upload + signed URLs",
    "5. Retire device-first LinxUp form picker",
  ],
} as const;
