"use client";

import type { BlaxtairInstallationDetails, ConnectionDetail } from "@/lib/prototype/blaxtair-job-card";

function ConnectionFields(props: {
  label: string;
  value: ConnectionDetail;
  onChange: (patch: Partial<ConnectionDetail>) => void;
}) {
  const { value } = props;
  return (
    <div className="space-y-2 rounded-lg border border-slate-700 p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">{props.label}</p>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={!value.applicable}
            onChange={(e) => props.onChange({ applicable: !e.target.checked })}
          />
          Not applicable
        </label>
      </div>
      {value.applicable ? (
        <>
          <label className="block text-sm">
            Connection point
            <input
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
              value={value.point}
              onChange={(e) => props.onChange({ point: e.target.value })}
              placeholder="e.g. Fuse box position 12"
            />
          </label>
          <label className="block text-sm">
            Description
            <textarea
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
              rows={2}
              value={value.description}
              onChange={(e) => props.onChange({ description: e.target.value })}
            />
          </label>
        </>
      ) : (
        <p className="text-xs text-slate-500">Marked not applicable for this installation.</p>
      )}
    </div>
  );
}

export function ConnectionDetailsSection(props: {
  value: BlaxtairInstallationDetails;
  onChangeConnection: (connection: "power" | "ground" | "ignition", patch: Partial<ConnectionDetail>) => void;
  onChangeField: (field: Exclude<keyof BlaxtairInstallationDetails, "power" | "ground" | "ignition">, value: string) => void;
}) {
  const v = props.value;
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium text-emerald-200">Connections &amp; Installation Details</h2>
      <ConnectionFields label="Power connection" value={v.power} onChange={(patch) => props.onChangeConnection("power", patch)} />
      <ConnectionFields label="Ground connection" value={v.ground} onChange={(patch) => props.onChangeConnection("ground", patch)} />
      <ConnectionFields label="Ignition connection" value={v.ignition} onChange={(patch) => props.onChangeConnection("ignition", patch)} />
      <label className="block text-sm">
        Device mounting location
        <input
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          value={v.deviceMountingLocation}
          onChange={(e) => props.onChangeField("deviceMountingLocation", e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Cable-routing description
        <textarea
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          rows={2}
          value={v.cableRouting}
          onChange={(e) => props.onChangeField("cableRouting", e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Camera mounting / viewing-position details
        <textarea
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          rows={2}
          value={v.cameraMountingNotes}
          onChange={(e) => props.onChangeField("cameraMountingNotes", e.target.value)}
          placeholder="Additional detail beyond what's captured per-camera in Equipment"
        />
      </label>
      <label className="block text-sm">
        General installation notes
        <textarea
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          rows={3}
          value={v.generalNotes}
          onChange={(e) => props.onChangeField("generalNotes", e.target.value)}
        />
      </label>
    </section>
  );
}
