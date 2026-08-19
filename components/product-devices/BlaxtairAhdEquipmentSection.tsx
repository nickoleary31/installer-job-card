"use client";

/**
 * Blaxtair AHD equipment section for the production job card (/new-submission).
 * Renders only when the selected product resolves to "blaxtair_ahd" (see app/page.tsx).
 *
 * Reuses the tested Blaxtair OCR engine and same-form duplicate check from the standalone
 * demo (lib/prototype/label-scan/blaxtair-bridge.ts, blaxtair-draft.ts — both pure, DOM-free
 * functions with no demo-only side effects) and the shared, already-production-namespaced
 * device model (lib/product-devices). Photo capture/upload reuses the exact same Supabase
 * Storage pipeline as every other product (see getPhotoSlot prop, wired in app/page.tsx to
 * uploadPhotosToStorage/applyPpdPhotoUpload) — no separate storage path, no thumbnail-only
 * localStorage. See docs/Blaxtair_Demo_Full_Job_Card.md for the prototype this was built from.
 */
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import {
  BLAXTAIR_AHD_CAMERA_MAX,
  BLAXTAIR_AHD_CAMERA_MIN,
  MANUAL_FALLBACK_REASON_LABELS,
  MOUNTING_LOCATION_LABELS,
  VIEW_DIRECTION_LABELS,
  applyBlaxtairCameraCount,
  buildInstalledProductSystem,
  BLAXTAIR_AHD_PRODUCT_DEFINITION,
  setSystemExternalAlarm,
  updateComponentFields,
  type DeviceIdentifiers,
  type InstalledProductComponent,
  type InstalledProductSystem,
  type ManualFallbackReason,
  type MountingLocationId,
  type ViewDirectionId,
  type WireLeadState,
} from "@/lib/product-devices";
import { findDuplicateDeviceInSystem } from "@/lib/prototype/label-scan/blaxtair-draft";
import {
  PhotoFieldError,
  PhotoThumbnailGrid,
  PhotoUploadedBadge,
  PhotoUploadFeedback,
  PHOTO_UPLOAD_LABEL_SINGLE,
  RequiredMark,
  SummaryRow,
  type RemoteThumb,
} from "@/components/JobCardPhotoControls";
import { SerialInput } from "@/components/SerialInput";

export type BlaxtairPhotoSlotKey =
  | "blaxtairCamera1"
  | "blaxtairCamera2"
  | "blaxtairCamera3"
  | "blaxtairCamera4"
  | "blaxtairMonitor"
  | "blaxtairMonitorMounting"
  | "blaxtairCamera1Mounting"
  | "blaxtairCamera2Mounting"
  | "blaxtairCamera3Mounting"
  | "blaxtairCamera4Mounting"
  | "blaxtairCamera1WireGround"
  | "blaxtairCamera1WireOut1"
  | "blaxtairCamera1WireOut2"
  | "blaxtairCamera1WireOut3"
  | "blaxtairCamera1WireIn1"
  | "blaxtairCamera2WireGround"
  | "blaxtairCamera2WireOut1"
  | "blaxtairCamera2WireOut2"
  | "blaxtairCamera2WireOut3"
  | "blaxtairCamera2WireIn1"
  | "blaxtairCamera3WireGround"
  | "blaxtairCamera3WireOut1"
  | "blaxtairCamera3WireOut2"
  | "blaxtairCamera3WireOut3"
  | "blaxtairCamera3WireIn1"
  | "blaxtairCamera4WireGround"
  | "blaxtairCamera4WireOut1"
  | "blaxtairCamera4WireOut2"
  | "blaxtairCamera4WireOut3"
  | "blaxtairCamera4WireIn1"
  | "blaxtairMonitorWireGround"
  | "blaxtairMonitorWirePower"
  | "blaxtairMonitorWireIgnition"
  | "blaxtairMonitorWireTrigger1"
  | "blaxtairMonitorWireTrigger2"
  | "blaxtairMonitorWireTrigger3"
  | "blaxtairMonitorWireTrigger4"
  | "blaxtairMonitorWireTrigger5"
  | "blaxtairAlarmMounting"
  | "blaxtairWirePath"
  | "blaxtairCamera1WirePhotos"
  | "blaxtairCamera2WirePhotos"
  | "blaxtairCamera3WirePhotos"
  | "blaxtairCamera4WirePhotos"
  | "blaxtairMonitorWirePhotos";

export type BlaxtairPhotoSlot = {
  files: File[];
  remoteThumbs: RemoteThumb[];
  error: string | null;
  uploadedCount: number;
  persistStatus?: "uploading" | "saved" | "failed";
  onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemoveLocal: (file: File) => void;
  onRemoveRemote: (remote: RemoteThumb) => void;
};

function photoSlotKeyForComponent(component: InstalledProductComponent): BlaxtairPhotoSlotKey | null {
  if (component.componentType === "monitor") return "blaxtairMonitor";
  const match = /^camera_([1-4])$/.exec(component.slotKey);
  return match ? (`blaxtairCamera${match[1]}` as BlaxtairPhotoSlotKey) : null;
}

/** Cameras in slot order, then monitor last — the order the technician works through the list. */
function orderComponents(system: InstalledProductSystem): InstalledProductComponent[] {
  const cameras = system.components
    .filter((c) => c.componentType === "camera")
    .slice()
    .sort((a, b) => (a.slotKey < b.slotKey ? -1 : 1));
  const monitor = system.components.find((c) => c.componentType === "monitor");
  return [...cameras, ...(monitor ? [monitor] : [])];
}

function locationLabel(id: MountingLocationId | null | undefined, other?: string): string {
  if (!id) return "—";
  if (id === "other") return other?.trim() || "Other";
  return MOUNTING_LOCATION_LABELS[id];
}

function viewLabel(id: ViewDirectionId | null | undefined, other?: string): string {
  if (!id) return "—";
  if (id === "other") return other?.trim() || "Other";
  return VIEW_DIRECTION_LABELS[id];
}

type WireDef = { key: string; label: string; required: boolean };

/** Blaxtair AHD camera wire leads — none required by default, checkbox-gated. */
const CAMERA_WIRE_DEFS: WireDef[] = [
  { key: "ground", label: "Black — Ground", required: false },
  { key: "out1", label: "Red — Out 1", required: false },
  { key: "out2", label: "Yellow — Out 2", required: false },
  { key: "out3", label: "Green — Out 3", required: false },
  { key: "in1", label: "White — In 1", required: false },
];

/** Blaxtair AHD monitor wire leads — Ground/Power/Ignition always required; triggers checkbox-gated. */
const MONITOR_WIRE_DEFS: WireDef[] = [
  { key: "ground", label: "Black — Ground", required: true },
  { key: "power", label: "Red — Constant Power", required: true },
  { key: "ignition", label: "Orange — Ignition", required: true },
  { key: "trigger1", label: "White — Trigger 1", required: false },
  { key: "trigger2", label: "Blue — Trigger 2", required: false },
  { key: "trigger3", label: "Green — Trigger 3", required: false },
  { key: "trigger4", label: "Brown — Trigger 4", required: false },
  { key: "trigger5", label: "Yellow — Trigger 5", required: false },
];

function cameraMountingPhotoSlotKey(cameraIndex: number): BlaxtairPhotoSlotKey {
  return `blaxtairCamera${cameraIndex}Mounting` as BlaxtairPhotoSlotKey;
}

function emptyWireLead(): WireLeadState {
  return { used: false, description: "" };
}

/**
 * One wire-lead row: optional "used" checkbox (required wires skip it), then connection-point
 * text. Photos for all of a component's wires are captured once, together, in the combined
 * wire-connection-photos gallery below the wire list — not per wire.
 */
function BlaxtairWireLeadField(props: {
  wireDef: WireDef;
  wire: WireLeadState;
  highlightKey: string;
  highlighted: boolean;
  onToggleUsed: (used: boolean) => void;
  onDescriptionChange: (value: string) => void;
  fieldLabelClass: (key: string) => string;
  fieldInputClass: (key: string) => string;
  requiredHint: (key: string) => ReactNode;
}) {
  const { wireDef, wire } = props;
  const show = wireDef.required || wire.used;
  return (
    <div
      className={`rounded-xl border p-3 ${
        props.highlighted && show
          ? "border-red-400 bg-red-50/60 dark:border-red-700 dark:bg-red-950/30"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {wireDef.label}
          {wireDef.required ? <RequiredMark /> : null}
        </span>
        {!wireDef.required ? (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={wire.used} onChange={(e) => props.onToggleUsed(e.target.checked)} />
            Used
          </label>
        ) : null}
      </div>
      {show ? (
        <div className="mt-3">
          <div id={`field-${props.highlightKey}-description`}>
            <label className={props.fieldLabelClass(`${props.highlightKey}-description`)}>
              Connection point
              <RequiredMark />
            </label>
            <input
              className={props.fieldInputClass(`${props.highlightKey}-description`)}
              placeholder="Describe where/how this wire connects"
              value={wire.description}
              onChange={(e) => props.onDescriptionChange(e.target.value)}
            />
            {props.requiredHint(`${props.highlightKey}-description`)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The camera-label QR code encodes "partNumber|serialNumber" in one payload — split it across both fields. */
function splitScannedPartNumber(value: string): { partNumber: string; serialNumber: string | null } {
  if (!value.includes("|")) return { partNumber: value, serialNumber: null };
  const [pnRaw, snRaw] = value.split("|");
  return { partNumber: (pnRaw ?? "").trim(), serialNumber: (snRaw ?? "").trim() || null };
}

type IdentifierDraft = { partNumber: string; serialNumber: string; ipAddress: string };

function draftFromIdentifiers(ids: DeviceIdentifiers): IdentifierDraft {
  return {
    partNumber: ids.partNumber ?? "",
    serialNumber: ids.serialNumber ?? "",
    ipAddress: ids.ipAddress ?? "",
  };
}

function identifiersFromDraft(draft: IdentifierDraft): DeviceIdentifiers {
  const out: DeviceIdentifiers = {};
  if (draft.partNumber.trim()) out.partNumber = draft.partNumber.trim();
  if (draft.serialNumber.trim()) out.serialNumber = draft.serialNumber.trim();
  if (draft.ipAddress.trim()) out.ipAddress = draft.ipAddress.trim();
  return out;
}

/** Full, uncropped label preview (object-contain) — the shared PhotoThumbnailGrid below stays small/cropped by design for every other category, so label photos get their own larger view here. */
function BlaxtairLabelPhotoPreview({ photoSlot }: { photoSlot: BlaxtairPhotoSlot | null }) {
  const localFile = photoSlot?.files[0] ?? null;
  const localUrl = useMemo(() => (localFile ? URL.createObjectURL(localFile) : null), [localFile]);

  useEffect(() => {
    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [localUrl]);

  const remote = photoSlot?.remoteThumbs[0] ?? null;
  const src = remote?.publicUrl || localUrl;
  if (!src) return null;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Full label photo" className="max-h-[28rem] w-full object-contain" />
    </div>
  );
}

export function BlaxtairAhdEquipmentSection(props: {
  system: InstalledProductSystem | null;
  onChangeSystem: (system: InstalledProductSystem | null) => void;
  fieldLabelClass: (key: string) => string;
  fieldInputClass: (key: string) => string;
  fieldSelectClass: (key: string) => string;
  photoPickClass: (key: string, required: boolean, complete: boolean) => string;
  requiredHint: (key: string) => ReactNode;
  clearFieldHighlight: (key: string) => void;
  getPhotoSlot: (key: BlaxtairPhotoSlotKey) => BlaxtairPhotoSlot;
  /** Keys pushed by collectReviewValidationIssues when "Review & Submit" finds this incomplete. */
  reviewHighlights: Set<string>;
}) {
  const { system, onChangeSystem: setSystem, reviewHighlights } = props;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, IdentifierDraft>>({});
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [manualReasons, setManualReasons] = useState<Record<string, ManualFallbackReason>>({});

  function componentWireDefs(component: InstalledProductComponent): WireDef[] {
    return component.componentType === "monitor" ? MONITOR_WIRE_DEFS : CAMERA_WIRE_DEFS;
  }

  function isComponentHighlighted(component: InstalledProductComponent): boolean {
    const key = `blaxtair-${component.id}`;
    if (reviewHighlights.has(key)) return true;
    if (component.componentType === "monitor" && reviewHighlights.has(`${key}-mountingPhoto`)) return true;
    if (component.componentType === "camera" && reviewHighlights.has(`${key}-installPhoto`)) return true;
    if (reviewHighlights.has(`${key}-wirePhotos`)) return true;
    for (const wireDef of componentWireDefs(component)) {
      if (reviewHighlights.has(`${key}-wire-${wireDef.key}`)) return true;
    }
    return false;
  }

  // "Review & Submit" pushes precise per-component keys into reviewHighlights when something is
  // missing — jump straight to the first incomplete one so it isn't hidden behind "Collapse".
  useEffect(() => {
    if (!system) return;
    const firstBad = orderComponents(system).find((c) => isComponentHighlighted(c));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local expand/collapse UI state to the parent's review-highlight signal, not a render-loop risk (only fires when reviewHighlights is replaced by a fresh Review click)
    if (firstBad) setExpandedId(firstBad.id);
    // Re-run only when the highlight set is replaced (a fresh Review click) or the system changes —
    // not on every unrelated re-render, which would fight the technician's manual collapse/expand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system, reviewHighlights]);

  function draftFor(component: InstalledProductComponent): IdentifierDraft {
    return drafts[component.id] ?? draftFromIdentifiers(component.identifiers);
  }

  /**
   * Commits an identifier draft into the actual system state immediately (not just local
   * `drafts`), so a draft-save before "Confirm" still persists what's been typed/scanned so
   * far. Deliberately omits technicianConfirmed — that stays a separate, explicit action.
   */
  function commitDraftToSystem(componentId: string, draft: IdentifierDraft) {
    if (!system) return;
    setSystem(updateComponentFields(system, componentId, { identifiers: identifiersFromDraft(draft) }));
  }

  function setDraftField(componentId: string, field: keyof IdentifierDraft, value: string) {
    setDrafts((prev) => {
      const next = { ...(prev[componentId] ?? draftFromIdentifiers({})), [field]: value };
      commitDraftToSystem(componentId, next);
      return { ...prev, [componentId]: next };
    });
  }

  /** Part number field accepts a combined "partNumber|serialNumber" scan and fills both. */
  function setPartNumberInput(componentId: string, value: string) {
    const { partNumber, serialNumber } = splitScannedPartNumber(value);
    setDrafts((prev) => {
      const existing = prev[componentId] ?? draftFromIdentifiers({});
      const next = { ...existing, partNumber, serialNumber: serialNumber ?? existing.serialNumber };
      commitDraftToSystem(componentId, next);
      return { ...prev, [componentId]: next };
    });
  }

  /**
   * Label photo is required documentation, not an OCR trigger — every field it used to try
   * to fill has a reliable live QR/barcode Scan button (SerialInput, @zxing/browser) already
   * on the field itself, plus manual entry. Device identification also already happens
   * earlier via manual hardware selection, so there is no remaining case where running OCR
   * here would tell us something we don't already know.
   */
  function handlePhotoChange(component: InstalledProductComponent, e: ChangeEvent<HTMLInputElement>) {
    const slotKey = photoSlotKeyForComponent(component);
    if (slotKey) props.getPhotoSlot(slotKey).onUpload(e);
  }

  function confirmComponent(component: InstalledProductComponent) {
    if (!system) return;
    setDuplicateError(null);
    const draft = draftFor(component);
    const identifiers = identifiersFromDraft(draft);
    if (!identifiers.serialNumber) {
      setDuplicateError(`${component.componentLabel}: serial number is required before confirming.`);
      return;
    }
    const dup = findDuplicateDeviceInSystem(system.components, component.id, identifiers.partNumber ?? "", identifiers.serialNumber);
    if (dup) {
      setDuplicateError(
        `${component.componentLabel}: this part number + serial number is already used for ${dup.componentLabel} on this job card. Retake, or use a different unit.`,
      );
      return;
    }
    const manualReason = manualReasons[component.id] ?? null;
    const nextSystem = updateComponentFields(system, component.id, {
      identifiers,
      technicianConfirmed: true,
      extractionSource: manualReason ? "manual" : component.extractionSource,
      manualFallbackReason: manualReason,
    });
    setSystem(nextSystem);
    props.clearFieldHighlight(`blaxtair-${component.id}`);
    // Move on to the next incomplete component instead of leaving everything collapsed.
    const next = orderComponents(nextSystem).find((c) => c.id !== component.id && !c.technicianConfirmed);
    setExpandedId(next ? next.id : null);
  }

  function setMounting(component: InstalledProductComponent, id: MountingLocationId | "", other: string) {
    if (!system) return;
    setSystem(
      updateComponentFields(system, component.id, {
        mountingLocation: id || null,
        mountingLocationOther: other,
      }),
    );
  }

  /** Monitor mounting is always free text (cab/dash locations vary too much for the camera preset list). */
  function setMonitorMountingText(component: InstalledProductComponent, text: string) {
    if (!system) return;
    setSystem(
      updateComponentFields(system, component.id, {
        mountingLocation: "other",
        mountingLocationOther: text,
      }),
    );
  }

  function setView(component: InstalledProductComponent, id: ViewDirectionId | "", other: string) {
    if (!system) return;
    setSystem(
      updateComponentFields(system, component.id, {
        viewDirection: id || null,
        viewDirectionOther: other,
      }),
    );
  }

  function setWireLead(component: InstalledProductComponent, wireKey: string, patch: Partial<WireLeadState>) {
    if (!system) return;
    const current = component.wireLeads?.[wireKey] ?? emptyWireLead();
    const nextWireLeads = { ...(component.wireLeads ?? {}), [wireKey]: { ...current, ...patch } };
    setSystem(updateComponentFields(system, component.id, { wireLeads: nextWireLeads }));
  }

  // Stage 1: no system yet — ask camera quantity directly. The technician already chose
  // Blaxtair AHD as the primary hardware before reaching this section, so there is nothing
  // left to identify here; a "scan the first camera to figure out what this is" step would
  // be redundant. Creates all N cameras + monitor at once, empty and unconfirmed, then lands
  // on the same per-camera editable form (Stage 2) used for every camera going forward.
  if (!system || !system.plannedCameraCount) {
    return (
      <div id="field-blaxtair-equipment" className="space-y-4">
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">How many cameras are being installed?</p>
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: BLAXTAIR_AHD_CAMERA_MAX - BLAXTAIR_AHD_CAMERA_MIN + 1 }, (_, i) => i + BLAXTAIR_AHD_CAMERA_MIN).map(
            (count) => (
              <button
                key={count}
                type="button"
                className="inline-flex min-h-[52px] min-w-[64px] items-center justify-center rounded-xl border-2 border-blue-600 bg-white px-5 text-lg font-bold text-blue-600 shadow-sm hover:bg-blue-50 dark:border-blue-500 dark:bg-gray-900 dark:text-blue-400 dark:hover:bg-gray-800"
                onClick={() => {
                  const base =
                    system ??
                    buildInstalledProductSystem({
                      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
                      identifiers: {},
                      extractionSource: "manual",
                      technicianConfirmed: false,
                    });
                  const next = applyBlaxtairCameraCount({ system: base, cameraCount: count });
                  setSystem(next);
                  // Camera 1 is still incomplete (no mounting/view/confirm yet) — keep it open.
                  const firstCamera = orderComponents(next).find((c) => c.componentType === "camera");
                  setExpandedId(firstCamera?.id ?? null);
                }}
              >
                {count}
              </button>
            ),
          )}
        </div>
      </div>
    );
  }

  // Stage 3: full component list — camera(s) + monitor.
  const ordered = orderComponents(system);

  return (
    <div id="field-blaxtair-equipment" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {system.plannedCameraCount} camera{system.plannedCameraCount === 1 ? "" : "s"} + monitor
        </p>
        <button
          type="button"
          className="text-sm font-semibold text-blue-600 underline dark:text-blue-400"
          onClick={() => setSystem({ ...system, plannedCameraCount: null })}
        >
          Change camera count
        </button>
      </div>

      {duplicateError ? (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {duplicateError}
        </p>
      ) : null}

      {ordered.map((component) => {
        const expanded = expandedId === component.id;
        const draft = draftFor(component);
        const slotKey = photoSlotKeyForComponent(component);
        const photoSlot = slotKey ? props.getPhotoSlot(slotKey) : null;
        const highlightKey = `blaxtair-${component.id}`;
        const isCamera = component.componentType === "camera";
        const isMonitor = component.componentType === "monitor";
        const mountingPhotoSlot = isMonitor ? props.getPhotoSlot("blaxtairMonitorMounting") : null;
        const cameraIndexMatch = /^camera_([1-4])$/.exec(component.slotKey);
        const installPhotoSlot = isCamera && cameraIndexMatch ? props.getPhotoSlot(cameraMountingPhotoSlotKey(Number(cameraIndexMatch[1]))) : null;
        const wireDefs = componentWireDefs(component);
        const highlighted = isComponentHighlighted(component);
        const anyWireUsed = wireDefs.some((w) => w.required || component.wireLeads?.[w.key]?.used);
        const wirePhotosSlotKey: BlaxtairPhotoSlotKey | null = isMonitor
          ? "blaxtairMonitorWirePhotos"
          : isCamera && cameraIndexMatch
            ? (`blaxtairCamera${cameraIndexMatch[1]}WirePhotos` as BlaxtairPhotoSlotKey)
            : null;
        const wirePhotosSlot = wirePhotosSlotKey ? props.getPhotoSlot(wirePhotosSlotKey) : null;
        const wirePhotosHighlightKey = `${highlightKey}-wirePhotos`;

        return (
          <div
            key={component.id}
            className={`rounded-2xl border-2 p-4 sm:p-5 ${
              highlighted
                ? "border-red-400 bg-red-50/80 dark:border-red-600 dark:bg-red-950/30"
                : "border-slate-200 bg-slate-50/80 dark:border-slate-600 dark:bg-slate-900/50"
            }`}
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => setExpandedId(expanded ? null : component.id)}
            >
              <span className={`text-base font-bold ${highlighted ? "text-red-700 dark:text-red-300" : "text-gray-900 dark:text-gray-100"}`}>
                {component.technicianConfirmed ? "✓ " : "— "}
                {component.componentLabel}
                {component.identifiers.serialNumber ? ` · SN ${component.identifiers.serialNumber}` : ""}
                {isCamera ? ` · ${locationLabel(component.mountingLocation, component.mountingLocationOther)}/${viewLabel(component.viewDirection, component.viewDirectionOther)}` : ` · ${locationLabel(component.mountingLocation, component.mountingLocationOther)}`}
                {highlighted ? " · Incomplete" : ""}
              </span>
              <span className="text-sm text-blue-600 dark:text-blue-400">{expanded ? "Collapse" : "Expand"}</span>
            </button>

            {expanded ? (
              <div className="mt-4 space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                <div id={`field-photo-${highlightKey}`}>
                  <label className={props.fieldLabelClass(highlightKey)}>
                    {component.componentLabel} label photo
                    <RequiredMark />
                  </label>
                  <input
                    id={`blaxtair-photo-${component.id}`}
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => handlePhotoChange(component, e)}
                  />
                  <label
                    htmlFor={`blaxtair-photo-${component.id}`}
                    className={props.photoPickClass(highlightKey, true, (photoSlot?.uploadedCount ?? 0) >= 1)}
                  >
                    {(photoSlot?.uploadedCount ?? 0) >= 1 ? "Retake / Upload New Photo" : PHOTO_UPLOAD_LABEL_SINGLE}
                  </label>
                  {photoSlot ? (
                    <>
                      <BlaxtairLabelPhotoPreview photoSlot={photoSlot} />
                      <PhotoUploadFeedback count={photoSlot.uploadedCount} names={photoSlot.remoteThumbs.map((r) => r.filename)} />
                      <PhotoThumbnailGrid
                        files={photoSlot.files}
                        remotePhotos={photoSlot.remoteThumbs}
                        onRemoveLocal={photoSlot.onRemoveLocal}
                        onRemoveRemote={photoSlot.onRemoveRemote}
                      />
                      <PhotoUploadedBadge show={(photoSlot.uploadedCount ?? 0) >= 1} status={photoSlot.persistStatus} />
                      <PhotoFieldError message={photoSlot.error} />
                    </>
                  ) : null}
                  {props.requiredHint(highlightKey)}
                </div>

                {isCamera && installPhotoSlot ? (
                  <div id={`field-${highlightKey}-installPhoto`}>
                    <label className={props.fieldLabelClass(`${highlightKey}-installPhoto`)}>
                      {component.componentLabel} mounted — installation photo
                      <RequiredMark />
                    </label>
                    <input
                      id={`blaxtair-photo-${component.id}-install`}
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={(e) => {
                        installPhotoSlot.onUpload(e);
                        props.clearFieldHighlight(`${highlightKey}-installPhoto`);
                      }}
                    />
                    <label
                      htmlFor={`blaxtair-photo-${component.id}-install`}
                      className={props.photoPickClass(`${highlightKey}-installPhoto`, true, (installPhotoSlot.uploadedCount ?? 0) >= 1)}
                    >
                      {PHOTO_UPLOAD_LABEL_SINGLE}
                    </label>
                    <PhotoUploadFeedback count={installPhotoSlot.uploadedCount} names={installPhotoSlot.remoteThumbs.map((r) => r.filename)} />
                    <PhotoThumbnailGrid
                      files={installPhotoSlot.files}
                      remotePhotos={installPhotoSlot.remoteThumbs}
                      onRemoveLocal={installPhotoSlot.onRemoveLocal}
                      onRemoveRemote={installPhotoSlot.onRemoveRemote}
                    />
                    <PhotoUploadedBadge show={(installPhotoSlot.uploadedCount ?? 0) >= 1} status={installPhotoSlot.persistStatus} />
                    <PhotoFieldError message={installPhotoSlot.error} />
                    {props.requiredHint(`${highlightKey}-installPhoto`)}
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div id={`field-${highlightKey}-partNumber`}>
                    <SerialInput
                      label="Part number"
                      required={isCamera}
                      labelClassName={props.fieldLabelClass(`${highlightKey}-partNumber`)}
                      inputClassName={props.fieldInputClass(`${highlightKey}-partNumber`)}
                      value={draft.partNumber}
                      placeholder="e.g. 210-110-001 (scan fills part number + serial together)"
                      onChange={(v) => setPartNumberInput(component.id, v)}
                    />
                  </div>
                  <div id={`field-${highlightKey}-serialNumber`}>
                    <SerialInput
                      label="Serial number"
                      required
                      labelClassName={props.fieldLabelClass(`${highlightKey}-serialNumber`)}
                      inputClassName={props.fieldInputClass(`${highlightKey}-serialNumber`)}
                      value={draft.serialNumber}
                      placeholder="Scan or type serial"
                      onChange={(v) => setDraftField(component.id, "serialNumber", v)}
                    />
                  </div>
                  {isCamera ? (
                    <div id={`field-${highlightKey}-ipAddress`}>
                      <SerialInput
                        label="IP address"
                        labelClassName={props.fieldLabelClass(`${highlightKey}-ipAddress`)}
                        inputClassName={props.fieldInputClass(`${highlightKey}-ipAddress`)}
                        value={draft.ipAddress}
                        placeholder="e.g. 192.168.89.250"
                        onChange={(v) => setDraftField(component.id, "ipAddress", v)}
                      />
                    </div>
                  ) : null}
                </div>

                {!component.identifiers.serialNumber ? (
                  <div id={`field-${highlightKey}-manualReason`}>
                    <label className={props.fieldLabelClass(`${highlightKey}-manualReason`)}>
                      If entering manually, reason
                    </label>
                    <select
                      className={props.fieldSelectClass(`${highlightKey}-manualReason`)}
                      value={manualReasons[component.id] ?? ""}
                      onChange={(e) =>
                        setManualReasons((prev) => ({ ...prev, [component.id]: e.target.value as ManualFallbackReason }))
                      }
                    >
                      <option value="">Not applicable (scanned)</option>
                      {Object.entries(MANUAL_FALLBACK_REASON_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div id={`field-${highlightKey}-mounting`}>
                    <label className={props.fieldLabelClass(`${highlightKey}-mounting`)}>
                      Mounting location
                      <RequiredMark />
                    </label>
                    {isCamera ? (
                      <>
                        <select
                          className={props.fieldSelectClass(`${highlightKey}-mounting`)}
                          value={component.mountingLocation ?? ""}
                          onChange={(e) =>
                            setMounting(component, e.target.value as MountingLocationId | "", component.mountingLocationOther ?? "")
                          }
                        >
                          <option value="">Select location</option>
                          {Object.entries(MOUNTING_LOCATION_LABELS).map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {component.mountingLocation === "other" ? (
                          <input
                            className={`${props.fieldInputClass(`${highlightKey}-mounting`)} mt-2`}
                            placeholder="Describe mounting location"
                            value={component.mountingLocationOther ?? ""}
                            onChange={(e) => setMounting(component, "other", e.target.value)}
                          />
                        ) : null}
                      </>
                    ) : (
                      <input
                        className={props.fieldInputClass(`${highlightKey}-mounting`)}
                        placeholder="e.g. Dash, driver side, on gooseneck bracket"
                        value={component.mountingLocationOther ?? ""}
                        onChange={(e) => setMonitorMountingText(component, e.target.value)}
                      />
                    )}
                  </div>
                  {isCamera ? (
                    <div id={`field-${highlightKey}-view`}>
                      <label className={props.fieldLabelClass(`${highlightKey}-view`)}>
                        View direction
                        <RequiredMark />
                      </label>
                      <select
                        className={props.fieldSelectClass(`${highlightKey}-view`)}
                        value={component.viewDirection ?? ""}
                        onChange={(e) => setView(component, e.target.value as ViewDirectionId | "", component.viewDirectionOther ?? "")}
                      >
                        <option value="">Select view</option>
                        {Object.entries(VIEW_DIRECTION_LABELS).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                      {component.viewDirection === "other" ? (
                        <input
                          className={`${props.fieldInputClass(`${highlightKey}-view`)} mt-2`}
                          placeholder="Describe view direction"
                          value={component.viewDirectionOther ?? ""}
                          onChange={(e) => setView(component, "other", e.target.value)}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {isMonitor && mountingPhotoSlot ? (
                  <div id={`field-${highlightKey}-mountingPhoto`}>
                    <label className={props.fieldLabelClass(`${highlightKey}-mountingPhoto`)}>
                      Monitor mounting location photo
                      <RequiredMark />
                    </label>
                    <input
                      id={`blaxtair-photo-${component.id}-mounting`}
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={(e) => {
                        mountingPhotoSlot.onUpload(e);
                        props.clearFieldHighlight(`${highlightKey}-mountingPhoto`);
                      }}
                    />
                    <label
                      htmlFor={`blaxtair-photo-${component.id}-mounting`}
                      className={props.photoPickClass(`${highlightKey}-mountingPhoto`, true, (mountingPhotoSlot.uploadedCount ?? 0) >= 1)}
                    >
                      {PHOTO_UPLOAD_LABEL_SINGLE}
                    </label>
                    <PhotoUploadFeedback count={mountingPhotoSlot.uploadedCount} names={mountingPhotoSlot.remoteThumbs.map((r) => r.filename)} />
                    <PhotoThumbnailGrid
                      files={mountingPhotoSlot.files}
                      remotePhotos={mountingPhotoSlot.remoteThumbs}
                      onRemoveLocal={mountingPhotoSlot.onRemoveLocal}
                      onRemoveRemote={mountingPhotoSlot.onRemoveRemote}
                    />
                    <PhotoUploadedBadge show={(mountingPhotoSlot.uploadedCount ?? 0) >= 1} status={mountingPhotoSlot.persistStatus} />
                    <PhotoFieldError message={mountingPhotoSlot.error} />
                    {props.requiredHint(`${highlightKey}-mountingPhoto`)}
                  </div>
                ) : null}

                <div className="space-y-3">
                  <p className="text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Wire leads {isCamera ? "(if used)" : ""}
                  </p>
                  {wireDefs.map((wireDef) => {
                    const wireHighlightKey = `${highlightKey}-wire-${wireDef.key}`;
                    return (
                      <BlaxtairWireLeadField
                        key={wireDef.key}
                        wireDef={wireDef}
                        wire={component.wireLeads?.[wireDef.key] ?? emptyWireLead()}
                        highlightKey={wireHighlightKey}
                        highlighted={reviewHighlights.has(wireHighlightKey)}
                        onToggleUsed={(used) => setWireLead(component, wireDef.key, { used })}
                        onDescriptionChange={(description) => setWireLead(component, wireDef.key, { description })}
                        fieldLabelClass={props.fieldLabelClass}
                        fieldInputClass={props.fieldInputClass}
                        requiredHint={props.requiredHint}
                      />
                    );
                  })}
                </div>

                {anyWireUsed && wirePhotosSlot ? (
                  <div id={`field-photo-${wirePhotosHighlightKey}`}>
                    <label className={props.fieldLabelClass(wirePhotosHighlightKey)}>
                      Wire connection photos
                      <RequiredMark />
                    </label>
                    <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                      One or more photos covering the wire connections above.
                    </p>
                    <input
                      id={`blaxtair-photo-${wirePhotosHighlightKey}`}
                      type="file"
                      className="hidden"
                      accept="image/png,image/jpeg,image/jpg"
                      multiple
                      onChange={(e) => {
                        wirePhotosSlot.onUpload(e);
                        props.clearFieldHighlight(wirePhotosHighlightKey);
                      }}
                    />
                    <label
                      htmlFor={`blaxtair-photo-${wirePhotosHighlightKey}`}
                      className={props.photoPickClass(wirePhotosHighlightKey, true, (wirePhotosSlot.uploadedCount ?? 0) >= 1)}
                    >
                      Take or upload photos
                    </label>
                    <PhotoUploadFeedback count={wirePhotosSlot.uploadedCount} names={wirePhotosSlot.remoteThumbs.map((r) => r.filename)} />
                    <PhotoThumbnailGrid
                      files={wirePhotosSlot.files}
                      remotePhotos={wirePhotosSlot.remoteThumbs}
                      onRemoveLocal={wirePhotosSlot.onRemoveLocal}
                      onRemoveRemote={wirePhotosSlot.onRemoveRemote}
                    />
                    <PhotoUploadedBadge show={(wirePhotosSlot.uploadedCount ?? 0) >= 1} status={wirePhotosSlot.persistStatus} />
                    <PhotoFieldError message={wirePhotosSlot.error} />
                    {props.requiredHint(wirePhotosHighlightKey)}
                  </div>
                ) : null}

                <button
                  type="button"
                  className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-blue-600 px-5 text-base font-semibold text-white shadow-sm hover:bg-blue-700"
                  onClick={() => confirmComponent(component)}
                >
                  Confirm {component.componentLabel}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      <BlaxtairExternalAlarmSection
        system={system}
        onChangeSystem={setSystem}
        cameras={ordered.filter((c) => c.componentType === "camera")}
        photoSlot={props.getPhotoSlot("blaxtairAlarmMounting")}
        highlighted={reviewHighlights.has("blaxtair-alarm-mountingPhoto") || reviewHighlights.has("blaxtair-alarm-cameras")}
        fieldLabelClass={props.fieldLabelClass}
        fieldSelectClass={props.fieldSelectClass}
        photoPickClass={props.photoPickClass}
        requiredHint={props.requiredHint}
        clearFieldHighlight={props.clearFieldHighlight}
      />

      <BlaxtairWirePathSection
        photoSlot={props.getPhotoSlot("blaxtairWirePath")}
        fieldLabelClass={props.fieldLabelClass}
        photoPickClass={props.photoPickClass}
        requiredHint={props.requiredHint}
      />
    </div>
  );
}

/** System-level wire routing photos — a gallery, not tied to one camera or wire color. */
function BlaxtairWirePathSection(props: {
  photoSlot: BlaxtairPhotoSlot;
  fieldLabelClass: (key: string) => string;
  photoPickClass: (key: string, required: boolean, complete: boolean) => string;
  requiredHint: (key: string) => ReactNode;
}) {
  const highlightKey = "photo-ppd-blaxtairWirePath";
  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/80 p-4 dark:border-slate-600 dark:bg-slate-900/50 sm:p-5">
      <p className="text-base font-bold text-gray-900 dark:text-gray-100">Wire path</p>
      <div className="mt-3" id={`field-${highlightKey}`}>
        <label className={props.fieldLabelClass(highlightKey)}>
          Wire path photo(s)
          <RequiredMark />
        </label>
        <input
          id="blaxtair-photo-wirePath"
          type="file"
          className="hidden"
          accept="image/png,image/jpeg,image/jpg"
          multiple
          onChange={props.photoSlot.onUpload}
        />
        <label
          htmlFor="blaxtair-photo-wirePath"
          className={props.photoPickClass(highlightKey, true, (props.photoSlot.uploadedCount ?? 0) >= 1)}
        >
          Take or upload photos
        </label>
        <PhotoUploadFeedback count={props.photoSlot.uploadedCount} names={props.photoSlot.remoteThumbs.map((r) => r.filename)} />
        <PhotoThumbnailGrid
          files={props.photoSlot.files}
          remotePhotos={props.photoSlot.remoteThumbs}
          onRemoveLocal={props.photoSlot.onRemoveLocal}
          onRemoveRemote={props.photoSlot.onRemoveRemote}
        />
        <PhotoUploadedBadge show={(props.photoSlot.uploadedCount ?? 0) >= 1} status={props.photoSlot.persistStatus} />
        <PhotoFieldError message={props.photoSlot.error} />
        {props.requiredHint(highlightKey)}
      </div>
    </div>
  );
}

/** External pedestrian-detection alarm — system-level (not tied to one camera), optional. */
function BlaxtairExternalAlarmSection(props: {
  system: InstalledProductSystem;
  onChangeSystem: (system: InstalledProductSystem) => void;
  cameras: InstalledProductComponent[];
  photoSlot: BlaxtairPhotoSlot;
  highlighted: boolean;
  fieldLabelClass: (key: string) => string;
  fieldSelectClass: (key: string) => string;
  photoPickClass: (key: string, required: boolean, complete: boolean) => string;
  requiredHint: (key: string) => ReactNode;
  clearFieldHighlight: (key: string) => void;
}) {
  const alarm = props.system.externalAlarm ?? { installed: false, triggerComponentIds: [] };
  const highlightKey = "blaxtair-alarm";

  return (
    <div
      className={`rounded-2xl border-2 p-4 sm:p-5 ${
        props.highlighted
          ? "border-red-400 bg-red-50/80 dark:border-red-600 dark:bg-red-950/30"
          : "border-slate-200 bg-slate-50/80 dark:border-slate-600 dark:bg-slate-900/50"
      }`}
    >
      <p className="text-base font-bold text-gray-900 dark:text-gray-100">External pedestrian alarm</p>
      <div className="mt-3" id={`field-${highlightKey}`}>
        <label className={props.fieldLabelClass(highlightKey)}>Is an external alarm installed?</label>
        <select
          className={props.fieldSelectClass(highlightKey)}
          value={alarm.installed ? "Yes" : "No"}
          onChange={(e) =>
            props.onChangeSystem(
              setSystemExternalAlarm(props.system, {
                installed: e.target.value === "Yes",
                triggerComponentIds: alarm.triggerComponentIds,
              }),
            )
          }
        >
          <option value="No">No</option>
          <option value="Yes">Yes</option>
        </select>
      </div>

      {alarm.installed ? (
        <div className="mt-4 space-y-4">
          <div id={`field-photo-${highlightKey}`}>
            <label className={props.fieldLabelClass(`${highlightKey}-mountingPhoto`)}>
              Alarm mounting photo
              <RequiredMark />
            </label>
            <input
              id="blaxtair-photo-alarm-mounting"
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/jpg"
              onChange={(e) => {
                props.photoSlot.onUpload(e);
                props.clearFieldHighlight(`${highlightKey}-mountingPhoto`);
              }}
            />
            <label
              htmlFor="blaxtair-photo-alarm-mounting"
              className={props.photoPickClass(`${highlightKey}-mountingPhoto`, true, (props.photoSlot.uploadedCount ?? 0) >= 1)}
            >
              {PHOTO_UPLOAD_LABEL_SINGLE}
            </label>
            <PhotoUploadFeedback count={props.photoSlot.uploadedCount} names={props.photoSlot.remoteThumbs.map((r) => r.filename)} />
            <PhotoThumbnailGrid
              files={props.photoSlot.files}
              remotePhotos={props.photoSlot.remoteThumbs}
              onRemoveLocal={props.photoSlot.onRemoveLocal}
              onRemoveRemote={props.photoSlot.onRemoveRemote}
            />
            <PhotoUploadedBadge show={(props.photoSlot.uploadedCount ?? 0) >= 1} status={props.photoSlot.persistStatus} />
            <PhotoFieldError message={props.photoSlot.error} />
            {props.requiredHint(`${highlightKey}-mountingPhoto`)}
          </div>

          <div id={`field-${highlightKey}-cameras`}>
            <label className={props.fieldLabelClass(`${highlightKey}-cameras`)}>
              Camera(s) that trigger this alarm
              <RequiredMark />
            </label>
            <div className="mt-2 space-y-2">
              {props.cameras.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">No cameras configured yet.</p>
              ) : (
                props.cameras.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={alarm.triggerComponentIds.includes(c.id)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...alarm.triggerComponentIds, c.id]
                          : alarm.triggerComponentIds.filter((id) => id !== c.id);
                        props.onChangeSystem(setSystemExternalAlarm(props.system, { installed: true, triggerComponentIds: next }));
                        if (next.length > 0) props.clearFieldHighlight(`${highlightKey}-cameras`);
                      }}
                    />
                    {c.componentLabel}
                  </label>
                ))
              )}
            </div>
            {props.requiredHint(`${highlightKey}-cameras`)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Read-only Review-step summary, mirroring the CP4/PPD review blocks' SummaryRow convention. */
function wireLeadsSummaryValue(component: InstalledProductComponent, wireDefs: WireDef[]): string {
  const used = wireDefs.filter((w) => w.required || component.wireLeads?.[w.key]?.used);
  if (used.length === 0) return "None used";
  return used.map((w) => `${w.label.split(" — ")[1] ?? w.label}: ${component.wireLeads?.[w.key]?.description || "—"}`).join(" · ");
}

export function BlaxtairAhdReviewSummary(props: {
  system: InstalledProductSystem | null;
  getPhotoSlot: (key: BlaxtairPhotoSlotKey) => BlaxtairPhotoSlot;
}) {
  const { system } = props;
  if (!system) {
    return <SummaryRow label="Equipment" value="" />;
  }
  const cameras = system.components.filter((c) => c.componentType === "camera").slice().sort((a, b) => (a.slotKey < b.slotKey ? -1 : 1));
  const monitor = system.components.find((c) => c.componentType === "monitor");
  const alarm = system.externalAlarm ?? { installed: false, triggerComponentIds: [] };

  return (
    <div>
      <SummaryRow label="Camera count" value={String(system.plannedCameraCount ?? cameras.length)} />
      {cameras.map((c) => {
        const slotKey = photoSlotKeyForComponent(c);
        const photoUploaded = slotKey ? (props.getPhotoSlot(slotKey).uploadedCount ?? 0) >= 1 : false;
        const cameraIndexMatch = /^camera_([1-4])$/.exec(c.slotKey);
        const installPhotoUploaded = cameraIndexMatch
          ? (props.getPhotoSlot(cameraMountingPhotoSlotKey(Number(cameraIndexMatch[1]))).uploadedCount ?? 0) >= 1
          : false;
        const wirePhotosCount = cameraIndexMatch
          ? props.getPhotoSlot(`blaxtairCamera${cameraIndexMatch[1]}WirePhotos` as BlaxtairPhotoSlotKey).uploadedCount ?? 0
          : 0;
        return (
          <div key={c.id}>
            <SummaryRow label={`${c.componentLabel} — part number`} value={c.identifiers.partNumber ?? ""} />
            <SummaryRow label={`${c.componentLabel} — serial number`} value={c.identifiers.serialNumber ?? ""} />
            <SummaryRow label={`${c.componentLabel} — mounting location`} value={locationLabel(c.mountingLocation, c.mountingLocationOther)} />
            <SummaryRow label={`${c.componentLabel} — view direction`} value={viewLabel(c.viewDirection, c.viewDirectionOther)} />
            <SummaryRow label={`${c.componentLabel} — label photo`} value={photoUploaded ? "Uploaded" : ""} />
            <SummaryRow label={`${c.componentLabel} — mounted photo`} value={installPhotoUploaded ? "Uploaded" : ""} />
            <SummaryRow label={`${c.componentLabel} — wire leads`} value={wireLeadsSummaryValue(c, CAMERA_WIRE_DEFS)} />
            <SummaryRow label={`${c.componentLabel} — wire connection photos`} value={wirePhotosCount > 0 ? `${wirePhotosCount} uploaded` : ""} />
            <SummaryRow label={`${c.componentLabel} — confirmed`} value={c.technicianConfirmed ? "Yes" : ""} />
          </div>
        );
      })}
      {monitor ? (
        <div>
          <SummaryRow label="Monitor — part number" value={monitor.identifiers.partNumber ?? ""} />
          <SummaryRow label="Monitor — serial number" value={monitor.identifiers.serialNumber ?? ""} />
          <SummaryRow label="Monitor — mounting location" value={locationLabel(monitor.mountingLocation, monitor.mountingLocationOther)} />
          <SummaryRow
            label="Monitor — label photo"
            value={(props.getPhotoSlot("blaxtairMonitor").uploadedCount ?? 0) >= 1 ? "Uploaded" : ""}
          />
          <SummaryRow
            label="Monitor — mounting photo"
            value={(props.getPhotoSlot("blaxtairMonitorMounting").uploadedCount ?? 0) >= 1 ? "Uploaded" : ""}
          />
          <SummaryRow label="Monitor — wire leads" value={wireLeadsSummaryValue(monitor, MONITOR_WIRE_DEFS)} />
          <SummaryRow
            label="Monitor — wire connection photos"
            value={(() => {
              const count = props.getPhotoSlot("blaxtairMonitorWirePhotos").uploadedCount ?? 0;
              return count > 0 ? `${count} uploaded` : "";
            })()}
          />
          <SummaryRow label="Monitor — confirmed" value={monitor.technicianConfirmed ? "Yes" : ""} />
        </div>
      ) : null}
      <SummaryRow label="External alarm installed?" value={alarm.installed ? "Yes" : "No"} />
      {alarm.installed ? (
        <>
          <SummaryRow
            label="Alarm mounting photo"
            value={(props.getPhotoSlot("blaxtairAlarmMounting").uploadedCount ?? 0) >= 1 ? "Uploaded" : ""}
          />
          <SummaryRow
            label="Alarm triggered by"
            value={
              alarm.triggerComponentIds
                .map((id) => cameras.find((c) => c.id === id)?.componentLabel)
                .filter(Boolean)
                .join(", ") || ""
            }
          />
        </>
      ) : null}
      <SummaryRow
        label="Wire path photos"
        value={(() => {
          const count = props.getPhotoSlot("blaxtairWirePath").uploadedCount ?? 0;
          return count > 0 ? `${count} uploaded` : "";
        })()}
      />
    </div>
  );
}
