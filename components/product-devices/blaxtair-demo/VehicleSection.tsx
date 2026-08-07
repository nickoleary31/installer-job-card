"use client";

import type { BlaxtairVehicleInfo } from "@/lib/prototype/blaxtair-job-card";

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block text-sm">
      {props.label}
      <input
        className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

export function VehicleSection(props: { value: BlaxtairVehicleInfo; onChange: (field: keyof BlaxtairVehicleInfo, value: string) => void }) {
  const v = props.value;
  const set = (field: keyof BlaxtairVehicleInfo) => (value: string) => props.onChange(field, value);
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium text-emerald-200">Vehicle / Asset</h2>
      <Field label="Unit / asset number" value={v.unitNumber} onChange={set("unitNumber")} />
      <Field label="VIN / asset identifier" value={v.vin} onChange={set("vin")} />
      <div className="grid grid-cols-3 gap-2">
        <Field label="Year" value={v.year} onChange={set("year")} />
        <Field label="Make" value={v.make} onChange={set("make")} />
        <Field label="Model" value={v.model} onChange={set("model")} />
      </div>
      <Field label="License plate (if applicable)" value={v.licensePlate} onChange={set("licensePlate")} />
      <Field label="Odometer or engine hours (if applicable)" value={v.odometerOrHours} onChange={set("odometerOrHours")} />
      <Field label="Vehicle / asset type" value={v.assetType} onChange={set("assetType")} placeholder="e.g. Box truck, Trailer, Yard mule" />
      <label className="block text-sm">
        Vehicle / asset notes
        <textarea
          className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          rows={3}
          value={v.notes}
          onChange={(e) => set("notes")(e.target.value)}
        />
      </label>
    </section>
  );
}
