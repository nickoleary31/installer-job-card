"use client";

/**
 * Feature-flagged Product Devices pilot panel.
 * Systems = company products; components = physical units inside a system.
 * Live OCR is NOT integrated — detection is simulated behind the same confirm UX.
 */

import { useMemo, useState } from "react";
import {
  BLAXTAIR_AHD_CAMERA_MAX,
  BLAXTAIR_AHD_CAMERA_MIN,
  MANUAL_FALLBACK_REASON_LABELS,
  MOUNTING_LOCATION_LABELS,
  PILOT_PRODUCT_DEVICE_DEFINITIONS,
  VIEW_DIRECTION_LABELS,
  applyBlaxtairCameraCount,
  applyIdentifierEdit,
  buildInstalledProductSystem,
  definitionIsMultiComponent,
  definitionRequiresInstallationVariant,
  formatBlaxtairSystemSummary,
  photoNamespace,
  resolveDetectedHardwareToCompanyProduct,
  sortSystemsDeterministically,
  updateComponentFields,
  upsertInstalledSystem,
  type DeviceIdentifierKey,
  type HardwareProfileId,
  type InstallationVariantId,
  type InstalledProductComponent,
  type InstalledProductSystem,
  type ManualFallbackReason,
  type MountingLocationId,
  type ViewDirectionId,
} from "@/lib/product-devices";

type Props = {
  companyId: string;
  systems: InstalledProductSystem[];
  onChange: (systems: InstalledProductSystem[]) => void;
  onUseManualProductPicker: () => void;
  /** Local/test only — enables Blaxtair AHD multi-component fixture in the simulator. */
  includeBlaxtairFixture?: boolean;
};

type Stage =
  | "idle"
  | "detect"
  | "variant"
  | "identifiers"
  | "camera_count"
  | "components"
  | "manual";

const PROFILE_OPTIONS: { id: HardwareProfileId; label: string }[] = [
  { id: "linxup_at3_label", label: "Asset Tracker / AT3 label" },
  { id: "linxup_vehicle_tracker_label", label: "Vehicle Tracker label" },
  { id: "linxup_linxcam_label", label: "LinxCam label" },
  { id: "blaxtair_ahd_camera_label", label: "Blaxtair AHD camera (fixture)" },
];

export function ProductDevicesPilotPanel({
  companyId,
  systems,
  onChange,
  onUseManualProductPicker,
  includeBlaxtairFixture = false,
}: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [processing, setProcessing] = useState(false);
  const [profileId, setProfileId] = useState<HardwareProfileId>("linxup_at3_label");
  const [confidence, setConfidence] = useState(88);
  const [draftSystem, setDraftSystem] = useState<InstalledProductSystem | null>(null);
  const [manualReason, setManualReason] = useState<ManualFallbackReason>("label_unreadable");
  const [manualNotes, setManualNotes] = useState("");
  const [manualProductKey, setManualProductKey] = useState("linxup_asset_tracker");
  const [activeComponentId, setActiveComponentId] = useState<string | null>(null);

  const profileOptions = useMemo(
    () =>
      includeBlaxtairFixture
        ? PROFILE_OPTIONS
        : PROFILE_OPTIONS.filter((o) => !o.id.startsWith("blaxtair_")),
    [includeBlaxtairFixture],
  );

  const resolve = useMemo(
    () =>
      resolveDetectedHardwareToCompanyProduct({
        companyId,
        hardwareProfileId: profileId,
        confidence,
        includeBlaxtairAhdFixture: includeBlaxtairFixture,
      }),
    [companyId, profileId, confidence, includeBlaxtairFixture],
  );

  const orderedSystems = useMemo(() => sortSystemsDeterministically(systems), [systems]);

  function startScanSimulation() {
    setProcessing(true);
    window.setTimeout(() => {
      setProcessing(false);
      setStage("detect");
    }, 400);
  }

  function acceptMatch(productKey: string, overridden: boolean) {
    const def =
      resolve.status === "one"
        ? resolve.match.definition
        : resolve.status === "multiple" || resolve.status === "low_confidence"
          ? resolve.matches.find((m) => m.productKey === productKey)?.definition
          : undefined;
    const catalogDef =
      def ||
      PILOT_PRODUCT_DEVICE_DEFINITIONS.find((d) => d.productKey === productKey) ||
      PILOT_PRODUCT_DEVICE_DEFINITIONS[0]!;

    const isBlaxtair = catalogDef.productKey === "blaxtair_ahd";
    const identifiers = isBlaxtair
      ? {
          partNumber: "BX-CAM-DEMO",
          serialNumber: "CAM-SN-001",
          ipAddress: "192.168.1.50",
        }
      : catalogDef.hardwareProfileId === "linxup_linxcam_label"
        ? { macAddress: "AABBCCDDEEFF", serialNumber: "LC-SN-DEMO" }
        : {
            activationCode: "ACT-DEMO",
            serialNumber: "SN-DEMO-001",
            imei: "490154203237518",
          };

    const labelPhoto = {
      fieldName: "deviceLabel",
      localPreview: "simulated-label",
      originalFileName: "label-sim.jpg",
      uploadedAt: new Date().toISOString(),
    };

    const next = buildInstalledProductSystem({
      definition: catalogDef,
      detectedHardwareProfileId: profileId,
      detectionConfidence: confidence,
      extractionSource: "ocr",
      technicianConfirmed: false,
      detectionOverridden: overridden,
      identifiers,
      labelPhoto,
    });

    // Namespace label photo by system/component UUID
    const primary = next.components[0]!;
    next.components[0] = {
      ...primary,
      labelPhoto: {
        ...labelPhoto,
        systemId: next.id,
        componentId: primary.id,
        storagePath: photoNamespace({
          systemId: next.id,
          componentId: primary.id,
          fieldName: "deviceLabel",
        }),
      },
    };

    setDraftSystem(next);
    setActiveComponentId(primary.id);

    if (definitionRequiresInstallationVariant(catalogDef)) {
      setStage("variant");
    } else if (definitionIsMultiComponent(catalogDef)) {
      setStage("camera_count");
    } else {
      setStage("identifiers");
    }
  }

  function confirmDraftSystem() {
    if (!draftSystem) return;
    const confirmed: InstalledProductSystem = {
      ...draftSystem,
      technicianConfirmed: true,
      components: draftSystem.components.map((c) => ({
        ...c,
        technicianConfirmed: true,
        updatedAt: new Date().toISOString(),
      })),
      updatedAt: new Date().toISOString(),
    };
    onChange(upsertInstalledSystem(systems, confirmed));
    setDraftSystem(null);
    setActiveComponentId(null);
    setStage("idle");
  }

  function editPrimaryIdentifier(key: DeviceIdentifierKey, value: string) {
    if (!draftSystem) return;
    const primary = draftSystem.components[0];
    if (!primary) return;
    const { identifiers, edits } = applyIdentifierEdit({
      identifiers: primary.identifiers,
      key,
      nextRaw: value,
      edits: primary.identifierEdits,
    });
    setDraftSystem(
      updateComponentFields(draftSystem, primary.id, { identifiers, identifierEdits: edits }),
    );
  }

  function editComponentIdentifier(
    componentId: string,
    key: DeviceIdentifierKey,
    value: string,
  ) {
    if (!draftSystem) return;
    const comp = draftSystem.components.find((c) => c.id === componentId);
    if (!comp) return;
    const { identifiers, edits } = applyIdentifierEdit({
      identifiers: comp.identifiers,
      key,
      nextRaw: value,
      edits: comp.identifierEdits,
    });
    setDraftSystem(updateComponentFields(draftSystem, componentId, { identifiers, identifierEdits: edits }));
  }

  return (
    <section className="rounded-xl border border-emerald-700/50 bg-slate-900/60 p-4 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-emerald-200">Scan Device Label (pilot)</h3>
        <p className="text-sm text-slate-300 mt-1">
          OCR/barcode maps a hardware profile to this company&apos;s product. Live OCR is not
          integrated yet — detection is simulated. Manual product selection remains available.
        </p>
      </div>

      {orderedSystems.length > 0 ? (
        <ul className="space-y-3 text-sm text-slate-200">
          {orderedSystems.map((s) => (
            <li key={s.id} className="rounded-lg border border-slate-700 px-3 py-2 space-y-1">
              <div className="flex justify-between gap-2">
                <span className="font-medium">
                  {s.displayLabel || s.productKey}
                  {s.installationVariant ? ` · ${s.installationVariant}` : ""}
                </span>
                <button
                  type="button"
                  className="text-red-300 underline"
                  onClick={() => onChange(systems.filter((x) => x.id !== s.id))}
                >
                  Remove product
                </button>
              </div>
              <ul className="pl-3 text-slate-400 space-y-0.5">
                {s.components.map((c) => (
                  <li key={c.id}>
                    {c.componentLabel}
                    {c.identifiers.serialNumber ? ` · SN ${c.identifiers.serialNumber}` : ""}
                    {c.mountingLocation ? ` · ${c.mountingLocation}` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}

      {stage === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-white font-medium"
            onClick={startScanSimulation}
          >
            {systems.length > 0 ? "Add Another Product / System" : "Scan Device Label"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-500 px-4 py-2 text-slate-200"
            onClick={() => setStage("manual")}
          >
            Enter Manually
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-500 px-4 py-2 text-slate-200"
            onClick={onUseManualProductPicker}
          >
            Use classic product picker
          </button>
        </div>
      ) : null}

      {processing ? <p className="text-amber-200 text-sm">Processing label…</p> : null}

      {stage === "detect" ? (
        <div className="space-y-3 rounded-lg border border-slate-600 p-3">
          <p className="text-sm text-slate-300">
            Simulate detection (live OCR wires in later behind the same confirm UX).
          </p>
          <label className="block text-sm">
            Hardware profile
            <select
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
              value={profileId}
              onChange={(e) => setProfileId(e.target.value as HardwareProfileId)}
            >
              {profileOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Confidence ({confidence})
            <input
              type="range"
              min={10}
              max={99}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <p className="text-sm">
            Resolver: <strong>{resolve.status}</strong>
            {resolve.status === "one" ? ` → ${resolve.match.displayLabel}` : null}
            {resolve.status === "multiple" ? ` → ${resolve.matches.length} choices` : null}
            {resolve.status === "low_confidence" ? " — choose manually / retake" : null}
            {resolve.status === "none" ? " — no company product" : null}
          </p>
          <div className="flex flex-wrap gap-2">
            {resolve.status === "one" ? (
              <button
                type="button"
                className="rounded-lg bg-emerald-600 px-3 py-2 text-white"
                onClick={() => acceptMatch(resolve.match.productKey, false)}
              >
                Confirm {resolve.match.displayLabel}
              </button>
            ) : null}
            {resolve.status === "multiple" || resolve.status === "low_confidence"
              ? resolve.matches.map((m) => (
                  <button
                    key={m.productKey}
                    type="button"
                    className="rounded-lg border border-emerald-500 px-3 py-2 text-emerald-100"
                    onClick={() => acceptMatch(m.productKey, true)}
                  >
                    Choose {m.displayLabel}
                  </button>
                ))
              : null}
            <button type="button" className="underline text-slate-300" onClick={() => setStage("manual")}>
              Enter Manually
            </button>
            <button type="button" className="underline text-slate-300" onClick={() => setStage("idle")}>
              Retake
            </button>
          </div>
        </div>
      ) : null}

      {stage === "variant" && draftSystem ? (
        <div className="space-y-2">
          <p className="text-sm">Installation variant (required for Vehicle Tracker)</p>
          {(["obd_ii", "jbus"] as InstallationVariantId[]).map((v) => (
            <button
              key={v}
              type="button"
              className="mr-2 rounded-lg border border-slate-500 px-3 py-2"
              onClick={() => {
                setDraftSystem({ ...draftSystem, installationVariant: v });
                setStage("identifiers");
              }}
            >
              {v === "obd_ii" ? "OBD-II" : "JBUS"}
            </button>
          ))}
        </div>
      ) : null}

      {stage === "camera_count" && draftSystem ? (
        <div className="space-y-3">
          <p className="text-sm">How many cameras are being installed? ({BLAXTAIR_AHD_CAMERA_MIN}–{BLAXTAIR_AHD_CAMERA_MAX})</p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: BLAXTAIR_AHD_CAMERA_MAX }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className="rounded-lg border border-emerald-500 px-3 py-2"
                onClick={() => {
                  const next = applyBlaxtairCameraCount({ system: draftSystem, cameraCount: n });
                  setDraftSystem(next);
                  setActiveComponentId(next.components.find((c) => c.slotKey === "camera_1")?.id || null);
                  setStage("components");
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {stage === "identifiers" && draftSystem ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            Edit identifiers if needed. Serial characters are never auto-corrected.
          </p>
          {(Object.keys(draftSystem.components[0]?.identifiers || {}) as DeviceIdentifierKey[]).map(
            (key) => (
              <label key={key} className="block text-sm">
                {key}
                <input
                  className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
                  value={draftSystem.components[0]?.identifiers[key] ?? ""}
                  onChange={(e) => editPrimaryIdentifier(key, e.target.value)}
                />
              </label>
            ),
          )}
          {draftSystem.installGuide?.openUrl ? (
            <a
              className="inline-block text-emerald-300 underline"
              href={draftSystem.installGuide.openUrl}
              target="_blank"
              rel="noreferrer"
            >
              View Installation Guide
            </a>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-white"
              onClick={confirmDraftSystem}
            >
              Accept product
            </button>
            <button type="button" className="underline text-slate-300" onClick={() => setStage("idle")}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {stage === "components" && draftSystem ? (
        <BlaxtairComponentsEditor
          system={draftSystem}
          activeComponentId={activeComponentId}
          onSelectComponent={setActiveComponentId}
          onChangeSystem={setDraftSystem}
          onEditIdentifier={editComponentIdentifier}
          onConfirm={confirmDraftSystem}
          onCancel={() => {
            setDraftSystem(null);
            setStage("idle");
          }}
        />
      ) : null}

      {stage === "manual" ? (
        <div className="space-y-3 rounded-lg border border-slate-600 p-3">
          <p className="text-sm">Manual fallback — reason required</p>
          <select
            className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
            value={manualReason}
            onChange={(e) => setManualReason(e.target.value as ManualFallbackReason)}
          >
            {(Object.keys(MANUAL_FALLBACK_REASON_LABELS) as ManualFallbackReason[]).map((k) => (
              <option key={k} value={k}>
                {MANUAL_FALLBACK_REASON_LABELS[k]}
              </option>
            ))}
          </select>
          <input
            className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
            placeholder="Notes (optional)"
            value={manualNotes}
            onChange={(e) => setManualNotes(e.target.value)}
          />
          <select
            className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
            value={manualProductKey}
            onChange={(e) => setManualProductKey(e.target.value)}
          >
            {PILOT_PRODUCT_DEVICE_DEFINITIONS.map((d) => (
              <option key={d.productKey} value={d.productKey}>
                {d.displayLabel}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-white"
            onClick={() => {
              const def =
                PILOT_PRODUCT_DEVICE_DEFINITIONS.find((d) => d.productKey === manualProductKey) ||
                PILOT_PRODUCT_DEVICE_DEFINITIONS[0]!;
              const next = buildInstalledProductSystem({
                definition: def,
                extractionSource: "manual",
                detectionConfidence: null,
                detectedHardwareProfileId: null,
                manualFallbackReason: manualReason,
                manualFallbackNotes: manualNotes,
                technicianConfirmed: false,
                detectionOverridden: true,
              });
              setDraftSystem(next);
              setActiveComponentId(next.components[0]?.id || null);
              setStage(
                definitionRequiresInstallationVariant(def)
                  ? "variant"
                  : definitionIsMultiComponent(def)
                    ? "camera_count"
                    : "identifiers",
              );
            }}
          >
            Continue
          </button>
        </div>
      ) : null}
    </section>
  );
}

function BlaxtairComponentsEditor(props: {
  system: InstalledProductSystem;
  activeComponentId: string | null;
  onSelectComponent: (id: string) => void;
  onChangeSystem: (s: InstalledProductSystem) => void;
  onEditIdentifier: (componentId: string, key: DeviceIdentifierKey, value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const active =
    props.system.components.find((c) => c.id === props.activeComponentId) ||
    props.system.components[0];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-300">
        Add camera/component details inside this Blaxtair AHD product. Use &quot;Add Another Product /
        System&quot; later for a different company product.
      </p>
      <div className="flex flex-wrap gap-2">
        {props.system.components.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`rounded-lg border px-3 py-1 text-sm ${
              active?.id === c.id ? "border-emerald-400 text-emerald-100" : "border-slate-600"
            }`}
            onClick={() => props.onSelectComponent(c.id)}
          >
            {c.componentLabel}
          </button>
        ))}
      </div>

      {active ? (
        <ComponentFields
          component={active}
          onPatch={(patch) =>
            props.onChangeSystem(updateComponentFields(props.system, active.id, patch))
          }
          onEditIdentifier={(key, value) => props.onEditIdentifier(active.id, key, value)}
        />
      ) : null}

      <div className="rounded-lg border border-slate-700 p-3 text-sm space-y-1">
        <p className="font-medium text-emerald-200">System summary</p>
        {formatBlaxtairSystemSummary(props.system).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-white"
          onClick={props.onConfirm}
        >
          Accept product
        </button>
        <button type="button" className="underline text-slate-300" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ComponentFields(props: {
  component: InstalledProductComponent;
  onPatch: (patch: Partial<InstalledProductComponent>) => void;
  onEditIdentifier: (key: DeviceIdentifierKey, value: string) => void;
}) {
  const keys = Object.keys(props.component.identifiers) as DeviceIdentifierKey[];
  const idKeys =
    keys.length > 0
      ? keys
      : props.component.componentType === "camera"
        ? (["partNumber", "serialNumber", "ipAddress"] as DeviceIdentifierKey[])
        : (["serialNumber", "partNumber"] as DeviceIdentifierKey[]);

  return (
    <div className="space-y-3 rounded-lg border border-slate-600 p-3">
      <p className="text-sm font-medium">{props.component.componentLabel}</p>
      {idKeys.map((key) => (
        <label key={key} className="block text-sm">
          {key}
          <input
            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
            value={props.component.identifiers[key] ?? ""}
            onChange={(e) => props.onEditIdentifier(key, e.target.value)}
          />
        </label>
      ))}
      {props.component.componentType === "camera" || props.component.componentType === "monitor" ? (
        <>
          <label className="block text-sm">
            Mounting location
            <select
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
              value={props.component.mountingLocation ?? ""}
              onChange={(e) =>
                props.onPatch({
                  mountingLocation: (e.target.value || null) as MountingLocationId | null,
                })
              }
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
        </>
      ) : null}
      {props.component.componentType === "camera" ? (
        <>
          <label className="block text-sm">
            View direction
            <select
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
              value={props.component.viewDirection ?? ""}
              onChange={(e) =>
                props.onPatch({
                  viewDirection: (e.target.value || null) as ViewDirectionId | null,
                })
              }
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
      <p className="text-xs text-slate-400">
        Label photo namespace:{" "}
        {props.component.labelPhoto?.storagePath ||
          photoNamespace({
            systemId: props.component.labelPhoto?.systemId || "system",
            componentId: props.component.id,
            fieldName: "label",
          })}
      </p>
    </div>
  );
}
