"use client";

import { MOUNTING_LOCATION_LABELS, VIEW_DIRECTION_LABELS, type MountingLocationId, type ViewDirectionId } from "@/lib/product-devices";
import { computeJobCardValidation, type BlaxtairDemoJobCard, type JobCardStage } from "@/lib/prototype/blaxtair-job-card";
import type { ValidationMode } from "@/lib/prototype/blaxtair-validation-mode";

const STAGE_LABELS: Record<JobCardStage, string> = {
  job_site: "Job / Site",
  vehicle: "Vehicle",
  equipment: "Equipment",
  connections: "Connections",
  photos: "Photos",
  notes: "Notes",
  review: "Review",
};

function SectionHeader(props: { title: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <p className="font-medium text-emerald-200">{props.title}</p>
      <button type="button" className="text-xs text-slate-300 underline" onClick={props.onEdit}>
        Edit
      </button>
    </div>
  );
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

export function ReviewSection(props: {
  jobCard: BlaxtairDemoJobCard;
  validationMode: ValidationMode;
  onJumpTo: (stage: JobCardStage) => void;
}) {
  const { jobCard, validationMode } = props;
  const { required, optional } = computeJobCardValidation(jobCard);
  const strict = validationMode === "technician_strict";
  const js = jobCard.jobSite;
  const v = jobCard.vehicle;
  const inst = jobCard.installation;

  return (
    <section className="space-y-5">
      <h2 className="text-lg font-medium text-emerald-200">Review</h2>

      {jobCard.revision.revisionNumber > 1 ? (
        <p className="rounded-lg border border-amber-600 bg-amber-950/40 p-3 text-sm text-amber-100">
          Revision {jobCard.revision.revisionNumber} of a corrected job card — supersedes submission{" "}
          {jobCard.revision.supersedes}. Reason: {jobCard.revision.reason || "(not given)"}
        </p>
      ) : null}

      {required.length ? (
        <div
          className={`space-y-2 rounded-lg border p-3 text-sm ${
            strict ? "border-red-700/60 bg-red-950/30 text-red-200" : "border-amber-600 bg-amber-950/40 text-amber-100"
          }`}
        >
          <p className="font-medium">
            {strict
              ? "Blocking errors — Complete Demo Submission is disabled until these are resolved (Technician / strict validation):"
              : "Non-blocking warnings — required for a real installation, but QA / relaxed validation allows completing anyway:"}
          </p>
          <ul className="space-y-1">
            {required.map((issue, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="list-disc">• {issue.message}</span>
                <button
                  type="button"
                  className="shrink-0 whitespace-nowrap text-xs underline underline-offset-2"
                  onClick={() => props.onJumpTo(issue.stage)}
                >
                  Go to {STAGE_LABELS[issue.stage]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          Nothing outstanding — all required sections and photos look complete.
        </p>
      )}

      {optional.length ? (
        <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-400">
          <p className="font-medium text-slate-300">Optional missing information — never blocks completion:</p>
          <ul className="list-disc space-y-1 pl-5">
            {optional.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
        <SectionHeader title="Job, Customer &amp; Site" onEdit={() => props.onJumpTo("job_site")} />
        <p>
          {js.company || "—"} · {js.project || "—"} · {js.customer || "—"}
        </p>
        <p>
          {js.siteName || "—"} — {js.siteAddress || "—"}
        </p>
        <p>
          {js.siteContactName || "—"} · {js.siteContactPhone || "—"} · {js.siteContactEmail || "—"}
        </p>
        <p>
          Technician: {js.technician || "—"} · Installed: {js.installationDate || "—"}
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
        <SectionHeader title="Vehicle / Asset" onEdit={() => props.onJumpTo("vehicle")} />
        <p>
          {v.unitNumber || "—"} · VIN {v.vin || "—"} · {v.year} {v.make} {v.model}
        </p>
        <p>
          Plate {v.licensePlate || "—"} · Odometer/Hours {v.odometerOrHours || "—"} · Type {v.assetType || "—"}
        </p>
        {v.notes ? <p className="text-slate-400">{v.notes}</p> : null}
      </div>

      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
        <SectionHeader title="Equipment" onEdit={() => props.onJumpTo("equipment")} />
        {jobCard.equipment ? (
          <ul className="space-y-1">
            {jobCard.equipment.components
              .slice()
              .sort((a, b) => (a.slotKey < b.slotKey ? -1 : 1))
              .map((c) => (
                <li key={c.id}>
                  {c.technicianConfirmed ? "✓ " : "— "}
                  {c.componentLabel} · PN {c.identifiers.partNumber || "—"} · SN {c.identifiers.serialNumber || "—"} ·{" "}
                  {locationLabel(c.mountingLocation, c.mountingLocationOther)} / {viewLabel(c.viewDirection, c.viewDirectionOther)}
                  {c.installDetails?.reinstalledFromPreviousForm ? " · Reinstalled from a prior installation" : ""}
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-slate-400">No equipment added yet.</p>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
        <SectionHeader title="Connections &amp; Installation Details" onEdit={() => props.onJumpTo("connections")} />
        <p>Power: {inst.power.applicable ? `${inst.power.point || "—"} — ${inst.power.description || "—"}` : "Not applicable"}</p>
        <p>Ground: {inst.ground.applicable ? `${inst.ground.point || "—"} — ${inst.ground.description || "—"}` : "Not applicable"}</p>
        <p>Ignition: {inst.ignition.applicable ? `${inst.ignition.point || "—"} — ${inst.ignition.description || "—"}` : "Not applicable"}</p>
        <p>Device mounting: {inst.deviceMountingLocation || "—"}</p>
        <p>Cable routing: {inst.cableRouting || "—"}</p>
        {inst.cameraMountingNotes ? <p>Camera notes: {inst.cameraMountingNotes}</p> : null}
        {inst.generalNotes ? <p>General notes: {inst.generalNotes}</p> : null}
      </div>

      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
        <SectionHeader title="Photos" onEdit={() => props.onJumpTo("photos")} />
        {jobCard.photos.length === 0 ? (
          <p className="text-slate-400">No photos added yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {jobCard.photos.map((p) => (
              <div key={p.id} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.localPreview} alt={p.label} className="h-24 w-full rounded border border-slate-700 object-cover" />
                <p className="text-xs text-slate-400">{p.label}</p>
                {p.description ? <p className="text-xs text-slate-500">{p.description}</p> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
        <SectionHeader title="Technician Notes" onEdit={() => props.onJumpTo("notes")} />
        <p className="text-slate-300">{jobCard.technicianNotes || "—"}</p>
      </div>

      <p className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3 text-sm text-emerald-200">
        This is a local demo — nothing is submitted or uploaded. Your data stays in this browser (localStorage).
      </p>
    </section>
  );
}
