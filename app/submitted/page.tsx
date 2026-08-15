"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { supabase } from "@/lib/supabase/client";
import { EmailSendConfirmModal } from "@/components/EmailSendConfirmModal";
import { buildEmailViewModel } from "@/lib/email-view-model";
import type { EmailSendMode } from "@/lib/email-recipients";
import type { JobCardSubmissionPayload } from "@/lib/job-card-submission";
import { formatServiceAppointment, formatUpper, formatWorkOrder } from "@/lib/format";
import { getFormDefinitionById, getFormDefinitionBySectionKey, isLinxUpSectionKey } from "@/lib/form-registry";
import { normalizeInstalledProductSystems } from "@/lib/product-devices/normalize";
import { buildInstalledSystemEmailSections, type SimpleEmailSection } from "@/lib/product-devices/email-sections";
import { buildBlaxtairWireAndAlarmEmailSections } from "@/lib/product-devices/blaxtair-ahd-email";
import type { InstalledProductSystem } from "@/lib/product-devices/types";

const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";

type SubmissionRow = {
  submission_id: string;
  customer: string | null;
  unit_number: string | null;
  payload: unknown;
  created_at: string | null;
  internal_emailed_at?: string | null;
  client_emailed_at?: string | null;
  last_emailed_at?: string | null;
  last_email_mode?: string | null;
  last_email_recipients?: unknown;
  last_email_status?: string | null;
  last_email_resend_id?: string | null;
  last_email_error?: string | null;
};

type SubmissionPayloadLite = {
  formId?: string;
  submissionType?: string;
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
    primaryContact?: string;
    contactNumber?: string;
    contactEmail?: string;
  };
  hardwareSelection?: {
    primary?: string;
    hasAdditional?: string;
    additional?: string[];
  };
  linxup?: {
    formId?: string;
    submissionType?: string;
    productLabel?: string;
    customer?: string;
    location?: string;
    primaryContact?: string;
    contactNumber?: string;
    contactEmail?: string;
    year?: string;
    make?: string;
    model?: string;
    serialVin?: string;
    assetNumber?: string;
    vehicleType?: string;
    hoursMiles?: string;
    powerConnectionDescription?: string;
    groundConnectionDescription?: string;
    ignitionConnectionDescription?: string;
    vehicleTracker?: {
      obdPortConnected?: string;
      installationNotes?: string;
      powerConnectionDescription?: string;
      groundConnectionDescription?: string;
      ignitionConnectionDescription?: string;
    };
    linxCam?: {
      obdPortConnected?: string;
      installationNotes?: string;
      powerConnectionDescription?: string;
      groundConnectionDescription?: string;
      ignitionConnectionDescription?: string;
    };
  };
  selectedSections?: string[];
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
    redWireDescription?: string;
    blackWireDescription?: string;
    blueWireDescription?: string;
    purpleWireDescription?: string;
    brownWireDescription?: string;
    relayAccessDescription?: string;
    impactSensorDescription?: string;
    speedSenseDescription?: string;
    speedSensePulseCount?: string;
    loadSenseThresholds?: string;
    photoCounts?: Record<string, number>;
    blaxtairHoursMiles?: string;
  };
  photoUploads?: Array<{
    group?: "vac4" | "vehicle" | "ppd" | "cp4" | "linxup";
    fieldName?: string;
  }>;
  installedProductSystems?: InstalledProductSystem[];
  sscSpeed?: {
    connectionType?: "" | "CAN" | "Hardwire";
    powerDescription?: string;
    groundDescription?: string;
    ignitionDescription?: string;
    speedSignalDescription?: string;
    hasDirectionSignal?: boolean;
    directionDescription?: string;
  };
  productFiles?: Array<{ fileKey?: string; originalFileName?: string }>;
};

/** Any Blaxtair product (AHD/MR130-MR260/Origin/3/SSC Speed), primary or additional. */
function isBlaxtairFamilyPayload(payload: SubmissionPayloadLite): boolean {
  if (payload.selectedSections?.some((s) => s.startsWith("blaxtair_"))) return true;
  return !!payload.hardwareSelection?.primary?.startsWith("blaxtair_");
}

function isBlaxtairAhdPayload(payload: SubmissionPayloadLite): boolean {
  if (payload.selectedSections?.includes("blaxtair_ahd")) return true;
  if (payload.hardwareSelection?.primary === "blaxtair_ahd") return true;
  return Array.isArray(payload.installedProductSystems) && payload.installedProductSystems.length > 0;
}

function isSscSpeedPayload(payload: SubmissionPayloadLite): boolean {
  if (!payload.sscSpeed) return false;
  if (payload.selectedSections?.includes("blaxtair_ssc_speed")) return true;
  return (
    payload.hardwareSelection?.primary === "blaxtair_ssc_speed" ||
    !!payload.hardwareSelection?.additional?.includes("blaxtair_ssc_speed")
  );
}

function isLinxUpPayload(payload: SubmissionPayloadLite): boolean {
  if (payload.linxup) return true;
  if (payload.formId?.startsWith("linxup_") || payload.submissionType?.startsWith("linxup_")) return true;
  return isLinxUpSectionKey(payload.hardwareSelection?.primary);
}

function resolveProductLabel(payload: SubmissionPayloadLite): string {
  if (payload.linxup?.productLabel?.trim()) return payload.linxup.productLabel.trim();
  const def =
    getFormDefinitionById(payload.formId || payload.submissionType) ||
    getFormDefinitionBySectionKey(payload.hardwareSelection?.primary);
  return def?.label || payload.hardwareSelection?.primary?.trim() || "—";
}

type SubmissionListItem = {
  submissionId: string;
  customer: string;
  location: string;
  unitNumber: string;
  primaryHardware: string;
  additionalHardware: string[];
  createdAt: string;
  payload: SubmissionPayloadLite;
  emailHistory: {
    internalEmailedAt: string | null;
    clientEmailedAt: string | null;
    lastEmailedAt: string | null;
    lastEmailMode: string | null;
    lastEmailStatus: string | null;
    lastEmailResendId: string | null;
    lastEmailError: string | null;
    lastEmailRecipients: Array<{ email: string; label?: string; source?: string }>;
  };
};

type ResendState = "idle" | "sending" | "success" | "error";

function mapRow(row: SubmissionRow): SubmissionListItem {
  const payload = (row.payload as SubmissionPayloadLite | null) || {};
  const primary = isLinxUpPayload(payload)
    ? resolveProductLabel(payload)
    : payload?.hardwareSelection?.primary?.trim() || "—";
  const additionalHardware = Array.isArray(payload?.hardwareSelection?.additional)
    ? payload.hardwareSelection.additional
        .map((item) => item.trim())
        .filter(Boolean)
        .map((key) => getFormDefinitionBySectionKey(key)?.label || key)
    : [];
  return {
    submissionId: row.submission_id,
    customer: row.customer?.trim() || "—",
    location: payload?.coreJobInfo?.location?.trim() || payload?.linxup?.location?.trim() || "—",
    unitNumber: row.unit_number?.trim() || "—",
    primaryHardware: primary,
    additionalHardware,
    createdAt: row.created_at || "",
    payload,
    emailHistory: {
      internalEmailedAt: row.internal_emailed_at || null,
      clientEmailedAt: row.client_emailed_at || null,
      lastEmailedAt: row.last_emailed_at || null,
      lastEmailMode: row.last_email_mode || null,
      lastEmailStatus: row.last_email_status || null,
      lastEmailResendId: row.last_email_resend_id || null,
      lastEmailError: row.last_email_error || null,
      lastEmailRecipients: Array.isArray(row.last_email_recipients)
        ? (row.last_email_recipients as Array<{ email: string; label?: string; source?: string }>)
        : [],
    },
  };
}

function emailStatusLabel(row: SubmissionListItem): string {
  if (row.emailHistory.lastEmailStatus === "failed") return "Email failed";
  if (row.emailHistory.clientEmailedAt) return "Emailed to client + internal";
  if (row.emailHistory.internalEmailedAt || row.emailHistory.lastEmailMode === "internal_only") {
    return "Emailed internally only";
  }
  return "Submitted, not emailed";
}

function displayValue(value: string | undefined | null) {
  return value?.trim() ? value.trim() : "Not Installed";
}

function displayUppercase(value: string | undefined | null) {
  const upper = formatUpper(value);
  const shown = upper || "Not Installed";
  return shown === "Not Installed" ? shown : shown.toUpperCase();
}

function textOrDash(value: string | undefined) {
  return value?.trim() ? value.trim() : "—";
}

function renderDetailText(value: string) {
  if (value === "Not Installed") {
    return <span className="font-semibold text-red-600">Not Installed</span>;
  }
  return value;
}

function renderDetailValue(value: string | undefined | null) {
  return renderDetailText(displayValue(value));
}

/** Mirrors the SSC Speed field list built for the outbound email (lib/email-layout-model.ts). */
function buildSscSpeedSections(payload: SubmissionPayloadLite): SimpleEmailSection[] {
  const ssc = payload.sscSpeed;
  if (!ssc) return [];
  const fields: SimpleEmailSection["fields"] = [
    { label: "Connected via", value: textOrDash(ssc.connectionType) },
    { label: "Power connection", value: displayValue(ssc.powerDescription) },
    { label: "Ground connection", value: displayValue(ssc.groundDescription) },
    { label: "Ignition connection", value: displayValue(ssc.ignitionDescription) },
  ];
  if (ssc.connectionType === "Hardwire") {
    fields.push({ label: "Speed signal", value: displayValue(ssc.speedSignalDescription) });
    if (ssc.hasDirectionSignal) {
      fields.push({ label: "Direction signal", value: displayValue(ssc.directionDescription) });
    }
  }
  const configFile = payload.productFiles?.find((f) => f.fileKey === "ssc_config");
  if (configFile?.originalFileName) {
    fields.push({ label: "Configuration file", value: configFile.originalFileName });
  }
  return [{ id: "ssc-speed", title: "SSC Speed Install", fields }];
}

/** Read-only render of SimpleEmailSection[] — same shape used to build the actual sent email. */
function SimpleEmailSections({ sections }: { sections: SimpleEmailSection[] }) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.id}>
          <h3 className="text-sm font-bold text-gray-900">{section.title}</h3>
          <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
            {section.fields.map((field, i) => (
              <p key={`${section.id}-${i}`}>
                <span className="font-semibold text-gray-600">{field.label}:</span> {field.value}
              </p>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export default function SubmittedPage() {
  const router = useRouter();
  const { loading: authLoading, context: userContext } = useAuthUserContext();
  const [items, setItems] = useState<SubmissionListItem[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [expandedSubmissionIds, setExpandedSubmissionIds] = useState<Set<string>>(() => new Set());
  const [resendStateBySubmissionId, setResendStateBySubmissionId] = useState<Record<string, ResendState>>({});
  const [resendMessageBySubmissionId, setResendMessageBySubmissionId] = useState<Record<string, string>>({});
  const [resendModalRow, setResendModalRow] = useState<SubmissionListItem | null>(null);
  const [resendModalOpen, setResendModalOpen] = useState(false);
  const goToProjectDashboard = () => {
    if (typeof window !== "undefined") {
      const companyId = window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
      const projectId = window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
      if (companyId && projectId) {
        router.push(`/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}`);
        return;
      }
    }
    router.push("/home");
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (authLoading) return;
      if (!userContext.userId) {
        if (!cancelled) {
          setItems([]);
          setLoadError(false);
        }
        return;
      }
      try {
        const selectedCompanyId = (typeof window !== "undefined"
          ? window.localStorage.getItem(SELECTED_COMPANY_ID_KEY)
          : "")?.trim() || "";
        const selectedProjectId = (typeof window !== "undefined"
          ? window.localStorage.getItem(SELECTED_PROJECT_ID_KEY)
          : "")?.trim() || "";

        const baseSelect =
          "submission_id, customer, unit_number, payload, created_at";
        const emailHistorySelect =
          `${baseSelect}, internal_emailed_at, client_emailed_at, last_emailed_at, last_email_mode, last_email_recipients, last_email_status, last_email_resend_id, last_email_error`;

        // Prefer email-history columns when migration is applied; fall back if they are missing.
        let query = supabase
          .from("job_card_submissions")
          .select(emailHistorySelect)
          .order("created_at", { ascending: false });
        if (selectedCompanyId && selectedProjectId) {
          query = query.eq("company_id", selectedCompanyId).eq("project_id", selectedProjectId);
        }
        let data: SubmissionRow[] | null = null;
        let error: { message?: string; code?: string } | null = null;

        {
          const first = await query;
          data = (first.data as SubmissionRow[] | null) ?? null;
          error = first.error;
        }

        if (error) {
          const missingColumn =
            /column .* does not exist/i.test(error.message || "") || error.code === "42703";
          if (!missingColumn) throw error;

          let fallback = supabase
            .from("job_card_submissions")
            .select(baseSelect)
            .order("created_at", { ascending: false });
          if (selectedCompanyId && selectedProjectId) {
            fallback = fallback.eq("company_id", selectedCompanyId).eq("project_id", selectedProjectId);
          }
          const second = await fallback;
          if (second.error) throw second.error;
          data = (second.data as SubmissionRow[] | null) ?? null;
        }

        if (cancelled || !data) return;
        setItems(data.map(mapRow));
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
  }, [authLoading, userContext.userId]);

  useEffect(() => {
    if (authLoading) return;
    if (!userContext.userId) {
      router.replace("/login");
    }
  }, [authLoading, userContext.userId, router]);

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

  const photoCountFromUploads = (
    payload: SubmissionPayloadLite,
    group: "vac4" | "vehicle" | "ppd" | "cp4" | "linxup",
    fieldName: string,
  ) => {
    return (payload.photoUploads || []).filter((p) => p.group === group && p.fieldName === fieldName).length;
  };

  const setResendState = (submissionId: string, state: ResendState) => {
    setResendStateBySubmissionId((prev) => ({ ...prev, [submissionId]: state }));
  };

  const handleResendEmail = async (row: SubmissionListItem, sendMode: EmailSendMode) => {
    setResendMessageBySubmissionId((prev) => ({ ...prev, [row.submissionId]: "" }));
    setResendState(row.submissionId, "sending");
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: row.payload,
          sendMode,
          sentByUserId: userContext.userId || null,
        }),
      });
      let data: {
        error?: string;
        resendId?: string;
        photoAttachments?: {
          attachedCount?: number;
          warnings?: string[];
          failures?: Array<{ label: string; filename: string; reason: string }>;
          failureMessages?: string[];
        };
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        // ignore parse errors
      }
      if (!res.ok) {
        const failureLines =
          data.photoAttachments?.failureMessages?.length
            ? data.photoAttachments.failureMessages
            : (data.photoAttachments?.failures || []).map(
                (f) => `${f.label} (${f.filename}): ${f.reason}`,
              );
        const base =
          typeof data.error === "string" && data.error.trim()
            ? data.error.trim()
            : `Request failed (${res.status})`;
        const msg = failureLines.length > 0 ? `${base}\n${failureLines.join("\n")}` : base;
        setResendMessageBySubmissionId((prev) => ({ ...prev, [row.submissionId]: msg }));
        setResendState(row.submissionId, "error");
        return;
      }
      const attached = data.photoAttachments?.attachedCount;
      setResendMessageBySubmissionId((prev) => ({
        ...prev,
        [row.submissionId]:
          typeof attached === "number"
            ? `Email resent (${sendMode === "internal_only" ? "internal only" : "client + internal"}, ${attached} photos)`
            : "Email resent successfully",
      }));
      setResendState(row.submissionId, "success");
      setResendModalOpen(false);
      setResendModalRow(null);
    } catch {
      setResendMessageBySubmissionId((prev) => ({ ...prev, [row.submissionId]: "Failed to resend email" }));
      setResendState(row.submissionId, "error");
    }
  };

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-gray-600">Checking sign-in…</p>
      </main>
    );
  }

  if (!userContext.userId) {
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-5">
        <header className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Installer Sheetz</h1>
          <p className="mt-1 text-sm text-gray-600">Digital Job Cards for Field Technicians</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goToProjectDashboard}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
            >
              Back
            </button>
            <Link
              href="/home"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm hover:bg-blue-50"
            >
              Back to Home
            </Link>
          </div>
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
                <span className="font-semibold text-gray-600">Unit #:</span> {formatUpper(row.unitNumber) || "—"}
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
              <p className="sm:col-span-2">
                <span className="font-semibold text-gray-600">Email status:</span> {emailStatusLabel(row)}
              </p>
              {row.emailHistory.lastEmailedAt ? (
                <p className="sm:col-span-2 text-xs text-gray-600">
                  Last emailed: {new Date(row.emailHistory.lastEmailedAt).toLocaleString()}
                  {row.emailHistory.lastEmailMode
                    ? ` (${row.emailHistory.lastEmailMode === "internal_only" ? "internal only" : "client + internal"})`
                    : ""}
                </p>
              ) : null}
              {row.emailHistory.lastEmailResendId ? (
                <p className="sm:col-span-2 break-all text-xs text-gray-500">
                  Resend message ID: {row.emailHistory.lastEmailResendId}
                </p>
              ) : null}
              {row.emailHistory.lastEmailError ? (
                <p className="sm:col-span-2 text-xs font-semibold text-red-700">
                  Last email error: {row.emailHistory.lastEmailError}
                </p>
              ) : null}
              {row.emailHistory.lastEmailRecipients.length > 0 ? (
                <p className="sm:col-span-2 text-xs text-gray-600">
                  Last recipients:{" "}
                  {row.emailHistory.lastEmailRecipients.map((r) => r.email).join(", ")}
                </p>
              ) : null}
              <p className="sm:col-span-2 text-xs text-gray-500">
                <span className="font-semibold text-gray-600">Submission ID:</span> {row.submissionId}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={() => {
                  setResendModalRow(row);
                  setResendModalOpen(true);
                }}
                disabled={resendStateBySubmissionId[row.submissionId] === "sending"}
              >
                {resendStateBySubmissionId[row.submissionId] === "sending" ? "Resending..." : "Resend Email"}
              </button>
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
              <Link
                href={`/new-submission?editSubmissionId=${encodeURIComponent(row.submissionId)}`}
                className="rounded-lg border border-purple-300 bg-white px-4 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-50"
              >
                Edit
              </Link>
            </div>
            {resendStateBySubmissionId[row.submissionId] === "success" ? (
              <p className="mt-2 text-sm font-semibold text-emerald-800" role="status">
                {resendMessageBySubmissionId[row.submissionId] || "Email resent successfully"}
              </p>
            ) : null}
            {resendStateBySubmissionId[row.submissionId] === "error" ? (
              <p className="mt-2 text-sm font-semibold text-red-700" role="alert">
                {resendMessageBySubmissionId[row.submissionId] || "Failed to resend email"}
              </p>
            ) : null}

            {expandedSubmissionIds.has(row.submissionId) ? (
              <div className="mt-4 space-y-4 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                {isLinxUpPayload(row.payload) ? (
                  <>
                    <section>
                      <h3 className="text-sm font-bold text-gray-900">Core Job Info</h3>
                      <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                        <p><span className="font-semibold text-gray-600">Customer:</span> {renderDetailValue(row.payload.linxup?.customer || row.payload.coreJobInfo?.customer)}</p>
                        <p><span className="font-semibold text-gray-600">Location:</span> {renderDetailValue(row.payload.linxup?.location || row.payload.coreJobInfo?.location)}</p>
                        <p><span className="font-semibold text-gray-600">Primary Contact:</span> {renderDetailValue(row.payload.linxup?.primaryContact || row.payload.coreJobInfo?.primaryContact)}</p>
                        <p><span className="font-semibold text-gray-600">Contact Number:</span> {renderDetailValue(row.payload.linxup?.contactNumber || row.payload.coreJobInfo?.contactNumber)}</p>
                        <p><span className="font-semibold text-gray-600">Contact Email:</span> {renderDetailValue(row.payload.linxup?.contactEmail || row.payload.coreJobInfo?.contactEmail)}</p>
                        <p><span className="font-semibold text-gray-600">Installer:</span> {renderDetailValue(row.payload.coreJobInfo?.installerName)}</p>
                      </div>
                    </section>
                    <section>
                      <h3 className="text-sm font-bold text-gray-900">Vehicle Information</h3>
                      <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                        <p><span className="font-semibold text-gray-600">Year:</span> {renderDetailValue(row.payload.linxup?.year)}</p>
                        <p><span className="font-semibold text-gray-600">Make:</span> {renderDetailValue(row.payload.linxup?.make || row.payload.coreJobInfo?.equipmentMake)}</p>
                        <p><span className="font-semibold text-gray-600">Model:</span> {renderDetailText(displayUppercase(row.payload.linxup?.model || row.payload.coreJobInfo?.equipmentModel))}</p>
                        <p><span className="font-semibold text-gray-600">Serial/VIN:</span> {renderDetailText(displayUppercase(row.payload.linxup?.serialVin || row.payload.coreJobInfo?.equipmentSerial))}</p>
                        <p><span className="font-semibold text-gray-600">Asset Number:</span> {renderDetailText(displayUppercase(row.payload.linxup?.assetNumber || row.payload.coreJobInfo?.unitNumber))}</p>
                        <p><span className="font-semibold text-gray-600">Vehicle Type:</span> {renderDetailValue(row.payload.linxup?.vehicleType)}</p>
                        <p><span className="font-semibold text-gray-600">Hours/Miles:</span> {renderDetailValue(row.payload.linxup?.hoursMiles)}</p>
                      </div>
                    </section>
                    <section>
                      <h3 className="text-sm font-bold text-gray-900">Product</h3>
                      <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                        <p><span className="font-semibold text-gray-600">Product:</span> {renderDetailText(resolveProductLabel(row.payload))}</p>
                        <p><span className="font-semibold text-gray-600">Submission type:</span> {renderDetailValue(row.payload.linxup?.submissionType || row.payload.submissionType || row.payload.formId)}</p>
                      </div>
                    </section>
                    {(row.payload.selectedSections?.includes("linxup_vehicle_tracker") ||
                      row.payload.formId === "linxup_vehicle_tracker" ||
                      row.payload.submissionType === "linxup_vehicle_tracker" ||
                      row.payload.linxup?.formId === "linxup_vehicle_tracker" ||
                      !!row.payload.linxup?.vehicleTracker) && (
                      <section>
                        <h3 className="text-sm font-bold text-gray-900">Vehicle Tracker</h3>
                        <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                          <p><span className="font-semibold text-gray-600">Tag photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_vt_vehicleTrackerTag")}</p>
                          <p><span className="font-semibold text-gray-600">OBD Port:</span> {renderDetailValue(row.payload.linxup?.vehicleTracker?.obdPortConnected)}</p>
                          {row.payload.linxup?.vehicleTracker?.obdPortConnected === "Yes" ? (
                            <>
                              <p><span className="font-semibold text-gray-600">Green activity light:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_vt_greenActivityLight")}</p>
                              <p><span className="font-semibold text-gray-600">Installation photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_vt_installation")}</p>
                              <p><span className="font-semibold text-gray-600">Installation notes:</span> {renderDetailValue(row.payload.linxup?.vehicleTracker?.installationNotes)}</p>
                            </>
                          ) : null}
                          {row.payload.linxup?.vehicleTracker?.obdPortConnected === "No" ? (
                            <>
                              <p><span className="font-semibold text-gray-600">Power photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_vt_powerConnection")}</p>
                              <p><span className="font-semibold text-gray-600">Power note:</span> {renderDetailValue(row.payload.linxup?.vehicleTracker?.powerConnectionDescription)}</p>
                              <p><span className="font-semibold text-gray-600">Ground photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_vt_groundConnection")}</p>
                              <p><span className="font-semibold text-gray-600">Ground note:</span> {renderDetailValue(row.payload.linxup?.vehicleTracker?.groundConnectionDescription)}</p>
                              <p><span className="font-semibold text-gray-600">Ignition photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_vt_ignitionConnection")}</p>
                              <p><span className="font-semibold text-gray-600">Ignition note:</span> {renderDetailValue(row.payload.linxup?.vehicleTracker?.ignitionConnectionDescription)}</p>
                              <p><span className="font-semibold text-gray-600">Green activity light:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_vt_greenActivityLight")}</p>
                              <p><span className="font-semibold text-gray-600">Final install photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_vt_finalInstall")}</p>
                              <p><span className="font-semibold text-gray-600">Installation notes:</span> {renderDetailValue(row.payload.linxup?.vehicleTracker?.installationNotes)}</p>
                            </>
                          ) : null}
                        </div>
                      </section>
                    )}
                    {(row.payload.selectedSections?.includes("linxup_linxcam") ||
                      row.payload.formId === "linxup_linxcam" ||
                      row.payload.submissionType === "linxup_linxcam" ||
                      row.payload.linxup?.formId === "linxup_linxcam" ||
                      !!row.payload.linxup?.linxCam) && (
                      <section>
                        <h3 className="text-sm font-bold text-gray-900">LinxCam</h3>
                        <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                          <p><span className="font-semibold text-gray-600">Tag photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_lc_linxCamTag")}</p>
                          <p><span className="font-semibold text-gray-600">OBD Port:</span> {renderDetailValue(row.payload.linxup?.linxCam?.obdPortConnected)}</p>
                          {row.payload.linxup?.linxCam?.obdPortConnected === "Yes" ? (
                            <>
                              <p><span className="font-semibold text-gray-600">Green activity light:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_lc_greenActivityLight")}</p>
                              <p><span className="font-semibold text-gray-600">Installation photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_lc_installation")}</p>
                            </>
                          ) : null}
                          {row.payload.linxup?.linxCam?.obdPortConnected === "No" ? (
                            <>
                              <p><span className="font-semibold text-gray-600">Power photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_lc_powerConnection")}</p>
                              <p><span className="font-semibold text-gray-600">Power note:</span> {renderDetailValue(row.payload.linxup?.linxCam?.powerConnectionDescription)}</p>
                              <p><span className="font-semibold text-gray-600">Ground photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_lc_groundConnection")}</p>
                              <p><span className="font-semibold text-gray-600">Ground note:</span> {renderDetailValue(row.payload.linxup?.linxCam?.groundConnectionDescription)}</p>
                              <p><span className="font-semibold text-gray-600">Ignition photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_lc_ignitionConnection")}</p>
                              <p><span className="font-semibold text-gray-600">Ignition note:</span> {renderDetailValue(row.payload.linxup?.linxCam?.ignitionConnectionDescription)}</p>
                              <p><span className="font-semibold text-gray-600">Green activity light:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_lc_greenActivityLight")}</p>
                              <p><span className="font-semibold text-gray-600">Final install photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_lc_finalInstall")}</p>
                              <p><span className="font-semibold text-gray-600">Installation notes:</span> {renderDetailValue(row.payload.linxup?.linxCam?.installationNotes)}</p>
                            </>
                          ) : null}
                        </div>
                      </section>
                    )}
                    {(row.payload.selectedSections?.includes("linxup_asset_tracker") ||
                      row.payload.formId === "linxup_asset_tracker" ||
                      row.payload.submissionType === "linxup_asset_tracker" ||
                      row.payload.linxup?.formId === "linxup_asset_tracker" ||
                      !!(
                        row.payload.linxup?.powerConnectionDescription ||
                        row.payload.linxup?.groundConnectionDescription ||
                        row.payload.linxup?.ignitionConnectionDescription
                      )) && (
                      <section>
                        <h3 className="text-sm font-bold text-gray-900">Asset Tracker</h3>
                        <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                          <p><span className="font-semibold text-gray-600">Tag photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_at_assetTrackerTag")}</p>
                          <p><span className="font-semibold text-gray-600">Power photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_at_powerConnection")}</p>
                          <p><span className="font-semibold text-gray-600">Power note:</span> {renderDetailValue(row.payload.linxup?.powerConnectionDescription)}</p>
                          <p><span className="font-semibold text-gray-600">Ground photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_at_groundConnection")}</p>
                          <p><span className="font-semibold text-gray-600">Ground note:</span> {renderDetailValue(row.payload.linxup?.groundConnectionDescription)}</p>
                          <p><span className="font-semibold text-gray-600">Ignition photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_at_ignitionConnection")}</p>
                          <p><span className="font-semibold text-gray-600">Ignition note:</span> {renderDetailValue(row.payload.linxup?.ignitionConnectionDescription)}</p>
                          <p><span className="font-semibold text-gray-600">Final install photo:</span> {photoCountFromUploads(row.payload, "linxup", "linxup_at_finalInstall")}</p>
                        </div>
                      </section>
                    )}
                    <section>
                      <h3 className="text-sm font-bold text-gray-900">Vehicle Pictures</h3>
                      <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                        <p><span className="font-semibold text-gray-600">Vehicle Front:</span> {photoCountFromUploads(row.payload, "vehicle", "vehicleFront")}</p>
                        <p><span className="font-semibold text-gray-600">Vehicle Side:</span> {photoCountFromUploads(row.payload, "vehicle", "vehicleSide")}</p>
                        <p><span className="font-semibold text-gray-600">Vehicle Rear:</span> {photoCountFromUploads(row.payload, "vehicle", "vehicleRear")}</p>
                      </div>
                    </section>
                  </>
                ) : (
                  <>
                <section>
                  <h3 className="text-sm font-bold text-gray-900">Core Job Info</h3>
                  <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Customer:</span> {renderDetailValue(row.payload.coreJobInfo?.customer)}</p>
                    <p><span className="font-semibold text-gray-600">Location:</span> {renderDetailValue(row.payload.coreJobInfo?.location)}</p>
                    <p><span className="font-semibold text-gray-600">Work Order #:</span> {renderDetailText(formatWorkOrder(row.payload.coreJobInfo?.workOrder) || "Not Installed")}</p>
                    <p><span className="font-semibold text-gray-600">Service Appointment #:</span> {renderDetailText(formatServiceAppointment(row.payload.coreJobInfo?.serviceAppointment) || "Not Installed")}</p>
                    <p><span className="font-semibold text-gray-600">Installer:</span> {renderDetailValue(row.payload.coreJobInfo?.installerName)}</p>
                    <p><span className="font-semibold text-gray-600">Unit #:</span> {renderDetailText(displayUppercase(row.payload.coreJobInfo?.unitNumber))}</p>
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold text-gray-900">Vehicle Information</h3>
                  <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Make:</span> {renderDetailValue(row.payload.coreJobInfo?.equipmentMake)}</p>
                    <p><span className="font-semibold text-gray-600">Model:</span> {renderDetailText(displayUppercase(row.payload.coreJobInfo?.equipmentModel))}</p>
                    <p><span className="font-semibold text-gray-600">Serial #:</span> {renderDetailText(displayUppercase(row.payload.coreJobInfo?.equipmentSerial))}</p>
                    <p><span className="font-semibold text-gray-600">Drive Type:</span> {renderDetailValue(row.payload.vac4?.driveType)}</p>
                    <p><span className="font-semibold text-gray-600">Vehicle Type:</span> {renderDetailValue(row.payload.vac4?.vehicleType)}</p>
                    <p><span className="font-semibold text-gray-600">Voltage:</span> {renderDetailValue(row.payload.vac4?.vehicleVoltage)}</p>
                    {isBlaxtairFamilyPayload(row.payload) ? (
                      <p><span className="font-semibold text-gray-600">Hours / Miles:</span> {renderDetailValue(row.payload.vac4?.blaxtairHoursMiles)}</p>
                    ) : null}
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold text-gray-900">Hardware Selection</h3>
                  <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Primary:</span> {renderDetailValue(row.payload.hardwareSelection?.primary)}</p>
                    <p><span className="font-semibold text-gray-600">Additional selected?:</span> {renderDetailValue(row.payload.hardwareSelection?.hasAdditional)}</p>
                    <p className="sm:col-span-2">
                      <span className="font-semibold text-gray-600">Additional hardware:</span>{" "}
                      {Array.isArray(row.payload.hardwareSelection?.additional) &&
                      row.payload.hardwareSelection.additional.length > 0
                        ? row.payload.hardwareSelection.additional.join(", ")
                        : renderDetailText("Not Installed")}
                    </p>
                  </div>
                </section>

                {isBlaxtairAhdPayload(row.payload) || isSscSpeedPayload(row.payload) ? (
                  <>
                    {isBlaxtairAhdPayload(row.payload) ? (
                      <SimpleEmailSections
                        sections={(() => {
                          const systems = normalizeInstalledProductSystems({
                            installedProductSystems: row.payload.installedProductSystems,
                          });
                          return [
                            ...buildInstalledSystemEmailSections(systems),
                            ...systems.flatMap((system) => buildBlaxtairWireAndAlarmEmailSections(system)),
                          ];
                        })()}
                      />
                    ) : null}
                    {isSscSpeedPayload(row.payload) ? (
                      <SimpleEmailSections sections={buildSscSpeedSections(row.payload)} />
                    ) : null}
                    <section>
                      <h3 className="text-sm font-bold text-gray-900">Vehicle Pictures</h3>
                      <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                        <p><span className="font-semibold text-gray-600">Vehicle Front:</span> {photoCountFromUploads(row.payload, "vehicle", "vehicleFront")}</p>
                        <p><span className="font-semibold text-gray-600">Vehicle Side:</span> {photoCountFromUploads(row.payload, "vehicle", "vehicleSide")}</p>
                        <p><span className="font-semibold text-gray-600">Vehicle Rear:</span> {photoCountFromUploads(row.payload, "vehicle", "vehicleRear")}</p>
                      </div>
                    </section>
                  </>
                ) : (
                  <>
                <section>
                  <h3 className="text-sm font-bold text-gray-900">VAC4 Summary</h3>
                  <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Client Approval:</span> {renderDetailValue(row.payload.vac4?.clientApproval)}</p>
                    <p><span className="font-semibold text-gray-600">Hour Meter:</span> {textOrDash(row.payload.vac4?.hourMeter)}</p>
                    <p><span className="font-semibold text-gray-600">Sensor Hub Installed:</span> {renderDetailValue(row.payload.vac4?.sensorHubInstalled)}</p>
                    <p><span className="font-semibold text-gray-600">Lift Sense Installed:</span> {renderDetailValue(row.payload.vac4?.liftSenseInstalled)}</p>
                    <p><span className="font-semibold text-gray-600">Operator Presence Installed:</span> {renderDetailValue(row.payload.vac4?.operatorPresenceInstalled)}</p>
                    <p><span className="font-semibold text-gray-600">Speed Sense Installed:</span> {renderDetailValue(row.payload.vac4?.speedSenseInstalled)}</p>
                    <p><span className="font-semibold text-gray-600">Load Sense Installed:</span> {renderDetailValue(row.payload.vac4?.loadSenseInstalled)}</p>
                    <p><span className="font-semibold text-gray-600">GPS Installed:</span> {renderDetailValue(row.payload.vac4?.gpsInstalled)}</p>
                    <p><span className="font-semibold text-gray-600">External Indicator Installed:</span> {renderDetailValue(row.payload.vac4?.externalIndicatorInstalled)}</p>
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold text-gray-900">Connection Descriptions</h3>
                  <div className="mt-2 grid gap-2 text-sm text-gray-800 sm:grid-cols-2">
                    <p><span className="font-semibold text-gray-600">Red Wire Description:</span> {renderDetailValue(row.payload.vac4?.redWireDescription)}</p>
                    <p><span className="font-semibold text-gray-600">Black Wire Description:</span> {renderDetailValue(row.payload.vac4?.blackWireDescription)}</p>
                    <p><span className="font-semibold text-gray-600">Blue Wire Description:</span> {renderDetailValue(row.payload.vac4?.blueWireDescription)}</p>
                    <p><span className="font-semibold text-gray-600">Purple Wire Description:</span> {renderDetailValue(row.payload.vac4?.purpleWireDescription)}</p>
                    <p><span className="font-semibold text-gray-600">Brown Wire Description:</span> {renderDetailValue(row.payload.vac4?.brownWireDescription)}</p>
                    <p><span className="font-semibold text-gray-600">Relay Access Description:</span> {renderDetailValue(row.payload.vac4?.relayAccessDescription)}</p>
                    <p><span className="font-semibold text-gray-600">Impact Sensor Description:</span> {renderDetailValue(row.payload.vac4?.impactSensorDescription)}</p>
                    <p><span className="font-semibold text-gray-600">Speed Sense Description:</span> {renderDetailValue(row.payload.vac4?.speedSenseDescription)}</p>
                    <p><span className="font-semibold text-gray-600">Speed Sense Pulse Count:</span> {renderDetailValue(row.payload.vac4?.speedSensePulseCount)}</p>
                    <p><span className="font-semibold text-gray-600">Load Sense Thresholds:</span> {renderDetailValue(row.payload.vac4?.loadSenseThresholds)}</p>
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
                  </>
                )}
                  </>
                )}
              </div>
            ) : null}
          </section>
        ))}
        {resendModalRow ? (
          <EmailSendConfirmModal
            open={resendModalOpen}
            title="Resend Email"
            confirmLabel="Resend Email"
            model={buildEmailViewModel(resendModalRow.payload as JobCardSubmissionPayload)}
            payload={resendModalRow.payload}
            sending={resendStateBySubmissionId[resendModalRow.submissionId] === "sending"}
            errorMessage={
              resendStateBySubmissionId[resendModalRow.submissionId] === "error"
                ? resendMessageBySubmissionId[resendModalRow.submissionId] || "Failed to resend"
                : null
            }
            onClose={() => {
              setResendModalOpen(false);
              setResendModalRow(null);
            }}
            onConfirm={(mode) => void handleResendEmail(resendModalRow, mode)}
          />
        ) : null}
      </div>
    </main>
  );
}
