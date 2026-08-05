"use client";

import type { BlaxtairJobSiteInfo } from "@/lib/prototype/blaxtair-job-card";

/** Demo-only sample values — never queries or writes real customer/company data. */
const SAMPLE_COMPANIES = ["Acme Fleet Services (demo)", "Northgate Logistics (demo)"];
const SAMPLE_PROJECTS = ["2026 Camera Rollout (demo)", "Yard Safety Upgrade (demo)"];
const SAMPLE_CUSTOMERS = ["Riverbend Trucking (demo)", "Coastal Freight Co. (demo)"];

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block text-sm">
      {props.label}
      <input
        type={props.type ?? "text"}
        className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function SampleSelect(props: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block text-sm">
      {props.label}
      <div className="mt-1 flex gap-2">
        <input
          className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="Type or pick a sample value"
        />
        <select
          className="rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm"
          value=""
          onChange={(e) => {
            if (e.target.value) props.onChange(e.target.value);
          }}
        >
          <option value="">Sample…</option>
          {props.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

export function JobSiteSection(props: { value: BlaxtairJobSiteInfo; onChange: (field: keyof BlaxtairJobSiteInfo, value: string) => void }) {
  const v = props.value;
  const set = (field: keyof BlaxtairJobSiteInfo) => (value: string) => props.onChange(field, value);
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium text-emerald-200">Job, Project, Customer &amp; Site</h2>
      <p className="text-xs text-slate-500">
        Demo values only — this never queries or writes real company/project/customer data.
      </p>
      <SampleSelect label="Company" value={v.company} onChange={set("company")} options={SAMPLE_COMPANIES} />
      <SampleSelect label="Project" value={v.project} onChange={set("project")} options={SAMPLE_PROJECTS} />
      <SampleSelect label="Customer" value={v.customer} onChange={set("customer")} options={SAMPLE_CUSTOMERS} />
      <Field label="Site name" value={v.siteName} onChange={set("siteName")} />
      <Field label="Site address" value={v.siteAddress} onChange={set("siteAddress")} />
      <Field label="Site contact name" value={v.siteContactName} onChange={set("siteContactName")} />
      <Field label="Site contact phone" value={v.siteContactPhone} onChange={set("siteContactPhone")} type="tel" />
      <Field label="Site contact email" value={v.siteContactEmail} onChange={set("siteContactEmail")} type="email" />
      <Field label="Technician" value={v.technician} onChange={set("technician")} placeholder="Your name (demo — not real auth)" />
      <Field label="Installation date" value={v.installationDate} onChange={set("installationDate")} type="date" />
    </section>
  );
}
