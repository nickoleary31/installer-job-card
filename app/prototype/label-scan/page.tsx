"use client";

/**
 * NON-PRODUCTION prototype: multi-device vehicle job + label scan hardening.
 * No database / Storage writes.
 *
 * Demo (no OCR): /prototype/label-scan?demo=multidevice
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  classifyDeviceLabel,
  type ClassificationResult,
} from "@/lib/prototype/label-scan/classify";
import {
  deviceFamilyFromFormId,
  getDeviceFamilyProfile,
  getVariantProfile,
  resolveGuideForDevice,
  type DeviceFamilyId,
  type InstallationVariantId,
  type InstalledDeviceRecord,
} from "@/lib/prototype/label-scan/device-family";
import type { FieldCandidate } from "@/lib/prototype/label-scan/extract";
import type { ResolvedInstallGuide } from "@/lib/prototype/label-scan/install-guide";
import { runLabelScanPipeline } from "@/lib/prototype/label-scan/pipeline";
import {
  canvasToDataUrl,
  DEFAULT_LABEL_GUIDE,
  renderSyntheticLinxupLabel,
} from "@/lib/prototype/label-scan/preprocess";
import {
  getPrototypeProfile,
  type LabelExtractionProfile,
  type LabelFieldKey,
} from "@/lib/prototype/label-scan/profile";

type Stage =
  | "vehicle"
  | "capture"
  | "classify"
  | "variant"
  | "review"
  | "device_section"
  | "job_summary";

type FieldValues = Partial<Record<LabelFieldKey, string>>;

type AuditTrail = {
  detectedFormId: string | null;
  detectedDeviceFamily: DeviceFamilyId | null;
  detectedConfidence: number | null;
  band: string | null;
  technicianConfirmedFormId: string | null;
  technicianConfirmedFamily: DeviceFamilyId | null;
  installationVariant: InstallationVariantId | null;
  technicianOverrode: boolean;
};

function emptyForProfile(profile: LabelExtractionProfile): FieldValues {
  const out: FieldValues = {};
  for (const f of profile.fields) out[f.key] = "";
  return out;
}

function emptyAudit(): AuditTrail {
  return {
    detectedFormId: null,
    detectedDeviceFamily: null,
    detectedConfidence: null,
    band: null,
    technicianConfirmedFormId: null,
    technicianConfirmedFamily: null,
    installationVariant: null,
    technicianOverrode: false,
  };
}

function newId() {
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function LabelScanPrototypePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<Stage>("vehicle");
  const [vehicleLabel, setVehicleLabel] = useState("Unit 214 · 2022 Freightliner");
  const [installedDevices, setInstalledDevices] = useState<InstalledDeviceRecord[]>([]);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [installationVariant, setInstallationVariant] = useState<InstallationVariantId | null>(null);
  const [audit, setAudit] = useState<AuditTrail>(emptyAudit);

  const [rawOcr, setRawOcr] = useState("");
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<FieldCandidate[]>([]);
  const [fields, setFields] = useState<FieldValues>({});
  const [timing, setTiming] = useState<{ ocrMs: number; barcodeMs: number } | null>(null);
  const [preprocessingHelped, setPreprocessingHelped] = useState<boolean | null>(null);
  const [pendingSource, setPendingSource] = useState<Blob | HTMLCanvasElement | null>(null);
  const [pendingDevice, setPendingDevice] = useState<InstalledDeviceRecord | null>(null);
  const [guideViewerOpen, setGuideViewerOpen] = useState(false);
  const [guideProbeNote, setGuideProbeNote] = useState<string | null>(null);

  const profile = selectedFormId ? getPrototypeProfile(selectedFormId) : null;
  const deviceFamily = selectedFormId ? deviceFamilyFromFormId(selectedFormId) : null;
  const familyProfile = deviceFamily ? getDeviceFamilyProfile(deviceFamily) : null;
  const variantMeta = deviceFamily ? getVariantProfile(deviceFamily, installationVariant) : null;

  let resolvedGuide: ResolvedInstallGuide | null = null;
  if (deviceFamily) {
    const variant = familyProfile?.requiresInstallationVariant
      ? installationVariant
      : ("standard" as InstallationVariantId);
    if (!(familyProfile?.requiresInstallationVariant && !installationVariant)) {
      resolvedGuide = resolveGuideForDevice(deviceFamily, variant);
    }
  }

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const loadMultideviceDemo = () => {
    const d1: InstalledDeviceRecord = {
      id: "demo-at3",
      deviceFamily: "linxup_asset_tracker",
      installationVariant: "standard",
      identifiers: { activationCode: "EE1-RVY", serial: "68W661200312", imei: "868892081011521" },
      labelPhoto: null,
      extractionSource: "ocr",
      detectionConfidence: 98,
      technicianConfirmed: true,
      detectionOverridden: false,
      detectedDeviceFamily: "linxup_asset_tracker",
      installGuide: {
        title: "AT3 Installation Guide",
        version: "2026-04",
        usedSource: "cached",
        openUrl: "/guides/linxup/at3-install-guide.pdf",
      },
      formData: { sectionComplete: true },
      cableHarnessType: null,
      installPhotos: [{ fieldName: "finalInstall", label: "Final install (demo)" }],
    };
    const d2: InstalledDeviceRecord = {
      id: "demo-vt",
      deviceFamily: "linxup_vehicle_tracker",
      installationVariant: "obd_ii",
      identifiers: { activationCode: "G6R-81Q", serial: "88X160090306", imei: "868892080208581" },
      labelPhoto: null,
      extractionSource: "ocr",
      detectionConfidence: 99,
      technicianConfirmed: true,
      detectionOverridden: false,
      detectedDeviceFamily: "linxup_vehicle_tracker",
      installGuide: {
        title: "Vehicle Tracker OBD-II Installation Guide",
        version: "2026-04",
        usedSource: "cached",
        openUrl: "/guides/linxup/vehicle-tracker-obd-ii-install-guide.pdf",
      },
      formData: { sectionComplete: true },
      cableHarnessType: "obd_ii",
      installPhotos: [{ fieldName: "finalInstall", label: "Final install (demo)" }],
    };
    setVehicleLabel("Unit 214 · 2022 Freightliner (demo)");
    setInstalledDevices([d1, d2]);
    setStage("job_summary");
    setStatus("Demo: two devices in one vehicle job (no OCR / no writes).");
  };
  const resetScanState = () => {
    setClassification(null);
    setSelectedFormId(null);
    setInstallationVariant(null);
    setCandidates([]);
    setFields({});
    setPreviewUrl(null);
    setEnhancedUrl(null);
    setPendingSource(null);
    setPendingDevice(null);
    setGuideViewerOpen(false);
    setGuideProbeNote(null);
    setAudit(emptyAudit());
    setError(null);
  };

  const startScan = () => {
    stopCamera();
    resetScanState();
    setStage("capture");
    setStatus("Scan device label for this vehicle job.");
  };

  const runCaptureClassify = async (
    source: Blob | HTMLCanvasElement,
    opts?: { useFullFrame?: boolean },
  ) => {
    setBusy(true);
    setError(null);
    setStatus("Reading label (barcode + OCR) and classifying device family…");
    setPendingSource(source);
    setInstallationVariant(null);
    setGuideViewerOpen(false);
    try {
      const probeProfile = getPrototypeProfile("linxup_asset_tracker");
      const result = await runLabelScanPipeline({
        profile: probeProfile,
        source,
        useFullFrame: opts?.useFullFrame !== false,
        guide: opts?.useFullFrame === false ? DEFAULT_LABEL_GUIDE : null,
      });

      setPreviewUrl(canvasToDataUrl(result.croppedCanvas));
      setEnhancedUrl(canvasToDataUrl(result.enhancedCanvas));
      setRawOcr(result.extraction.rawOcrText);
      setBarcodes(result.extraction.barcodePayloads);
      setWarnings(result.extraction.warnings);
      setTiming({ ocrMs: result.ocrMs, barcodeMs: result.barcodeMs });
      setPreprocessingHelped(result.preprocessingHelped);

      const classified = classifyDeviceLabel({
        ocrText: result.extraction.rawOcrText,
        barcodePayloads: result.extraction.barcodePayloads,
      });
      setClassification(classified);

      const detectedId = classified.top?.profile.formId || null;
      setAudit({
        ...emptyAudit(),
        detectedFormId: detectedId,
        detectedDeviceFamily: deviceFamilyFromFormId(detectedId),
        detectedConfidence: classified.top?.confidence ?? null,
        band: classified.band,
      });

      setSelectedFormId(classified.canPreselect && detectedId ? detectedId : null);
      setStage("classify");
      setStatus("Confirm device family (Vehicle Tracker = family only; OBD/JBUS chosen next).");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pipeline failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const extractForConfirmedProfile = async (
    formId: string,
    overrode: boolean,
    variant: InstallationVariantId | null,
  ) => {
    if (!pendingSource) {
      setError("Missing label image — retake required.");
      return;
    }
    const confirmedProfile = getPrototypeProfile(formId);
    const family = deviceFamilyFromFormId(formId);
    setBusy(true);
    setError(null);
    setStatus(`Extracting ${confirmedProfile.uiSelectLabel} fields…`);
    try {
      const result = await runLabelScanPipeline({
        profile: confirmedProfile,
        source: pendingSource,
        useFullFrame: true,
      });
      setPreviewUrl(canvasToDataUrl(result.croppedCanvas));
      setEnhancedUrl(canvasToDataUrl(result.enhancedCanvas));
      setRawOcr(result.extraction.rawOcrText);
      setBarcodes(result.extraction.barcodePayloads);
      setWarnings(result.extraction.warnings);
      setCandidates(result.extraction.candidates);
      setTiming({ ocrMs: result.ocrMs, barcodeMs: result.barcodeMs });
      setPreprocessingHelped(result.preprocessingHelped);

      const next = emptyForProfile(confirmedProfile);
      for (const c of result.extraction.candidates) next[c.key] = c.value;
      setFields(next);
      setSelectedFormId(formId);
      setInstallationVariant(variant);
      setAudit((prev) => ({
        ...prev,
        technicianConfirmedFormId: formId,
        technicianConfirmedFamily: family,
        installationVariant: variant,
        technicianOverrode: overrode,
      }));
      setStage("review");
      setStatus("Review identifiers. Correction chips never auto-apply.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  };

  const onConfirmFamily = () => {
    if (!selectedFormId || !classification) return;
    const overrode = selectedFormId !== classification.top?.profile.formId;
    const family = deviceFamilyFromFormId(selectedFormId);
    if (!family) return;
    const fam = getDeviceFamilyProfile(family);
    if (fam.requiresInstallationVariant) {
      setAudit((prev) => ({
        ...prev,
        technicianConfirmedFormId: selectedFormId,
        technicianConfirmedFamily: family,
        technicianOverrode: overrode,
        installationVariant: null,
      }));
      setInstallationVariant(null);
      setStage("variant");
      setStatus("Select OBD-II or JBUS — not inferred from the label.");
      return;
    }
    void extractForConfirmedProfile(selectedFormId, overrode, "standard");
  };

  const onConfirmVariant = () => {
    if (!selectedFormId || !installationVariant || !classification) return;
    const overrode = selectedFormId !== classification.top?.profile.formId;
    void extractForConfirmedProfile(selectedFormId, overrode, installationVariant);
  };

  const acceptIdentifiers = () => {
    if (!deviceFamily) return;
    const guide = resolvedGuide;
    const record: InstalledDeviceRecord = {
      id: newId(),
      deviceFamily,
      installationVariant: installationVariant || "standard",
      identifiers: { ...fields },
      labelPhoto: previewUrl ? { localPreview: previewUrl } : null,
      extractionSource: barcodes.length ? "mixed" : "ocr",
      detectionConfidence: audit.detectedConfidence,
      technicianConfirmed: true,
      detectionOverridden: audit.technicianOverrode,
      detectedDeviceFamily: audit.detectedDeviceFamily,
      installGuide: guide
        ? {
            title: guide.definition.title,
            version: guide.definition.version,
            usedSource: guide.usedSource,
            openUrl: guide.openUrl,
          }
        : null,
      formData: {},
      cableHarnessType:
        installationVariant === "obd_ii" ? "obd_ii" : installationVariant === "jbus" ? "jbus" : null,
      installPhotos: [],
    };
    setPendingDevice(record);
    setStage("device_section");
    setStatus("Complete this device section, then add another or finish the job.");
  };

  const completeDeviceSection = () => {
    if (!pendingDevice) return;
    const done: InstalledDeviceRecord = {
      ...pendingDevice,
      formData: { ...pendingDevice.formData, sectionComplete: true },
      installPhotos: [{ fieldName: "finalInstall", label: "Final install (prototype stub)" }],
    };
    setInstalledDevices((prev) => [...prev, done]);
    setPendingDevice(null);
    resetScanState();
    setStage("job_summary");
    setStatus("Device added to vehicle job.");
  };

  const openCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      await new Promise((r) => setTimeout(r, 50));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setError("Camera not available. Use upload or synthetic sample instead.");
      setCameraOpen(false);
    }
  };

  const captureFromCamera = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopCamera();
    await runCaptureClassify(canvas, { useFullFrame: false });
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    if (!/^image\//i.test(file.type)) {
      setError("Please choose a JPEG or PNG image.");
      return;
    }
    await runCaptureClassify(file, { useFullFrame: true });
  };

  const loadSyntheticSample = async (kind: "asset" | "vehicle" | "linxcam") => {
    stopCamera();
    await runCaptureClassify(renderSyntheticLinxupLabel(kind), { useFullFrame: true });
  };

  const openGuideNewTab = (url?: string | null) => {
    const target = url ?? resolvedGuide?.openUrl;
    if (!target) {
      setGuideProbeNote(resolvedGuide?.unavailableMessage || "Guide unavailable.");
      return;
    }
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const openGuideInApp = () => {
    if (!resolvedGuide?.available || !resolvedGuide.openUrl) {
      setGuideProbeNote(resolvedGuide?.unavailableMessage || "Guide unavailable.");
      return;
    }
    setGuideViewerOpen(true);
  };

  const candByKey = useMemo(() => {
    const m = new Map<LabelFieldKey, FieldCandidate>();
    for (const c of candidates) m.set(c.key, c);
    return m;
  }, [candidates]);

  const familyName = (f: DeviceFamilyId) => getDeviceFamilyProfile(f).displayName;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-bold">PROTOTYPE — multi-device vehicle job (no DB/Storage)</p>
          <p className="mt-1">
            Family-only detect · VT requires OBD-II/JBUS · guide at top of each device · Add another device loop.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Vehicle job · label scan</h1>
          <Link href="/home" className="text-sm font-semibold text-blue-700 hover:underline">
            Back to Home
          </Link>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <span className="font-semibold">Vehicle:</span> {vehicleLabel}
          <span className="ml-3 text-slate-600">Devices: {installedDevices.length}</span>
        </div>

        {stage === "vehicle" ? (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">1. Vehicle / asset (shared)</h2>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={vehicleLabel}
              onChange={(e) => setVehicleLabel(e.target.value)}
            />
            <p className="text-sm text-slate-600">Vehicle photos would be captured here in production.</p>
            <button type="button" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white" onClick={startScan}>
              Scan Device Label
            </button>
            <button type="button" className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900" onClick={loadMultideviceDemo}>
              Load demo: 2 devices in one job
            </button>
          </section>
        ) : null}

        {stage === "capture" ? (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Scan device label</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white" onClick={() => void openCamera()} disabled={busy}>
                Open camera
              </button>
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                Upload real label
              </button>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] || null)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold" onClick={() => void loadSyntheticSample("asset")} disabled={busy}>Synthetic AT3</button>
              <button type="button" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold" onClick={() => void loadSyntheticSample("vehicle")} disabled={busy}>Synthetic Vehicle Tracker</button>
              <button type="button" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold" onClick={() => void loadSyntheticSample("linxcam")} disabled={busy}>Synthetic LinxCam</button>
            </div>
            {cameraOpen ? (
              <div className="relative overflow-hidden rounded-xl bg-black">
                <video ref={videoRef} playsInline muted className="max-h-[70vh] w-full object-contain" />
                <div className="flex gap-2 p-3">
                  <button type="button" className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white" onClick={() => void captureFromCamera()} disabled={busy}>Capture</button>
                  <button type="button" className="rounded-xl bg-white/90 px-4 py-3 text-sm font-semibold" onClick={stopCamera}>Cancel</button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {stage === "classify" && classification ? (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Confirm device family</h2>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Label" className="max-h-56 w-full rounded-lg border object-contain" />
            ) : null}
            <div className={`rounded-xl border p-4 ${classification.band === "high" ? "border-emerald-300 bg-emerald-50" : classification.band === "medium" ? "border-amber-300 bg-amber-50" : "border-red-300 bg-red-50"}`}>
              <p className="font-bold">
                Detected: {classification.top?.profile.uiSelectLabel || "Unknown"} ({classification.band} · conf{" "}
                {classification.top?.confidence ?? 0})
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {(classification.top?.evidence || []).slice(0, 6).map((e) => (
                  <li key={`${e.kind}-${e.detail}`}>{e.detail}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              {classification.ranked.map((r) => (
                <label key={r.profile.formId} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3">
                  <input type="radio" name="deviceChoice" checked={selectedFormId === r.profile.formId} onChange={() => setSelectedFormId(r.profile.formId)} />
                  <span className="text-sm font-semibold">{r.profile.uiSelectLabel}</span>
                  <span className="text-xs text-slate-600">score {r.score}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60" disabled={!selectedFormId || busy} onClick={onConfirmFamily}>
                Confirm family
              </button>
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold" onClick={startScan}>Retake</button>
            </div>
          </section>
        ) : null}

        {stage === "variant" && familyProfile?.requiresInstallationVariant ? (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Installation variant (required)</h2>
            <p className="text-sm text-slate-600">OBD-II and JBUS share the same label/family. Choose the install path.</p>
            {familyProfile.variants.map((v) => (
              <label key={v.variantId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
                <input type="radio" name="installVariant" className="mt-1" checked={installationVariant === v.variantId} onChange={() => setInstallationVariant(v.variantId)} />
                <span>
                  <span className="font-semibold">{v.label}</span>
                  <span className="mt-1 block text-xs text-slate-600">{v.installGuide.title}</span>
                </span>
              </label>
            ))}
            <button type="button" className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60" disabled={!installationVariant || busy} onClick={onConfirmVariant}>
              Continue & extract fields
            </button>
          </section>
        ) : null}

        {(stage === "review" || stage === "device_section") && profile && deviceFamily ? (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">
                    {familyProfile?.displayName}
                    {variantMeta && variantMeta.variantId !== "standard" ? ` · ${variantMeta.label}` : ""}
                  </h2>
                  {resolvedGuide?.definition.version ? (
                    <p className="text-xs text-slate-600">Guide rev {resolvedGuide.definition.version}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  {resolvedGuide?.available ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white" onClick={openGuideInApp}>
                          View Installation Guide
                        </button>
                        <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold" onClick={() => openGuideNewTab()}>
                          Open in new tab
                        </button>
                      </div>
                      {resolvedGuide.sourceLabel ? (
                        <span className="text-xs font-semibold text-slate-600">{resolvedGuide.sourceLabel}</span>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-amber-800">{resolvedGuide?.unavailableMessage}</p>
                  )}
                </div>
              </div>
              {guideProbeNote ? <p className="mt-2 text-xs text-amber-800">{guideProbeNote}</p> : null}
            </div>

            {stage === "review" ? (
              <>
                <h3 className="font-bold">Identifiers</h3>
                {profile.fields.map((rule) => {
                  const c = candByKey.get(rule.key);
                  return (
                    <div key={rule.key} className="rounded-xl border border-slate-200 p-3">
                      <div className="mb-1 flex flex-wrap gap-2">
                        <label className="text-sm font-bold">{rule.label}</label>
                        {c?.ambiguous ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">ambiguous chars</span>
                        ) : null}
                      </div>
                      <input
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                        value={fields[rule.key] || ""}
                        onChange={(e) => setFields((prev) => ({ ...prev, [rule.key]: e.target.value }))}
                      />
                      {c?.correctionSuggestions?.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {c.correctionSuggestions.map((s) => (
                            <button
                              key={`${s.from}-${s.to}-${s.reason}`}
                              type="button"
                              className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-mono"
                              title={s.reason}
                              onClick={() => setFields((prev) => ({ ...prev, [rule.key]: s.to }))}
                            >
                              Use {s.to}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {enhancedUrl ? (
                  <p className="text-xs text-slate-500">Enhanced preview available ({enhancedUrl.slice(0, 32)}…)</p>
                ) : null}
                <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <summary className="cursor-pointer font-semibold">Debug OCR / barcodes</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify({ audit, barcodes, warnings, timing, preprocessingHelped, rawOcr }, null, 2)}</pre>
                </details>
                <button type="button" className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white" onClick={acceptIdentifiers}>
                  Accept identifiers
                </button>
              </>
            ) : (
              <>
                <h3 className="font-bold">Device install section (stub)</h3>
                <p className="text-sm text-slate-600">
                  Required photos: {(variantMeta?.requiredPhotoKeys || []).join(", ") || "—"}
                </p>
                <pre className="rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(pendingDevice?.identifiers, null, 2)}</pre>
                <button type="button" className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white" onClick={completeDeviceSection}>
                  Complete device section
                </button>
              </>
            )}
          </section>
        ) : null}

        {stage === "job_summary" ? (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Vehicle job summary</h2>
            <p className="text-sm text-slate-600">{vehicleLabel}</p>
            {installedDevices.map((d, idx) => {
              const guide = resolveGuideForDevice(d.deviceFamily, d.installationVariant);
              return (
                <div key={d.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold">
                        Device {idx + 1}: {familyName(d.deviceFamily)}
                        {d.installationVariant && d.installationVariant !== "standard"
                          ? ` · ${d.installationVariant}`
                          : ""}
                      </p>
                      <p className="text-xs text-slate-600">
                        conf {d.detectionConfidence ?? "—"}
                        {d.detectionOverridden ? " · overridden" : ""}
                      </p>
                    </div>
                    {guide.available ? (
                      <button
                        type="button"
                        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
                        onClick={() => openGuideNewTab(guide.openUrl)}
                      >
                        View Installation Guide
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-amber-800">Guide unavailable</span>
                    )}
                  </div>
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(d.identifiers, null, 2)}</pre>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white" onClick={startScan}>
                Add another device
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold"
                onClick={() => setStatus(`Prototype submit ready with ${installedDevices.length} device(s). No writes.`)}
              >
                Review & submit (prototype)
              </button>
            </div>
          </section>
        ) : null}

        {guideViewerOpen && resolvedGuide?.openUrl ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
            <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <p className="font-bold">{resolvedGuide.definition.title}</p>
                <button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => setGuideViewerOpen(false)}>
                  Close
                </button>
              </div>
              <iframe title="Installation guide" src={resolvedGuide.openUrl} className="min-h-[60vh] w-full flex-1 bg-slate-100" />
            </div>
          </div>
        ) : null}

        {busy ? <p className="text-sm font-semibold text-blue-800">Processing…</p> : null}
        {status ? <p className="text-sm text-slate-700">{status}</p> : null}
        {error ? (
          <p className="text-sm font-semibold text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
