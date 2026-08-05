"use client";

import { useState } from "react";
import type { BlaxtairDemoJobCard } from "@/lib/prototype/blaxtair-job-card";

export function CompletedSubmissionsSection(props: {
  submissions: BlaxtairDemoJobCard[];
  isSuperseded: (card: BlaxtairDemoJobCard) => boolean;
  onStartCorrectedRevision: (original: BlaxtairDemoJobCard, args: { reason: string; revisedBy: string }) => void;
  onClose: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [revisingId, setRevisingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [revisedBy, setRevisedBy] = useState("");

  const sorted = props.submissions
    .slice()
    .sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""))
    .reverse();
  const open = sorted.find((s) => s.id === openId) ?? null;

  if (open) {
    const superseded = props.isSuperseded(open);
    return (
      <section className="space-y-4">
        <button type="button" className="text-sm text-slate-300 underline" onClick={() => setOpenId(null)}>
          ← Back to list
        </button>
        <h2 className="text-lg font-medium text-emerald-200">
          {open.jobSite.customer || "(no customer)"} — {open.jobSite.siteName || "(no site)"}
        </h2>
        <p className="text-sm text-slate-400">
          Submission {open.id} · Revision {open.revision.revisionNumber} ·{" "}
          {superseded ? <span className="text-amber-300">Superseded</span> : <span className="text-emerald-300">Current</span>} · Completed{" "}
          {open.completedAt ? new Date(open.completedAt).toLocaleString() : "—"}
        </p>
        {open.revision.reason ? <p className="text-sm text-slate-300">Correction reason: {open.revision.reason}</p> : null}

        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
          <p className="font-medium text-emerald-200">Job / Site</p>
          <p>
            {open.jobSite.company} · {open.jobSite.project}
          </p>
          <p>
            {open.jobSite.siteAddress} · Technician {open.jobSite.technician} · {open.jobSite.installationDate}
          </p>
        </div>
        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
          <p className="font-medium text-emerald-200">Vehicle</p>
          <p>
            {open.vehicle.unitNumber} · VIN {open.vehicle.vin} · {open.vehicle.year} {open.vehicle.make} {open.vehicle.model}
          </p>
        </div>
        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
          <p className="font-medium text-emerald-200">Equipment</p>
          {(open.equipment?.components ?? []).map((c) => (
            <p key={c.id}>
              {c.componentLabel} · PN {c.identifiers.partNumber || "—"} · SN {c.identifiers.serialNumber || "—"}
            </p>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
          <p className="font-medium text-emerald-200">Photos ({open.photos.length})</p>
          <div className="grid grid-cols-3 gap-2">
            {open.photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={p.localPreview} alt={p.label} className="h-20 w-full rounded border border-slate-700 object-cover" />
            ))}
          </div>
        </div>

        {revisingId === open.id ? (
          <div className="space-y-2 rounded-lg border border-amber-600 bg-amber-950/40 p-3 text-sm">
            <label className="block">
              Reason for correction
              <input
                className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label className="block">
              Revised by
              <input
                className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2"
                value={revisedBy}
                onChange={(e) => setRevisedBy(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-emerald-600 px-3 py-2 text-white disabled:opacity-40"
                disabled={!reason.trim() || !revisedBy.trim()}
                onClick={() => {
                  props.onStartCorrectedRevision(open, { reason, revisedBy });
                  setRevisingId(null);
                }}
              >
                Start Revision
              </button>
              <button type="button" className="rounded-lg border border-slate-500 px-3 py-2" onClick={() => setRevisingId(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="rounded-lg bg-emerald-600 px-4 py-2 text-white" onClick={() => setRevisingId(open.id)}>
            Create Corrected Revision
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-emerald-200">Completed Demo Submissions</h2>
        <button type="button" className="text-sm text-slate-300 underline" onClick={props.onClose}>
          Back to current job
        </button>
      </div>
      <p className="text-xs text-slate-500">Local-only records on this device — nothing here was transmitted anywhere.</p>
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400">No completed demo submissions yet.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((s) => (
            <li key={s.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
              <button type="button" className="text-left w-full" onClick={() => setOpenId(s.id)}>
                <p className="font-medium text-emerald-200">
                  {s.jobSite.customer || "(no customer)"} — {s.jobSite.siteName || "(no site)"}
                </p>
                <p className="text-slate-400">
                  Revision {s.revision.revisionNumber} ·{" "}
                  {props.isSuperseded(s) ? <span className="text-amber-300">Superseded</span> : <span className="text-emerald-300">Current</span>} ·{" "}
                  {s.completedAt ? new Date(s.completedAt).toLocaleString() : "—"}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
