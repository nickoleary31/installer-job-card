"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type SubmissionRow = {
  submission_id: string;
  customer: string | null;
  unit_number: string | null;
  payload: unknown;
  created_at: string | null;
};

type SubmissionPayloadLite = {
  coreJobInfo?: {
    customer?: string;
    location?: string;
    workOrder?: string;
    serviceAppointment?: string;
    unitNumber?: string;
    installerName?: string;
    equipmentMake?: string;
    equipmentModel?: string;
    equipmentSerial?: string;
  };
  hardwareSelection?: {
    primary?: string;
    hasAdditional?: string;
    additional?: string[];
  };
  vac4?: {
    vehicleType?: string;
    driveType?: string;
    vehicleVoltage?: string;
    clientApproval?: string;
    hourMeter?: string;
    sensorHubInstalled?: string;
    liftSenseInstalled?: string;
    operatorPresenceInstalled?: string;
    speedSenseInstalled?: string;
    loadSenseInstalled?: string;
    gpsInstalled?: string;
    externalIndicatorInstalled?: string;
    photoCounts?: Record<string, number>;
  };
  photoUploads?: Array<{
    group?: "vac4" | "vehicle";
    fieldName?: string;
  }>;
};

type SubmissionListItem = {
  submissionId: string;
  customer: string;
  location: string;
  unitNumber: string;
  primaryHardware: string;
  additionalHardware: string[];
  createdAt: string;
  payload: SubmissionPayloadLite;
};

function mapRow(row: SubmissionRow): SubmissionListItem {
  const payload = (row.payload as SubmissionPayloadLite | null) || {};
  const primary = payload?.hardwareSelection?.primary?.trim() || "—";
  const additionalHardware = Array.isArray(payload?.hardwareSelection?.additional)
    ? payload.hardwareSelection.additional.map((item) => item.trim()).filter(Boolean)
    : [];
  return {
    submissionId: row.submission_id,
    customer: row.customer?.trim() || "—",
    location: payload?.coreJobInfo?.location?.trim() || "—",
    unitNumber: row.unit_number?.trim() || "—",
    primaryHardware: primary,
    additionalHardware,
    createdAt: row.created_at || "",
    payload,
  };
}

export default function SubmittedPage() {
  const [items, setItems] = useState<SubmissionListItem[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [expandedSubmissionIds, setExpandedSubmissionIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("job_card_submissions")
          .select("submission_id, customer, unit_number, payload, created_at")
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (cancelled || !data) return;
        setItems((data as SubmissionRow[]).map(mapRow));
        setLoadError(false);
      } catch {
        if (!cancelled) {
          setItems([]);
          setLoadError(true);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        const ta = Date.parse(a.createdAt);
        const tb = Date.parse(b.createdAt);
        return Number.isNaN(tb) || Number.isNaN(ta) ? 0 : tb - ta;
      }),
    [items],
  );

  const toggleExpanded = (submissionId: string) => {
    setExpandedSubmissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(submissionId)) next.delete(submissionId);
      else next.add(submissionId);
      return next;
    });
  };

  const photoCountFromUploads = (payload: SubmissionPayloadLite, group: "vac4" | "vehicle", fieldName: string) => {
    return (payload.photoUploads || []).filter((p) => p.group === group && p.fieldName === fieldName).length;
  };

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Submitted Job Cards</h1>
          <p className="mt-1 text-sm text-gray-600">View completed submissions</p>
          <Link
            href="/"
            className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
          >
            Back to Home
          </Link>
        </header>

        {loadError ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 text-sm text-amber-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            Could not load submissions. Check your connection and Supabase configuration.
          </section>
        ) : null}

        {sorted.length === 0 && !loadError ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            No submitted job cards yet
          </section>
        ) : null}

        {sorted.map((row) => (
          <section
            key={row.submissionId}
            className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
          >
            <div className="grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
              <p>
                <span className="font-semibold text-gray-600">Customer:</span> {row.customer}
              </p>
              <p>
                <span className="font-semibold text-gray-600">Unit #:</span> {row.unitNumber}
              </p>
              <p>
                <span className="font-semibold text-gray-600">Location:</span> {row.location}
              </p>
              <p>
                <span className="font-semibold text-gray-600">Primary hardware:</span> {row.primaryHardware}
              </p>
              {row.additionalHardware.length > 0 ? (
                <p className="sm:col-start-2">
                  <span className="font-semibold text-gray-600">Additional hardware:</span>{" "}
                  {row.additionalHardware.join(", ")}
                </p>
              ) : null}
              <p className="sm:col-span-2">
                <span className="font-semibold text-gray-600">Submitted:</span>{" "}
                {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
              </p>
              <p className="sm:col-span-2 text-xs text-gray-500">
                <span className="font-semibold text-gray-600">Submission ID:</span> {row.submissionId}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                onClick={() => toggleExpanded(row.submissionId)}
              >
                {expandedSubmissionIds.has(row.submissionId) ? "Hide Details" : "View Details"}
              </button>
              <Link
                href={`/photos/${encodeURIComponent(row.submissionId)}`}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                View Photos
              </Link>
            </div>

            {expandedSubmissionIds.has(row.submissionId) ? (
              <div className="mt-4 space-y-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                <section>
                  <h3 className="text-sm font-bold text-gray-900">Core Job Info</h3>
                  <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Customer:</span> {row.payload.coreJobInfo?.customer || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Location:</span> {row.payload.coreJobInfo?.location || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Work Order #:</span> {row.payload.coreJobInfo?.workOrder || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Service Appointment #:</span> {row.payload.coreJobInfo?.serviceAppointment || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Installer:</span> {row.payload.coreJobInfo?.installerName || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Unit #:</span> {row.payload.coreJobInfo?.unitNumber || "—"}</p>
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold text-gray-900">Vehicle Information</h3>
                  <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Make:</span> {row.payload.coreJobInfo?.equipmentMake || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Model:</span> {row.payload.coreJobInfo?.equipmentModel || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Serial #:</span> {row.payload.coreJobInfo?.equipmentSerial || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Drive Type:</span> {row.payload.vac4?.driveType || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Vehicle Type:</span> {row.payload.vac4?.vehicleType || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Voltage:</span> {row.payload.vac4?.vehicleVoltage || "—"}</p>
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold text-gray-900">Hardware Selection</h3>
                  <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Primary:</span> {row.payload.hardwareSelection?.primary || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Additional selected?:</span> {row.payload.hardwareSelection?.hasAdditional || "—"}</p>
                    <p className="sm:col-span-2">
                      <span className="font-semibold text-gray-600">Additional hardware:</span>{" "}
                      {Array.isArray(row.payload.hardwareSelection?.additional) &&
                      row.payload.hardwareSelection.additional.length > 0
                        ? row.payload.hardwareSelection.additional.join(", ")
                        : "—"}
                    </p>
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold text-gray-900">VAC4 Summary</h3>
                  <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Client Approval:</span> {row.payload.vac4?.clientApproval || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Hour Meter:</span> {row.payload.vac4?.hourMeter || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Sensor Hub Installed:</span> {row.payload.vac4?.sensorHubInstalled || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Lift Sense Installed:</span> {row.payload.vac4?.liftSenseInstalled || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Operator Presence Installed:</span> {row.payload.vac4?.operatorPresenceInstalled || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Speed Sense Installed:</span> {row.payload.vac4?.speedSenseInstalled || "—"}</p>
                    <p><span className="font-semibold text-gray-600">Load Sense Installed:</span> {row.payload.vac4?.loadSenseInstalled || "—"}</p>
                    <p><span className="font-semibold text-gray-600">GPS Installed:</span> {row.payload.vac4?.gpsInstalled || "—"}</p>
                    <p><span className="font-semibold text-gray-600">External Indicator Installed:</span> {row.payload.vac4?.externalIndicatorInstalled || "—"}</p>
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold text-gray-900">Photo Counts</h3>
                  <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Vehicle Front:</span> {photoCountFromUploads(row.payload, "vehicle", "vehicleFront")}</p>
                    <p><span className="font-semibold text-gray-600">Vehicle Side:</span> {photoCountFromUploads(row.payload, "vehicle", "vehicleSide")}</p>
                    <p><span className="font-semibold text-gray-600">Vehicle Rear:</span> {photoCountFromUploads(row.payload, "vehicle", "vehicleRear")}</p>
                    <p><span className="font-semibold text-gray-600">VAC Mounting:</span> {row.payload.vac4?.photoCounts?.vacMounting ?? 0}</p>
                    <p><span className="font-semibold text-gray-600">Wire Path:</span> {row.payload.vac4?.photoCounts?.wirePath ?? 0}</p>
                    <p><span className="font-semibold text-gray-600">Red Wire:</span> {row.payload.vac4?.photoCounts?.redWire ?? 0}</p>
                    <p><span className="font-semibold text-gray-600">Black Wire:</span> {row.payload.vac4?.photoCounts?.blackWire ?? 0}</p>
                    <p><span className="font-semibold text-gray-600">Blue Wire:</span> {row.payload.vac4?.photoCounts?.blueWire ?? 0}</p>
                    <p><span className="font-semibold text-gray-600">Brown Wire:</span> {row.payload.vac4?.photoCounts?.brownWire ?? 0}</p>
                    <p><span className="font-semibold text-gray-600">Sensor Hub:</span> {row.payload.vac4?.photoCounts?.sensorHubMounting ?? 0}</p>
                    <p><span className="font-semibold text-gray-600">Speed Sense:</span> {row.payload.vac4?.photoCounts?.speedSense ?? 0}</p>
                    <p><span className="font-semibold text-gray-600">Load Sense:</span> {row.payload.vac4?.photoCounts?.loadSense ?? 0}</p>
                    <p><span className="font-semibold text-gray-600">GPS:</span> {row.payload.vac4?.photoCounts?.gps ?? 0}</p>
                    <p><span className="font-semibold text-gray-600">External Indicator:</span> {row.payload.vac4?.photoCounts?.externalIndicator ?? 0}</p>
                  </div>
                </section>
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </main>
  );
}
