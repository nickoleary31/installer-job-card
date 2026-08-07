"use client";

/**
 * Equipment step — camera-label OCR scan/upload, camera count, mounting/view, monitor entry.
 * Extracted from the original standalone BlaxtairOcrDemoPanel; behavior unchanged, but photo
 * and device duplicate checks now come from the shared job-card-wide workflow hook instead of
 * checking only within this system's own components.
 */
import { useCallback, useRef, useState } from "react";
import {
  BLAXTAIR_AHD_CAMERA_MAX,
  BLAXTAIR_AHD_CAMERA_MIN,
  BLAXTAIR_AHD_PRODUCT_DEFINITION,
  MANUAL_FALLBACK_REASON_LABELS,
  MOUNTING_LOCATION_LABELS,
  VIEW_DIRECTION_LABELS,
  applyBlaxtairCameraCount,
  applyIdentifierEdit,
  buildInstalledProductSystem,
  formatBlaxtairSystemSummary,
  mapPrototypeFieldsToIdentifiers,
  updateComponentFields,
  type DeviceIdentifierKey,
  type InstalledProductComponent,
  type InstalledProductSystem,
  type ManualFallbackReason,
  type MountingLocationId,
  type ViewDirectionId,
} from "@/lib/product-devices";
import {
  BLAXTAIR_MONITOR_LABEL_OCR_SUPPORTED,
  runBlaxtairCameraScan,
  type BlaxtairCameraScanResult,
} from "@/lib/prototype/label-scan/blaxtair-bridge";
import { renderSyntheticBlaxtairCameraLabel } from "@/lib/prototype/label-scan/blaxtair-fixture";
import { fingerprintSource } from "@/lib/prototype/photo-fingerprint";
import type { ReinstallPrompt } from "./useJobCardWorkflow";

type Stage = "capture_camera1" | "manual_camera1" | "camera_count" | "components";

function bandLabel(band: string): string {
  if (band === "high") return "High confidence";
  if (band === "medium") return "Medium confidence";
  return "Low confidence — review carefully";
}

function extractionSourceFor(candidates: BlaxtairCameraScanResult["candidates"]): "barcode" | "ocr" | "mixed" {
  const sources = new Set(candidates.map((c) => c.source));
  if (sources.size === 1 && sources.has("barcode")) return "barcode";
  if (sources.size === 1 && sources.has("ocr")) return "ocr";
  return "mixed";
}

export function EquipmentSection(props: {
  equipment: InstalledProductSystem | null;
  onChangeEquipment: (equipment: InstalledProductSystem | null) => void;
  checkPhotoAndProceed: (args: { fingerprint: string; excludeId: string; onProceed: () => void }) => boolean;
  checkDeviceAndProceed: (args: {
    partNumber: string;
    serialNumber: string;
    excludeComponentId: string;
    onProceed: (reinstallPatch?: Partial<InstalledProductComponent>) => void;
  }) => string | null;
  reinstallPrompt: ReinstallPrompt | null;
  onCancelReinstallPrompt: () => void;
  blockMessage: string | null;
  onClearBlockMessage: () => void;
}) {
  const { equipment: system, onChangeEquipment: setSystem } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<Stage>(() => {
    if (!system) return "capture_camera1";
    return system.plannedCameraCount == null ? "camera_count" : "components";
  });
  const [activeComponentId, setActiveComponentId] = useState<string | null>(
    () => system?.components.find((c) => c.slotKey === "camera_1")?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<BlaxtairCameraScanResult | null>(null);
  const [scanFingerprint, setScanFingerprint] = useState<string | null>(null);
  const [pendingIdentifiers, setPendingIdentifiers] = useState<Record<string, string>>({});
  const [manualReason, setManualReason] = useState<ManualFallbackReason>("label_unreadable");
  const [manualNotes, setManualNotes] = useState("");
  const [showScanDetails, setShowScanDetails] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  const orderedComponents = system ? system.components.slice().sort((a, b) => (a.slotKey < b.slotKey ? -1 : 1)) : [];
  const active = orderedComponents.find((c) => c.id === activeComponentId) ?? null;
  const allComponentsConfirmed = system != null && orderedComponents.every((c) => c.technicianConfirmed);

  const runScan = useCallback(
    async (source: Blob | HTMLCanvasElement, isSynthetic = false) => {
      setBusy(true);
      setError(null);
      setScan(null);
      setScanFingerprint(null);
      props.onClearBlockMessage();
      try {
        const fingerprint = await fingerprintSource(source);
        const proceeded = props.checkPhotoAndProceed({
          fingerprint,
          excludeId: activeComponentId ?? "",
          onProceed: () => {},
        });
        if (!proceeded) {
          setBusy(false);
          return;
        }

        const result = await runBlaxtairCameraScan(source, { skipBarcodeDecode: isSynthetic });
        setScan(result);
        setScanFingerprint(fingerprint);
        const values: Record<string, string> = {};
        for (const c of result.candidates) {
          if (c.validationOk) values[c.key] = c.value;
        }
        setPendingIdentifiers(values);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Scan failed — try retaking the photo.");
      } finally {
        setBusy(false);
      }
    },
    [activeComponentId, props],
  );

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void runScan(file);
  }

  function useSyntheticSample() {
    void runScan(renderSyntheticBlaxtairCameraLabel(), true);
  }

  function retake() {
    setScan(null);
    setScanFingerprint(null);
    setPendingIdentifiers({});
    setError(null);
  }

  function confirmCamera1() {
    const identifiers = mapPrototypeFieldsToIdentifiers(pendingIdentifiers as Parameters<typeof mapPrototypeFieldsToIdentifiers>[0]);
    const next = buildInstalledProductSystem({
      definition: BLAXTAIR_AHD_PRODUCT_DEFINITION,
      identifiers,
      detectedHardwareProfileId: "blaxtair_ahd_camera_label",
      detectionConfidence: scan?.classification.top?.confidence ?? null,
      extractionSource: scan ? extractionSourceFor(scan.candidates) : "manual",
      technicianConfirmed: false,
      manualFallbackReason: scan ? null : manualReason,
      manualFallbackNotes: scan ? undefined : manualNotes || undefined,
      labelPhoto: scan
        ? {
            fieldName: "label",
            localPreview: scan.thumbnailDataUrl,
            contentFingerprint: scanFingerprint ?? undefined,
            uploadedAt: new Date().toISOString(),
          }
        : null,
    });
    setSystem(next);
    setStage("camera_count");
    setScan(null);
    setScanFingerprint(null);
    setPendingIdentifiers({});
  }

  function pickCameraCount(count: number) {
    if (!system) return;
    const next = applyBlaxtairCameraCount({ system, cameraCount: count });
    setSystem(next);
    setActiveComponentId(next.components.find((c) => c.slotKey === "camera_1")?.id ?? null);
    setStage("components");
  }

  function applyCameraScanToComponent(componentId: string) {
    if (!system || !scan) return;
    const identifiers = mapPrototypeFieldsToIdentifiers(pendingIdentifiers as Parameters<typeof mapPrototypeFieldsToIdentifiers>[0]);
    const err = props.checkDeviceAndProceed({
      partNumber: identifiers.partNumber ?? "",
      serialNumber: identifiers.serialNumber ?? "",
      excludeComponentId: componentId,
      onProceed: (reinstallPatch) => {
        setSystem(
          updateComponentFields(system, componentId, {
            identifiers,
            extractionSource: extractionSourceFor(scan.candidates),
            detectionConfidence: scan.classification.top?.confidence ?? null,
            technicianConfirmed: true,
            labelPhoto: {
              fieldName: "label",
              systemId: system.id,
              componentId,
              localPreview: scan.thumbnailDataUrl,
              contentFingerprint: scanFingerprint ?? undefined,
              uploadedAt: new Date().toISOString(),
            },
            ...reinstallPatch,
          }),
        );
        setScan(null);
        setScanFingerprint(null);
        setPendingIdentifiers({});
      },
    });
    setDuplicateError(err);
  }

  function confirmComponent(componentId: string, extraPatch?: Partial<InstalledProductComponent>) {
    if (!system) return;
    const comp = system.components.find((c) => c.id === componentId);
    if (!comp) return;
    const serial = comp.identifiers.serialNumber ?? "";
    const partNumber = comp.identifiers.partNumber ?? "";
    const err = props.checkDeviceAndProceed({
      partNumber,
      serialNumber: serial,
      excludeComponentId: componentId,
      onProceed: (reinstallPatch) => {
        patchComponent(componentId, { ...extraPatch, ...reinstallPatch, technicianConfirmed: true });
      },
    });
    setDuplicateError(err);
  }

  function editIdentifier(componentId: string, key: DeviceIdentifierKey, value: string) {
    if (!system) return;
    const comp = system.components.find((c) => c.id === componentId);
    if (!comp) return;
    const { identifiers, edits } = applyIdentifierEdit({
      identifiers: comp.identifiers,
      key,
      nextRaw: value,
      edits: comp.identifierEdits,
    });
    setSystem(updateComponentFields(system, componentId, { identifiers, identifierEdits: edits }));
  }

  function patchComponent(componentId: string, patch: Partial<InstalledProductComponent>) {
    if (!system) return;
    setSystem(updateComponentFields(system, componentId, patch));
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium text-emerald-200">Equipment &amp; OCR</h2>

      {props.reinstallPrompt ? (
        <div className="space-y-2 rounded-lg border border-amber-600 bg-amber-950/40 p-3 text-sm text-amber-100">
          <p>
            This camera (SN: {props.reinstallPrompt.record.serialNumber}, PN: {props.reinstallPrompt.record.partNumber}) was
            already installed on {new Date(props.reinstallPrompt.record.installedAt).toLocaleDateString()} as{" "}
            {props.reinstallPrompt.record.componentLabel} on a different form. (Local record on this device only.)
          </p>
          <p>Is it being reinstalled on a new asset?</p>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-white" onClick={props.reinstallPrompt.onConfirm}>
              Yes, reinstalling on this asset
            </button>
            <button type="button" className="rounded-lg border border-slate-500 px-3 py-2" onClick={props.onCancelReinstallPrompt}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {stage === "capture_camera1" ? (
        <div className="space-y-4 rounded-xl border border-emerald-700/50 bg-slate-900/60 p-4">
          <h3 className="font-medium text-emerald-200">Camera 1 — scan the device label</h3>
          <p className="text-sm text-slate-300">
            Take a photo of the camera label, or upload one. Barcode is tried first, then OCR.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              {busy ? "Reading label…" : "Take Photo"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-500 px-4 py-3 text-slate-200"
              onClick={() => uploadInputRef.current?.click()}
              disabled={busy}
            >
              Upload Photo
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-500 px-4 py-3 text-slate-200"
              onClick={useSyntheticSample}
              disabled={busy}
            >
              Use sample label (no camera)
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFilePicked} />
          <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={onFilePicked} />
          <button type="button" className="text-sm text-slate-300 underline" onClick={() => setStage("manual_camera1")}>
            Enter details manually instead
          </button>
          <p className="text-xs text-slate-500">
            Not a Blaxtair camera?{" "}
            <button
              type="button"
              className="underline"
              onClick={() =>
                setFallbackNote(
                  "This local demo only covers the Blaxtair AHD camera path. The classic LinxUp product picker prototype lives at /prototype/label-scan.",
                )
              }
            >
              Use classic product picker
            </button>
          </p>
          {fallbackNote ? <p className="rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-300">{fallbackNote}</p> : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          {props.blockMessage ? <p className="text-sm text-red-300">{props.blockMessage}</p> : null}

          {scan ? (
            <div className="space-y-3 rounded-lg border border-slate-600 p-3">
              <p className="text-sm">
                Detected: <strong>{scan.classification.top?.profile.uiSelectLabel ?? "Unknown"}</strong> — {bandLabel(scan.classification.band)}
              </p>
              {scan.classification.band === "low" ? (
                <p className="text-sm text-amber-300">Confidence is too low to preselect. Review the fields below, retake, or enter manually.</p>
              ) : null}
              {scan.partNumberInferred ? (
                <p className="rounded border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-200">
                  Part number assumed as {pendingIdentifiers.partNumber} — this model&apos;s label print consistently clips the final digit.
                  Confirm against the physical label, or edit if wrong.
                </p>
              ) : null}
              <div className="space-y-2">
                {(["partNumber", "serial", "ipAddress"] as const).map((key) => (
                  <label key={key} className="block text-sm">
                    {key === "serial" ? "Serial Number" : key === "partNumber" ? "Part Number" : "IP Address"}
                    <input
                      className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
                      value={pendingIdentifiers[key] ?? ""}
                      onChange={(e) => setPendingIdentifiers((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder="Not detected — enter if visible"
                    />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-white disabled:opacity-40"
                  disabled={!pendingIdentifiers.serial?.trim()}
                  onClick={confirmCamera1}
                >
                  Confirm Camera 1
                </button>
                <button type="button" className="rounded-lg border border-slate-500 px-4 py-2" onClick={retake}>
                  Retake
                </button>
              </div>
              <button type="button" className="text-xs text-slate-400 underline" onClick={() => setShowScanDetails((v) => !v)}>
                {showScanDetails ? "Hide scan details" : "Show scan details (for QA)"}
              </button>
              {showScanDetails ? (
                <div className="space-y-1 rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-400">
                  <p>Raw OCR text: {scan.rawOcrText || "(none)"}</p>
                  <p>Barcode payloads: {scan.barcodePayloads.join(", ") || "(none)"}</p>
                  <p>
                    OCR time: {Math.round(scan.ocrMs)}ms · Barcode time: {Math.round(scan.barcodeMs)}ms
                  </p>
                  <p>
                    Evidence: {scan.classification.top?.evidence.map((e) => `${e.kind}:${e.detail}(${e.weight})`).join("; ") || "(none)"}
                  </p>
                  {scan.warnings.length ? <p>Warnings: {scan.warnings.join("; ")}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {stage === "manual_camera1" ? (
        <div className="space-y-3 rounded-xl border border-slate-600 bg-slate-900/60 p-4">
          <h3 className="font-medium">Manual entry — Camera 1</h3>
          <label className="block text-sm">
            Reason
            <select
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
              value={manualReason}
              onChange={(e) => setManualReason(e.target.value as ManualFallbackReason)}
            >
              {(Object.keys(MANUAL_FALLBACK_REASON_LABELS) as ManualFallbackReason[]).map((k) => (
                <option key={k} value={k}>
                  {MANUAL_FALLBACK_REASON_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <input
            className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
            placeholder="Notes (optional)"
            value={manualNotes}
            onChange={(e) => setManualNotes(e.target.value)}
          />
          {(["partNumber", "serial", "ipAddress"] as const).map((key) => (
            <label key={key} className="block text-sm">
              {key === "serial" ? "Serial Number" : key === "partNumber" ? "Part Number" : "IP Address"}
              <input
                className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
                value={pendingIdentifiers[key] ?? ""}
                onChange={(e) => setPendingIdentifiers((p) => ({ ...p, [key]: e.target.value }))}
              />
            </label>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-white disabled:opacity-40"
              disabled={!pendingIdentifiers.serial?.trim()}
              onClick={confirmCamera1}
            >
              Confirm Camera 1
            </button>
            <button type="button" className="rounded-lg border border-slate-500 px-4 py-2" onClick={() => setStage("capture_camera1")}>
              Back to scan
            </button>
          </div>
        </div>
      ) : null}

      {stage === "camera_count" && system ? (
        <div className="space-y-3 rounded-xl border border-emerald-700/50 bg-slate-900/60 p-4">
          <p className="text-sm text-emerald-200">Camera 1 identifiers saved — mounting location and view direction come next.</p>
          <p className="text-sm">
            How many cameras are being installed? ({BLAXTAIR_AHD_CAMERA_MIN}–{BLAXTAIR_AHD_CAMERA_MAX})
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: BLAXTAIR_AHD_CAMERA_MAX }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" className="rounded-lg border border-emerald-500 px-4 py-3 text-emerald-100" onClick={() => pickCameraCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {stage === "components" && system ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {orderedComponents.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`rounded-lg border px-3 py-1 text-sm ${active?.id === c.id ? "border-emerald-400 text-emerald-100" : "border-slate-600"}`}
                onClick={() => {
                  setActiveComponentId(c.id);
                  setScan(null);
                  setPendingIdentifiers({});
                  setDuplicateError(null);
                  props.onCancelReinstallPrompt();
                }}
              >
                {c.technicianConfirmed ? "✓ " : ""}
                {c.componentLabel}
              </button>
            ))}
          </div>

          {active ? (
            active.technicianConfirmed ? (
              <ComponentSummary component={active} onEdit={() => patchComponent(active.id, { technicianConfirmed: false })} />
            ) : active.componentType === "monitor" ? (
              <MonitorFields
                component={active}
                onPatch={(patch) => patchComponent(active.id, patch)}
                onEditIdentifier={(key, value) => editIdentifier(active.id, key, value)}
                onConfirm={() => confirmComponent(active.id, { extractionSource: "manual" })}
                duplicateError={duplicateError}
              />
            ) : (
              <CameraScanFields
                component={active}
                scan={scan}
                pendingIdentifiers={pendingIdentifiers}
                busy={busy}
                error={error || props.blockMessage}
                onScan={runScan}
                onSample={() => void runScan(renderSyntheticBlaxtairCameraLabel(), true)}
                onRetake={retake}
                onFieldChange={(key, value) => setPendingIdentifiers((p) => ({ ...p, [key]: value }))}
                onApplyScan={() => applyCameraScanToComponent(active.id)}
                onEditIdentifier={(key, value) => editIdentifier(active.id, key, value)}
                onPatch={(patch) => patchComponent(active.id, patch)}
                onConfirmWithoutScan={() => confirmComponent(active.id)}
                duplicateError={duplicateError}
              />
            )
          ) : null}

          <div className="rounded-lg border border-slate-700 p-3 text-sm space-y-1">
            <p className="font-medium text-emerald-200">Equipment summary</p>
            {formatBlaxtairSystemSummary(system).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          {!allComponentsConfirmed ? <p className="text-xs text-slate-500">Confirm every camera and the monitor before moving on.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function ComponentSummary({ component, onEdit }: { component: InstalledProductComponent; onEdit: () => void }) {
  const loc = component.mountingLocation
    ? component.mountingLocation === "other" && component.mountingLocationOther?.trim()
      ? component.mountingLocationOther.trim()
      : MOUNTING_LOCATION_LABELS[component.mountingLocation]
    : null;
  const view = component.viewDirection
    ? component.viewDirection === "other" && component.viewDirectionOther?.trim()
      ? component.viewDirectionOther.trim()
      : VIEW_DIRECTION_LABELS[component.viewDirection]
    : null;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-left font-medium text-emerald-200" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "▾" : "▸"} ✓ {component.componentLabel}
          {component.identifiers.serialNumber ? ` · SN ${component.identifiers.serialNumber}` : ""}
          {loc ? ` · ${loc}` : ""}
          {view ? ` · ${view}` : ""}
        </button>
        <button type="button" className="text-slate-300 underline" onClick={onEdit}>
          Edit
        </button>
      </div>
      {expanded ? (
        <div className="mt-2">
          {component.labelPhoto?.localPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={component.labelPhoto.localPreview} alt={`${component.componentLabel} label`} className="max-h-64 rounded border border-slate-700" />
          ) : (
            <p className="text-xs text-slate-500">No photo on file (entered manually).</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CameraScanFields(props: {
  component: InstalledProductComponent;
  scan: BlaxtairCameraScanResult | null;
  pendingIdentifiers: Record<string, string>;
  busy: boolean;
  error: string | null;
  onScan: (source: Blob | HTMLCanvasElement) => void;
  onSample: () => void;
  onRetake: () => void;
  onFieldChange: (key: string, value: string) => void;
  onApplyScan: () => void;
  onEditIdentifier: (key: DeviceIdentifierKey, value: string) => void;
  onPatch: (patch: Partial<InstalledProductComponent>) => void;
  onConfirmWithoutScan: () => void;
  duplicateError: string | null;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const hasIdentifiers = Object.keys(props.component.identifiers).length > 0;
  const hasSerial = !!props.component.identifiers.serialNumber?.trim();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) props.onScan(f);
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-600 p-3">
      <p className="font-medium">{props.component.componentLabel}</p>

      {!props.scan ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-white" onClick={() => fileRef.current?.click()} disabled={props.busy}>
            {props.busy ? "Reading label…" : hasIdentifiers ? "Retake Photo" : "Take Photo"}
          </button>
          <button type="button" className="rounded-lg border border-slate-500 px-3 py-2" onClick={() => uploadRef.current?.click()} disabled={props.busy}>
            {hasIdentifiers ? "Upload New Photo" : "Upload Photo"}
          </button>
          <button type="button" className="rounded-lg border border-slate-500 px-3 py-2" onClick={props.onSample}>
            Use sample label
          </button>
          {!hasIdentifiers ? (
            <button
              type="button"
              className="rounded-lg border border-slate-500 px-3 py-2 text-sm text-slate-300"
              onClick={() => props.onPatch({ identifiers: { partNumber: "", serialNumber: "", ipAddress: "" }, extractionSource: "manual" })}
            >
              Enter manually
            </button>
          ) : null}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
          <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </div>
      ) : null}

      {props.error ? <p className="text-sm text-red-300">{props.error}</p> : null}

      {props.scan ? (
        <div className="space-y-2">
          <p className="text-sm">{bandLabel(props.scan.classification.band)}</p>
          {props.scan.partNumberInferred ? (
            <p className="rounded border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-200">
              Part number assumed as {props.pendingIdentifiers.partNumber} — this model&apos;s label print consistently clips the final digit. Confirm
              against the physical label, or edit if wrong.
            </p>
          ) : null}
          {(["partNumber", "serial", "ipAddress"] as const).map((key) => (
            <label key={key} className="block text-sm">
              {key === "serial" ? "Serial Number" : key === "partNumber" ? "Part Number" : "IP Address"}
              <input
                className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
                value={props.pendingIdentifiers[key] ?? ""}
                onChange={(e) => props.onFieldChange(key, e.target.value)}
              />
            </label>
          ))}
          {props.duplicateError ? <p className="rounded border border-red-700/50 bg-red-950/30 p-2 text-xs text-red-200">{props.duplicateError}</p> : null}
          <div className="flex gap-2">
            <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-white" onClick={props.onApplyScan}>
              Confirm
            </button>
            <button type="button" className="rounded-lg border border-slate-500 px-3 py-2" onClick={props.onRetake}>
              Retake
            </button>
          </div>
        </div>
      ) : null}

      {hasIdentifiers && !props.scan ? (
        <div className="space-y-2">
          {(Object.keys(props.component.identifiers).filter((k) => k !== "custom") as DeviceIdentifierKey[]).map((key) => (
            <label key={key} className="block text-sm">
              {key}
              <input
                className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
                value={props.component.identifiers[key] ?? ""}
                onChange={(e) => props.onEditIdentifier(key, e.target.value)}
              />
            </label>
          ))}
        </div>
      ) : null}

      <MountingViewFields component={props.component} onPatch={props.onPatch} showView />

      {props.duplicateError ? <p className="rounded border border-red-700/50 bg-red-950/30 p-2 text-xs text-red-200">{props.duplicateError}</p> : null}

      <button
        type="button"
        className="rounded-lg bg-emerald-600 px-4 py-2 text-white disabled:opacity-40"
        disabled={!hasSerial}
        onClick={props.onConfirmWithoutScan}
      >
        Confirm {props.component.componentLabel}
      </button>
    </div>
  );
}

function MonitorFields(props: {
  component: InstalledProductComponent;
  onPatch: (patch: Partial<InstalledProductComponent>) => void;
  onEditIdentifier: (key: DeviceIdentifierKey, value: string) => void;
  onConfirm: () => void;
  duplicateError: string | null;
}) {
  const hasSerial = !!props.component.identifiers.serialNumber?.trim();
  return (
    <div className="space-y-3 rounded-lg border border-slate-600 p-3">
      <p className="font-medium">{props.component.componentLabel}</p>
      {!BLAXTAIR_MONITOR_LABEL_OCR_SUPPORTED ? (
        <p className="rounded border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-200">
          Monitor label scanning isn&apos;t available yet — no approved sample label exists for the monitor. Enter details manually. (See
          docs/OCR_Strategy.md.)
        </p>
      ) : null}
      <label className="block text-sm">
        Serial Number
        <input
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          value={props.component.identifiers.serialNumber ?? ""}
          onChange={(e) => props.onEditIdentifier("serialNumber", e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Part Number (when available)
        <input
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          value={props.component.identifiers.partNumber ?? ""}
          onChange={(e) => props.onEditIdentifier("partNumber", e.target.value)}
        />
      </label>
      <MountingViewFields component={props.component} onPatch={props.onPatch} showView={false} />
      {props.duplicateError ? <p className="rounded border border-red-700/50 bg-red-950/30 p-2 text-xs text-red-200">{props.duplicateError}</p> : null}
      <button type="button" className="rounded-lg bg-emerald-600 px-4 py-2 text-white disabled:opacity-40" disabled={!hasSerial} onClick={props.onConfirm}>
        Confirm Monitor
      </button>
    </div>
  );
}

function MountingViewFields(props: { component: InstalledProductComponent; onPatch: (patch: Partial<InstalledProductComponent>) => void; showView: boolean }) {
  return (
    <>
      <label className="block text-sm">
        Mounting location
        <select
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          value={props.component.mountingLocation ?? ""}
          onChange={(e) => props.onPatch({ mountingLocation: (e.target.value || null) as MountingLocationId | null })}
        >
          <option value="">Select location</option>
          {(Object.keys(MOUNTING_LOCATION_LABELS) as MountingLocationId[]).map((k) => (
            <option key={k} value={k}>
              {MOUNTING_LOCATION_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {props.component.mountingLocation === "other" ? (
        <input
          className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          placeholder="Custom location"
          value={props.component.mountingLocationOther ?? ""}
          onChange={(e) => props.onPatch({ mountingLocationOther: e.target.value })}
        />
      ) : null}
      {props.showView ? (
        <>
          <label className="block text-sm">
            View direction
            <select
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
              value={props.component.viewDirection ?? ""}
              onChange={(e) => props.onPatch({ viewDirection: (e.target.value || null) as ViewDirectionId | null })}
            >
              <option value="">Select view</option>
              {(Object.keys(VIEW_DIRECTION_LABELS) as ViewDirectionId[]).map((k) => (
                <option key={k} value={k}>
                  {VIEW_DIRECTION_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          {props.component.viewDirection === "other" ? (
            <input
              className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
              placeholder="Custom view"
              value={props.component.viewDirectionOther ?? ""}
              onChange={(e) => props.onPatch({ viewDirectionOther: e.target.value })}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
