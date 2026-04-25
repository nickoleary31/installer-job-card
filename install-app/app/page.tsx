"use client";
import { useMemo, useState, type ChangeEvent } from "react";
import {
  type CoreJobFields,
  type Vac4DescriptionKey,
  type JobCardSubmissionPayload,
  type Vac4OrderedPhotoKey,
  type VacPhotoFileNames,
  DEFAULT_JOB_CARD_EMAIL_TO,
  VAC4_ORDERED_DESCRIPTION_FIELDS,
  VAC4_ORDERED_PHOTO_FIELDS,
  formatEmailBodyFromPayload,
  formatEmailSubject,
} from "@/lib/job-card-submission";

const MAX_PHOTOS_PER_FIELD = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const UPLOAD_ERR_MAX_COUNT = "Max 5 photos allowed";
const UPLOAD_ERR_FILE_SIZE = "File too large (10MB max)";

const hardwareTypes = [
  "VAC4",
  "CP4",
  "PPD",
  "Speed Transmon",
  "Speed SSC",
  "FTxw",
];

const emptyVacPhotoFileNames = (): VacPhotoFileNames => ({
  vacMounting: [],
  wirePath: [],
  redWire: [],
  blackWire: [],
  blueWire: [],
  brownWire: [],
  sensorHubMounting: [],
  speedSense: [],
  loadSense: [],
  gps: [],
  externalIndicator: [],
  purpleWire: [],
  relayAccess: [],
  impactSensor: [],
});

type VacPhotoFilesState = { [K in keyof VacPhotoFileNames]: File[] };

const emptyVacPhotoFiles = (): VacPhotoFilesState => ({
  vacMounting: [],
  wirePath: [],
  redWire: [],
  blackWire: [],
  blueWire: [],
  brownWire: [],
  sensorHubMounting: [],
  speedSense: [],
  loadSense: [],
  gps: [],
  externalIndicator: [],
  purpleWire: [],
  relayAccess: [],
  impactSensor: [],
});

type VacPhotoErrorsState = { [K in keyof VacPhotoFileNames]: string | null };

const emptyVacPhotoErrors = (): VacPhotoErrorsState => ({
  vacMounting: null,
  wirePath: null,
  redWire: null,
  blackWire: null,
  blueWire: null,
  brownWire: null,
  sensorHubMounting: null,
  speedSense: null,
  loadSense: null,
  gps: null,
  externalIndicator: null,
  purpleWire: null,
  relayAccess: null,
  impactSensor: null,
});

const VAC_PHOTO_KEYS = Object.keys(emptyVacPhotoFileNames()) as (keyof VacPhotoFileNames)[];

function VAC4Section({ children }: { children: any }) {
  return <>{children}</>;
}

function RequiredMark() {
  return (
    <span className="text-red-600 font-bold" aria-hidden="true">
      *
    </span>
  );
}

function IconClipboard({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <path d="M9 2v4h6V2H9zM9 12h6M9 16h6" />
    </svg>
  );
}

function IconChip({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01" />
    </svg>
  );
}

function IconGear({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function IconDocument({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}

function IconFloppy({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  );
}

function IconSend({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

type SectionStepStatus = "Not Started" | "In Progress" | "Complete";

function sectionStatusBadgeClassName(status: SectionStepStatus) {
  switch (status) {
    case "Not Started":
      return "mt-1 inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold tracking-tight text-slate-700 ring-1 ring-inset ring-slate-200/80";
    case "Complete":
      return "mt-1 inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold tracking-tight text-emerald-900 ring-1 ring-inset ring-emerald-200/80";
    case "In Progress":
    default:
      return "mt-1 inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold tracking-tight text-amber-900 ring-1 ring-inset ring-amber-200/80";
  }
}

function SectionStatusCard({
  title,
  tone,
  icon: Icon,
  status,
}: {
  title: string;
  tone: "blue" | "green" | "purple";
  icon: typeof IconClipboard;
  status: SectionStepStatus;
}) {
  const ring = tone === "blue" ? "bg-blue-600" : tone === "green" ? "bg-emerald-600" : "bg-violet-600";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${ring} text-white`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <span className={sectionStatusBadgeClassName(status)}>{status}</span>
        </div>
      </div>
    </div>
  );
}

function FormSectionHeader({ title, tone }: { title: string; tone: "blue" | "green" | "purple" }) {
  const ring = tone === "blue" ? "bg-blue-600" : tone === "green" ? "bg-emerald-600" : "bg-violet-600";
  const Icon = tone === "blue" ? IconClipboard : tone === "green" ? IconChip : IconGear;
  return (
    <div className="mb-6 flex items-center gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ring} text-white`}>
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-gray-900">{title}</h2>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const shown = value.trim() ? value : "—";
  return (
    <div className="grid gap-1 border-b border-gray-100 py-3 sm:grid-cols-3 sm:gap-4 last:border-b-0">
      <div className="text-sm font-semibold text-gray-600">{label}</div>
      <div className="text-base text-gray-900 sm:col-span-2">{shown}</div>
    </div>
  );
}

function photoLabel(count: number) {
  return count >= 1 ? `${count} file${count === 1 ? "" : "s"}` : "None uploaded";
}

function reviewPhotoSummary(count: number, names: string[]) {
  if (count < 1) return "None uploaded";
  if (names.length > 0) return `${count} file${count === 1 ? "" : "s"}: ${names.join(", ")}`;
  return `${count} file${count === 1 ? "" : "s"} (names not available)`;
}

function countPhotoValue(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") return value.trim() ? 1 : 0;
  return 0;
}

function formatPhotoSelectionLine(count: number, names: string[]) {
  if (count < 1 && names.length < 1) return null;
  if (names.length === 0) return `${count} file${count === 1 ? "" : "s"} selected`;
  if (names.length === 1) return names[0];
  return `${names.length} photos: ${names.join(", ")}`;
}

function PhotoUploadFeedback({ count, names }: { count: number; names: string[] }) {
  const line = formatPhotoSelectionLine(count, names);
  if (!line) return null;
  return <p className="mt-2 text-sm text-gray-700">{line}</p>;
}

function PhotoUploadedBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
      <span aria-hidden>✓</span> Uploaded
    </span>
  );
}

function PhotoFieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-1 text-sm font-medium text-red-600">{message}</p>;
}

export default function Page() {
  const [step, setStep] = useState<"form" | "review">("form");
  const [coreJob, setCoreJob] = useState<CoreJobFields>({
    customer: "",
    location: "",
    workOrder: "",
    serviceAppointment: "",
    unitNumber: "",
    equipmentMake: "",
    equipmentModel: "",
    equipmentSerial: "",
    installerName: "",
  });
  const [, setSubmissionCompletedAt] = useState<number | null>(null);
  const [submitSuccessMessage, setSubmitSuccessMessage] = useState<string | null>(null);
  const [emailSubmissionPreview, setEmailSubmissionPreview] = useState<{
    to: string;
    toLabel: string;
    subject: string;
    body: string;
  } | null>(null);
  const [pendingEmailPayload, setPendingEmailPayload] = useState<JobCardSubmissionPayload | null>(null);
  const [emailSendStatus, setEmailSendStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [emailSendErrorMessage, setEmailSendErrorMessage] = useState<string | null>(null);
  const configuredPreviewTo = process.env.NEXT_PUBLIC_JOB_CARD_EMAIL_TO?.trim() || "";

  const [primary, setPrimary] = useState("");
  const [hasAdditional, setHasAdditional] = useState("");
  const [additional, setAdditional] = useState<string[]>([]);
  const [vac4VehicleType, setVac4VehicleType] = useState("");
  const [vac4OtherVehicleType, setVac4OtherVehicleType] = useState("");
  const [vac4DriveType, setVac4DriveType] = useState("");
  const [vac4VehicleVoltage, setVac4VehicleVoltage] = useState("");
  const [vac4VehicleVoltageOther, setVac4VehicleVoltageOther] = useState("");
  const [vac4ClientApproval, setVac4ClientApproval] = useState("");
  const [vac4HourMeter, setVac4HourMeter] = useState("");
  const [sensorHubInstalled, setSensorHubInstalled] = useState("");
  const [liftSenseInstalled, setLiftSenseInstalled] = useState("");
  const [speedSenseInstalled, setSpeedSenseInstalled] = useState("");
  const [loadSenseInstalled, setLoadSenseInstalled] = useState("");
  const [gpsInstalled, setGpsInstalled] = useState("");
  const [externalIndicatorInstalled, setExternalIndicatorInstalled] = useState("");
  const [speedSenseDescription, setSpeedSenseDescription] = useState("");
  const [speedSensePulseCount, setSpeedSensePulseCount] = useState("");
  const [loadSenseThresholds, setLoadSenseThresholds] = useState("");
  const [redWireDescription, setRedWireDescription] = useState("");
  const [blackWireDescription, setBlackWireDescription] = useState("");
  const [blueWireDescription, setBlueWireDescription] = useState("");
  const [brownWireDescription, setBrownWireDescription] = useState("");
  const [purpleWireDescription, setPurpleWireDescription] = useState("");
  const [relayAccessDescription, setRelayAccessDescription] = useState("");
  const [impactSensorDescription, setImpactSensorDescription] = useState("");
  const [vacPhotoFiles, setVacPhotoFiles] = useState<VacPhotoFilesState>(() => emptyVacPhotoFiles());
  const [vacPhotoErrors, setVacPhotoErrors] = useState<VacPhotoErrorsState>(() => emptyVacPhotoErrors());
  const [reviewHighlights, setReviewHighlights] = useState<Set<string>>(() => new Set());
  const [reviewBlockMessage, setReviewBlockMessage] = useState<string | null>(null);

  const availableAdditional = hardwareTypes.filter((h) => h !== primary);
  const inputClassName =
    "w-full min-h-[52px] px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const selectClassName =
    "w-full min-h-[52px] px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const labelClassName = "block text-gray-900 font-semibold text-base mb-2";
  const photoPickClassName =
    "flex min-h-[52px] w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-center text-base font-semibold text-gray-900 active:bg-gray-100";
  const cardClassName =
    "rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6";
  const headerCardClassName =
    "rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:px-5 sm:py-4";
  const btnPrimaryClassName =
    "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 sm:min-w-[220px]";
  const btnSecondaryClassName =
    "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-blue-600 bg-white px-5 py-3.5 text-base font-semibold text-blue-600 shadow-sm hover:bg-blue-50 active:bg-blue-100 sm:min-w-[160px]";
  const checkboxRowClassName =
    "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl border-2 border-gray-100 bg-gray-50/80 px-4 py-3 text-base font-medium text-gray-900 active:bg-gray-100";
  const blueWireHelperText =
    vac4DriveType === "Electric"
      ? "Motion"
      : vac4DriveType === "Internal Combustion"
        ? "In-gear"
        : "Motion / In-gear";
  const brownWireHelperText =
    vac4DriveType === "Electric" && liftSenseInstalled === "Yes"
      ? "Lift"
      : vac4DriveType === "Internal Combustion"
        ? "Engine-on"
        : "Lift / Engine-on";

  const isElectricUi = vac4DriveType === "Electric";
  const isIcUi = vac4DriveType === "Internal Combustion";
  const blueWireRequiredUi = isIcUi || (isElectricUi && liftSenseInstalled === "Yes");

  const toggleAdditional = (type: string) => {
    if (additional.includes(type)) {
      setAdditional(additional.filter((a) => a !== type));
    } else {
      setAdditional([...additional, type]);
    }
  };
  const selectedSections = [primary, ...additional].filter(Boolean);

  const vacPhotoFileNames = useMemo((): VacPhotoFileNames => {
    const out = emptyVacPhotoFileNames();
    for (const k of VAC_PHOTO_KEYS) {
      out[k] = vacPhotoFiles[k].map((f) => f.name);
    }
    return out;
  }, [vacPhotoFiles]);

  const pc = useMemo(
    () => ({
      vacMounting: vacPhotoFiles.vacMounting.length,
      wirePath: vacPhotoFiles.wirePath.length,
      redWire: vacPhotoFiles.redWire.length,
      blackWire: vacPhotoFiles.blackWire.length,
      blueWire: vacPhotoFiles.blueWire.length,
      brownWire: vacPhotoFiles.brownWire.length,
      sensorHubMounting: vacPhotoFiles.sensorHubMounting.length,
      speedSense: vacPhotoFiles.speedSense.length,
      loadSense: vacPhotoFiles.loadSense.length,
      gps: vacPhotoFiles.gps.length,
      externalIndicator: vacPhotoFiles.externalIndicator.length,
      purpleWire: vacPhotoFiles.purpleWire.length,
      relayAccess: vacPhotoFiles.relayAccess.length,
      impactSensor: vacPhotoFiles.impactSensor.length,
    }),
    [vacPhotoFiles],
  );

  const requiredCoreValues = [
    coreJob.customer,
    coreJob.location,
    coreJob.workOrder,
    coreJob.serviceAppointment,
    coreJob.unitNumber,
    coreJob.equipmentSerial,
    coreJob.installerName,
  ];
  const requiredCoreFilledCount = requiredCoreValues.filter((v) => v.trim()).length;
  const coreSectionStatus: SectionStepStatus =
    requiredCoreFilledCount === 0
      ? "Not Started"
      : requiredCoreFilledCount === 7
        ? "Complete"
        : "In Progress";

  const hardwareSectionStatus: SectionStepStatus =
    !primary ? "Not Started" : hasAdditional === "Yes" || hasAdditional === "No" ? "Complete" : "In Progress";

  const hardwareStatusSections = [...new Set(selectedSections)];

  const collectReviewValidationIssues = (): string[] => {
    const issues: string[] = [];
    if (!coreJob.customer.trim()) issues.push("core-customer");
    if (!coreJob.location.trim()) issues.push("core-location");
    if (!coreJob.workOrder.trim()) issues.push("core-workOrder");
    if (!coreJob.serviceAppointment.trim()) issues.push("core-serviceAppointment");
    if (!coreJob.unitNumber.trim()) issues.push("core-unitNumber");
    if (!coreJob.equipmentSerial.trim()) issues.push("core-equipmentSerial");
    if (!coreJob.installerName.trim()) issues.push("core-installerName");
    if (!primary) issues.push("hw-primary");
    if (hasAdditional !== "Yes" && hasAdditional !== "No") issues.push("hw-hasAdditional");

    if (!selectedSections.includes("VAC4")) return issues;

    const isElectricDrive = vac4DriveType === "Electric";
    const isInternalCombustionDrive = vac4DriveType === "Internal Combustion";
    const isBlueWireRequired = isInternalCombustionDrive || (isElectricDrive && liftSenseInstalled === "Yes");
    const isBrownWireRequired = isInternalCombustionDrive || (isElectricDrive && liftSenseInstalled === "Yes");

    if (!vac4VehicleType) issues.push("vac4-vehicleType");
    if (vac4VehicleType === "Other" && !vac4OtherVehicleType.trim()) issues.push("vac4-otherVehicleType");
    if (!vac4DriveType) issues.push("vac4-driveType");
    if (isElectricDrive) {
      if (!vac4VehicleVoltage.trim()) issues.push("vac4-vehicleVoltage");
      if (vac4VehicleVoltage === "Other" && !vac4VehicleVoltageOther.trim()) issues.push("vac4-vehicleVoltageOther");
    }
    if (!vac4ClientApproval.trim()) issues.push("vac4-clientApproval");
    if (!vac4HourMeter.trim()) issues.push("vac4-hourMeter");
    if (isElectricDrive && !liftSenseInstalled) issues.push("vac4-liftSense");

    if (sensorHubInstalled === "Yes") {
      if (pc.sensorHubMounting < 1) issues.push("photo-sensorHubMounting");
      if (speedSenseInstalled === "Yes") {
        if (pc.speedSense < 1) issues.push("photo-speedSense");
        if (!speedSenseDescription.trim()) issues.push("vac4-speedSenseDescription");
        if (!speedSensePulseCount.trim()) issues.push("vac4-speedSensePulseCount");
      }
      if (loadSenseInstalled === "Yes") {
        if (pc.loadSense < 1) issues.push("photo-loadSense");
        if (!loadSenseThresholds.trim()) issues.push("vac4-loadSenseThresholds");
      }
      if (gpsInstalled === "Yes" && pc.gps < 1) issues.push("photo-gps");
      if (externalIndicatorInstalled === "Yes" && pc.externalIndicator < 1) issues.push("photo-externalIndicator");
    }

    if (pc.vacMounting < 1) issues.push("photo-vacMounting");
    if (pc.wirePath < 1) issues.push("photo-wirePath");
    if (pc.redWire < 1) issues.push("photo-redWire");
    if (!redWireDescription.trim()) issues.push("vac4-redWireDescription");
    if (pc.blackWire < 1) issues.push("photo-blackWire");
    if (!blackWireDescription.trim()) issues.push("vac4-blackWireDescription");
    if (isBlueWireRequired) {
      if (pc.blueWire < 1) issues.push("photo-blueWire");
      if (!blueWireDescription.trim()) issues.push("vac4-blueWireDescription");
    }
    if (isBrownWireRequired) {
      if (pc.brownWire < 1) issues.push("photo-brownWire");
      if (!brownWireDescription.trim()) issues.push("vac4-brownWireDescription");
    }

    return issues;
  };

  const setCoreField = (key: keyof CoreJobFields, value: string) => {
    setCoreJob((prev) => ({ ...prev, [key]: value }));
    setReviewHighlights((prev) => {
      if (!prev.has(`core-${key}`)) return prev;
      const n = new Set(prev);
      n.delete(`core-${key}`);
      if (n.size === 0) queueMicrotask(() => setReviewBlockMessage(null));
      return n;
    });
  };

  const clearFieldHighlight = (fieldKey: string) => {
    setReviewHighlights((prev) => {
      if (!prev.has(fieldKey)) return prev;
      const next = new Set(prev);
      next.delete(fieldKey);
      if (next.size === 0) queueMicrotask(() => setReviewBlockMessage(null));
      return next;
    });
  };

  const applyVacPhotoUpload = (key: keyof VacPhotoFileNames, e: ChangeEvent<HTMLInputElement>, mode: "single" | "multi") => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";

    const overSize = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (overSize) {
      setVacPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_FILE_SIZE }));
      return;
    }

    if (picked.length === 0) {
      setVacPhotoFiles((p) => ({ ...p, [key]: [] }));
      setVacPhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(`photo-${String(key)}`);
      return;
    }

    if (mode === "single") {
      setVacPhotoFiles((p) => ({ ...p, [key]: [picked[0]] }));
      setVacPhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(`photo-${String(key)}`);
      return;
    }

    let mergedOk: File[] | null = null;
    setVacPhotoFiles((p) => {
      const merged = [...p[key], ...picked];
      if (merged.length > MAX_PHOTOS_PER_FIELD) {
        return p;
      }
      mergedOk = merged;
      return { ...p, [key]: merged };
    });
    if (mergedOk) {
      setVacPhotoErrors((er) => ({ ...er, [key]: null }));
      clearFieldHighlight(`photo-${String(key)}`);
    } else {
      setVacPhotoErrors((er) => ({ ...er, [key]: UPLOAD_ERR_MAX_COUNT }));
    }
  };

  const handleReviewClick = () => {
    setSubmitSuccessMessage(null);
    setEmailSubmissionPreview(null);
    const issues = collectReviewValidationIssues();
    if (issues.length > 0) {
      setReviewHighlights(new Set(issues));
      setReviewBlockMessage("Please complete the highlighted required fields and photos.");
      queueMicrotask(() => {
        document.getElementById(`field-${issues[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    setReviewHighlights(new Set());
    setReviewBlockMessage(null);
    setStep("review");
  };

  const buildSubmissionPayload = (): JobCardSubmissionPayload => ({
    submissionTimestamp: new Date().toISOString(),
    status: "Submitted",
    coreJobInfo: { ...coreJob },
    hardwareSelection: {
      primary,
      hasAdditional,
      additional: [...additional],
    },
    selectedSections: [...selectedSections],
    vac4: {
      vehicleType: vac4VehicleType,
      otherVehicleType: vac4OtherVehicleType,
      driveType: vac4DriveType,
      vehicleVoltage: vac4VehicleVoltage,
      vehicleVoltageOther: vac4VehicleVoltageOther,
      clientApproval: vac4ClientApproval,
      hourMeter: vac4HourMeter,
      sensorHubInstalled,
      liftSenseInstalled,
      speedSenseInstalled,
      loadSenseInstalled,
      gpsInstalled,
      externalIndicatorInstalled,
      speedSenseDescription,
      speedSensePulseCount,
      loadSenseThresholds,
      redWireDescription,
      blackWireDescription,
      blueWireDescription,
      brownWireDescription,
      purpleWireDescription,
      relayAccessDescription,
      impactSensorDescription,
      photoCounts: {
        vacMounting: pc.vacMounting,
        wirePath: pc.wirePath,
        redWire: pc.redWire,
        blackWire: pc.blackWire,
        blueWire: pc.blueWire,
        brownWire: pc.brownWire,
        sensorHubMounting: pc.sensorHubMounting,
        speedSense: pc.speedSense,
        loadSense: pc.loadSense,
        gps: pc.gps,
        externalIndicator: pc.externalIndicator,
      },
      photoFileNames: { ...vacPhotoFileNames },
    },
  });

  const handleFinalSubmit = () => {
    const payload = buildSubmissionPayload();
    console.log("[Job card submission]", payload);
    setSubmissionCompletedAt(Date.now());
    setSubmitSuccessMessage("Job card prepared for email submission.");
    setPendingEmailPayload(payload);
    setEmailSendStatus("idle");
    setEmailSendErrorMessage(null);
    const previewTo = configuredPreviewTo || DEFAULT_JOB_CARD_EMAIL_TO;
    setEmailSubmissionPreview({
      to: previewTo,
      toLabel: configuredPreviewTo ? "To:" : "To (preview fallback):",
      subject: formatEmailSubject(payload.coreJobInfo.customer, payload.coreJobInfo.unitNumber),
      body: formatEmailBodyFromPayload(payload),
    });
    setReviewHighlights(new Set());
    setReviewBlockMessage(null);
    setStep("form");
  };

  const handleConfirmSendEmail = async () => {
    if (!pendingEmailPayload) return;
    setEmailSendStatus("sending");
    setEmailSendErrorMessage(null);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: pendingEmailPayload }),
      });
      let data: { error?: string } = {};
      try {
        data = (await res.json()) as { error?: string };
      } catch {
        /* ignore non-JSON */
      }
      if (!res.ok) {
        setEmailSendStatus("error");
        setEmailSendErrorMessage(
          typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
        );
        return;
      }
      setEmailSendStatus("success");
    } catch (e) {
      setEmailSendStatus("error");
      setEmailSendErrorMessage(e instanceof Error ? e.message : "Network error");
    }
  };

  const handleBackToForm = () => {
    setReviewHighlights(new Set());
    setReviewBlockMessage(null);
    setStep("form");
  };

  const hl = (key: string) => reviewHighlights.has(key);
  const fieldInputClass = (key: string) =>
    `${inputClassName}${hl(key) ? " border-red-500 ring-2 ring-red-100" : ""}`;
  const fieldSelectClass = (key: string) =>
    `${selectClassName}${hl(key) ? " border-red-500 ring-2 ring-red-100" : ""}`;
  const fieldLabelClass = (key: string) => `${labelClassName}${hl(key) ? " text-red-600" : ""}`;
  const requiredHint = (key: string) =>
    hl(key) ? <p className="mt-1 text-sm font-medium text-red-600">Required</p> : null;

  const photoPickClass = (photoKey: string, required: boolean, complete: boolean) => {
    let extra = "";
    if (hl(photoKey)) extra = " border-red-500 border-dashed ring-2 ring-red-100";
    else if (required && complete) extra = " border-emerald-500 border-dashed";
    return `${photoPickClassName}${extra}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-32 sm:pb-36 md:pb-10">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:space-y-6 sm:px-5 sm:py-6">
        <header className={headerCardClassName}>
          <div className="flex flex-col items-start gap-1.5">
            <img src="/powerfleet-logo.png" alt="Powerfleet" className="h-10 w-auto sm:h-12" />
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Installer Job Card</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-blue-700 ring-1 ring-inset ring-blue-200/80 sm:px-3 sm:py-1">
                <IconDocument className="h-3.5 w-3.5 shrink-0" />
                DRAFT
              </span>
            </div>
            <p className="text-base font-medium leading-tight text-gray-600">Complete one job card per unit.</p>
          </div>
        </header>

        {submitSuccessMessage && (
          <div
            className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            role="status"
          >
            <p className="text-sm font-semibold text-emerald-950 sm:text-base">{submitSuccessMessage}</p>
            <button
              type="button"
              className="shrink-0 self-start rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 sm:self-auto"
              onClick={() => {
                setSubmitSuccessMessage(null);
                setEmailSubmissionPreview(null);
                setPendingEmailPayload(null);
                setEmailSendStatus("idle");
                setEmailSendErrorMessage(null);
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {emailSubmissionPreview && (
          <section className={cardClassName} aria-labelledby="email-preview-heading">
            <h2 id="email-preview-heading" className="mb-1 text-lg font-bold text-gray-900">
              Email preview
            </h2>
            <p className="mb-4 text-sm text-gray-600">
              Review the message below. Confirm & Send Email posts this job card to the server; delivery requires SMTP
              environment variables on the server.
            </p>
            <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-900 shadow-inner">
              <div>
                <span className="font-semibold text-gray-600">{emailSubmissionPreview.toLabel}</span>{" "}
                <span className="break-all font-mono">{emailSubmissionPreview.to}</span>
              </div>
              <div>
                <span className="font-semibold text-gray-600">Subject:</span>{" "}
                <span className="break-words font-medium">{emailSubmissionPreview.subject}</span>
              </div>
              <div>
                <p className="mb-2 font-semibold text-gray-600">Body</p>
                <pre className="max-h-[min(70vh,28rem)] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-white p-4 font-sans text-sm leading-relaxed text-gray-800">
                  {emailSubmissionPreview.body}
                </pre>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <button
                type="button"
                className={btnPrimaryClassName}
                disabled={emailSendStatus === "sending" || !pendingEmailPayload}
                onClick={handleConfirmSendEmail}
              >
                {emailSendStatus === "sending" ? "Sending…" : "Confirm & Send Email"}
              </button>
              {emailSendStatus === "success" && (
                <p className="text-sm font-semibold text-emerald-800" role="status">
                  Email sent successfully.
                </p>
              )}
              {emailSendStatus === "error" && emailSendErrorMessage && (
                <p className="text-sm font-semibold text-red-700" role="alert">
                  {emailSendErrorMessage}
                </p>
              )}
            </div>
          </section>
        )}

        {step === "form" ? (
        <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <SectionStatusCard title="Core Job Info" tone="blue" icon={IconClipboard} status={coreSectionStatus} />
          <SectionStatusCard title="Hardware Selection" tone="green" icon={IconChip} status={hardwareSectionStatus} />
          {hardwareStatusSections.map((section) => (
            <SectionStatusCard
              key={section}
              title={`${section} Section`}
              tone={section === "VAC4" ? "purple" : "green"}
              icon={section === "VAC4" ? IconGear : IconChip}
              status="In Progress"
            />
          ))}
        </div>

        {reviewBlockMessage && (
          <div
            className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 text-base font-semibold text-red-900 shadow-sm"
            role="alert"
          >
            {reviewBlockMessage}
          </div>
        )}

        {/* Core Info */}
        <section className={cardClassName}>
          <FormSectionHeader title="Core Job Info" tone="blue" />

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-x-6 md:gap-y-5">
            <div id="field-core-customer">
              <label className={fieldLabelClass("core-customer")}>
                Customer
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-customer")}
                placeholder="Enter customer name"
                value={coreJob.customer}
                onChange={(e) => setCoreField("customer", e.target.value)}
              />
              {requiredHint("core-customer")}
            </div>

            <div id="field-core-location">
              <label className={fieldLabelClass("core-location")}>
                Location
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-location")}
                placeholder="Enter location"
                value={coreJob.location}
                onChange={(e) => setCoreField("location", e.target.value)}
              />
              {requiredHint("core-location")}
            </div>

            <div id="field-core-workOrder">
              <label className={fieldLabelClass("core-workOrder")}>
                Work Order #
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-workOrder")}
                placeholder="Enter work order #"
                value={coreJob.workOrder}
                onChange={(e) => setCoreField("workOrder", e.target.value)}
              />
              {requiredHint("core-workOrder")}
            </div>

            <div id="field-core-serviceAppointment">
              <label className={fieldLabelClass("core-serviceAppointment")}>
                Service Appointment #
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-serviceAppointment")}
                placeholder="Enter service appointment #"
                value={coreJob.serviceAppointment}
                onChange={(e) => setCoreField("serviceAppointment", e.target.value)}
              />
              {requiredHint("core-serviceAppointment")}
            </div>

            <div id="field-core-unitNumber">
              <label className={fieldLabelClass("core-unitNumber")}>
                Unit Number
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-unitNumber")}
                placeholder="Enter unit number"
                value={coreJob.unitNumber}
                onChange={(e) => setCoreField("unitNumber", e.target.value)}
              />
              {requiredHint("core-unitNumber")}
            </div>

            <div>
              <label className={labelClassName}>Equipment Make</label>
              <input
                className={inputClassName}
                placeholder="Enter equipment make"
                value={coreJob.equipmentMake}
                onChange={(e) => setCoreField("equipmentMake", e.target.value)}
              />
            </div>

            <div>
              <label className={labelClassName}>Equipment Model</label>
              <input
                className={inputClassName}
                placeholder="Enter equipment model"
                value={coreJob.equipmentModel}
                onChange={(e) => setCoreField("equipmentModel", e.target.value)}
              />
            </div>

            <div id="field-core-equipmentSerial">
              <label className={fieldLabelClass("core-equipmentSerial")}>
                Equipment Serial #
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-equipmentSerial")}
                placeholder="Enter equipment serial #"
                value={coreJob.equipmentSerial}
                onChange={(e) => setCoreField("equipmentSerial", e.target.value)}
              />
              {requiredHint("core-equipmentSerial")}
            </div>

            <div id="field-core-installerName">
              <label className={fieldLabelClass("core-installerName")}>
                Installer Name
                <RequiredMark />
              </label>
              <input
                className={fieldInputClass("core-installerName")}
                placeholder="Enter installer name"
                value={coreJob.installerName}
                onChange={(e) => setCoreField("installerName", e.target.value)}
              />
              {requiredHint("core-installerName")}
            </div>
          </div>
        </section>

        {/* Hardware Selection */}
        <section className={cardClassName}>
          <FormSectionHeader title="Hardware Selection" tone="green" />

          <div className="space-y-5">
            <div id="field-hw-primary">
              <label className={fieldLabelClass("hw-primary")}>
                Primary Hardware / Install Type
                <RequiredMark />
              </label>
              <select
                className={fieldSelectClass("hw-primary")}
                value={primary}
                onChange={(e) => {
                  setPrimary(e.target.value);
                  clearFieldHighlight("hw-primary");
                }}
              >
                <option value="" className="text-gray-400">
                  Select Primary Hardware
                </option>
                <option value="VAC4">VAC4</option>
                <option value="CP4">CP4</option>
                <option value="PPD">PPD</option>
                <option value="Speed Transmon">Speed Transmon</option>
                <option value="Speed SSC">Speed SSC</option>
                <option value="FTxw">FTxw</option>
              </select>
              {requiredHint("hw-primary")}
            </div>

            <div id="field-hw-hasAdditional">
              <label className={fieldLabelClass("hw-hasAdditional")}>
                Is any additional hardware being installed?
                <RequiredMark />
              </label>
              <select
                className={fieldSelectClass("hw-hasAdditional")}
                value={hasAdditional}
                onChange={(e) => {
                  setHasAdditional(e.target.value);
                  clearFieldHighlight("hw-hasAdditional");
                }}
              >
                <option value="" className="text-gray-400">
                  Any additional hardware?
                </option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
              {requiredHint("hw-hasAdditional")}
            </div>

            {hasAdditional === "Yes" && primary && (
              <div className="space-y-3 pt-1">
                {availableAdditional.map((type) => (
                  <label key={type} className={checkboxRowClassName}>
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 rounded border-2 border-gray-400 text-blue-600 focus:ring-blue-500"
                      checked={additional.includes(type)}
                      onChange={() => toggleAdditional(type)}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>

        {primary === "VAC4" && (
          <VAC4Section>
            <section className={`${cardClassName} space-y-5`}>
              <FormSectionHeader title="VAC4 Section" tone="purple" />

                <div id="field-vac4-vehicleType">
                  <label className={fieldLabelClass("vac4-vehicleType")}>
                    Vehicle Type
                    <RequiredMark />
                  </label>
                  <select
                    className={fieldSelectClass("vac4-vehicleType")}
                    value={vac4VehicleType}
                    onChange={(e) => {
                      setVac4VehicleType(e.target.value);
                      clearFieldHighlight("vac4-vehicleType");
                    }}
                  >
                    <option value="" className="text-gray-400">
                      Select vehicle type
                    </option>
                    <option>Forklift Rider</option>
                    <option>Forklift Stand-up</option>
                    <option>Man Lift</option>
                    <option>Order Picker</option>
                    <option>Pallet Jack Rider</option>
                    <option>Pallet Jack Walkie</option>
                    <option>Reach Truck</option>
                    <option>Stacker Rider</option>
                    <option>Stacker Walkie</option>
                    <option>Sweeper/Scrubber</option>
                    <option>Tugger/Tow Tractor</option>
                    <option>Turret Truck</option>
                    <option>Other</option>
                  </select>
                  {requiredHint("vac4-vehicleType")}
                </div>

                {vac4VehicleType === "Other" && (
                  <div id="field-vac4-otherVehicleType">
                    <label className={fieldLabelClass("vac4-otherVehicleType")}>
                      Other Vehicle Type
                      <RequiredMark />
                    </label>
                    <input
                      className={fieldInputClass("vac4-otherVehicleType")}
                      placeholder="Enter vehicle type"
                      value={vac4OtherVehicleType}
                      onChange={(e) => {
                        setVac4OtherVehicleType(e.target.value);
                        clearFieldHighlight("vac4-otherVehicleType");
                      }}
                    />
                    {requiredHint("vac4-otherVehicleType")}
                  </div>
                )}

                <div id="field-vac4-driveType">
                  <label className={fieldLabelClass("vac4-driveType")}>
                    Drive Type
                    <RequiredMark />
                  </label>
                  <select
                    className={fieldSelectClass("vac4-driveType")}
                    value={vac4DriveType}
                    onChange={(e) => {
                      const v = e.target.value;
                      setVac4DriveType(v);
                      clearFieldHighlight("vac4-driveType");
                      if (v !== "Electric") {
                        setVac4VehicleVoltage("");
                        setVac4VehicleVoltageOther("");
                      }
                    }}
                  >
                    <option value="" className="text-gray-400">
                      Select drive type
                    </option>
                    <option>Electric</option>
                    <option>Internal Combustion</option>
                    <option>Other</option>
                  </select>
                  {requiredHint("vac4-driveType")}
                </div>

                {vac4DriveType === "Electric" && (
                  <div className="space-y-5">
                    <div id="field-vac4-vehicleVoltage">
                      <label className={fieldLabelClass("vac4-vehicleVoltage")}>
                        Vehicle Voltage
                        <RequiredMark />
                      </label>
                      <select
                        className={fieldSelectClass("vac4-vehicleVoltage")}
                        value={vac4VehicleVoltage}
                        onChange={(e) => {
                          setVac4VehicleVoltage(e.target.value);
                          clearFieldHighlight("vac4-vehicleVoltage");
                          if (e.target.value !== "Other") {
                            setVac4VehicleVoltageOther("");
                          }
                        }}
                      >
                        <option value="" className="text-gray-400">
                          Select vehicle voltage
                        </option>
                        <option value="12">12</option>
                        <option value="24">24</option>
                        <option value="36">36</option>
                        <option value="48">48</option>
                        <option value="60">60</option>
                        <option value="80">80</option>
                        <option value="Other">Other</option>
                      </select>
                      {requiredHint("vac4-vehicleVoltage")}
                    </div>
                    {vac4VehicleVoltage === "Other" && (
                      <div id="field-vac4-vehicleVoltageOther">
                        <label className={fieldLabelClass("vac4-vehicleVoltageOther")}>
                          Other Vehicle Voltage
                          <RequiredMark />
                        </label>
                        <input
                          className={fieldInputClass("vac4-vehicleVoltageOther")}
                          placeholder="Enter vehicle voltage"
                          value={vac4VehicleVoltageOther}
                          onChange={(e) => {
                            setVac4VehicleVoltageOther(e.target.value);
                            clearFieldHighlight("vac4-vehicleVoltageOther");
                          }}
                        />
                        {requiredHint("vac4-vehicleVoltageOther")}
                      </div>
                    )}
                  </div>
                )}

                <div id="field-vac4-clientApproval">
                  <label className={fieldLabelClass("vac4-clientApproval")}>
                    Client Representative Approval Details
                    <RequiredMark />
                  </label>
                  <input
                    className={fieldInputClass("vac4-clientApproval")}
                    placeholder="Name, signature confirmation, date/time"
                    value={vac4ClientApproval}
                    onChange={(e) => {
                      setVac4ClientApproval(e.target.value);
                      clearFieldHighlight("vac4-clientApproval");
                    }}
                  />
                  {requiredHint("vac4-clientApproval")}
                </div>

                <div id="field-vac4-hourMeter">
                  <label className={fieldLabelClass("vac4-hourMeter")}>
                    Hour Meter Entered During Configuration
                    <RequiredMark />
                  </label>
                  <input
                    className={fieldInputClass("vac4-hourMeter")}
                    placeholder="Enter hour meter value"
                    value={vac4HourMeter}
                    onChange={(e) => {
                      setVac4HourMeter(e.target.value);
                      clearFieldHighlight("vac4-hourMeter");
                    }}
                  />
                  {requiredHint("vac4-hourMeter")}
                </div>

                {vac4DriveType === "Electric" && (
                  <div id="field-vac4-liftSense">
                    <label className={fieldLabelClass("vac4-liftSense")}>
                      Lift Sense Installed?
                      <RequiredMark />
                    </label>
                    <select
                      className={fieldSelectClass("vac4-liftSense")}
                      value={liftSenseInstalled}
                      onChange={(e) => {
                        setLiftSenseInstalled(e.target.value);
                        clearFieldHighlight("vac4-liftSense");
                      }}
                    >
                      <option value="" className="text-gray-400">
                        Select Yes or No
                      </option>
                      <option>Yes</option>
                      <option>No</option>
                    </select>
                    {requiredHint("vac4-liftSense")}
                  </div>
                )}

                <div>
                  <label className={labelClassName}>Sensor Hub Installed?</label>
                  <select
                    className={selectClassName}
                    value={sensorHubInstalled}
                    onChange={(e) => setSensorHubInstalled(e.target.value)}
                  >
                    <option value="" className="text-gray-400">
                      Select Yes or No
                    </option>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                </div>

                {sensorHubInstalled === "Yes" && (
                  <div className="space-y-5 rounded-2xl border-2 border-gray-200 bg-gray-50/90 p-4 sm:p-5">
                    <div>
                      <label className={labelClassName}>Sensor Hub Mounting Location</label>
                      <input className={inputClassName} placeholder="Describe mounting location" />
                    </div>
                    <div id="field-photo-sensorHubMounting">
                      <label className={fieldLabelClass("photo-sensorHubMounting")}>
                        Sensor Hub Mounting Location Photo
                        <RequiredMark />
                      </label>
                      <input
                        id="sensorHubMountingPhoto"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => applyVacPhotoUpload("sensorHubMounting", e, "single")}
                      />
                      <label
                        htmlFor="sensorHubMountingPhoto"
                        className={photoPickClass("photo-sensorHubMounting", true, pc.sensorHubMounting >= 1)}
                      >
                        📷 Take / Upload Photo
                      </label>
                      <PhotoUploadFeedback count={pc.sensorHubMounting} names={vacPhotoFileNames.sensorHubMounting} />
                      <PhotoUploadedBadge show={pc.sensorHubMounting >= 1} />
                      <PhotoFieldError message={vacPhotoErrors.sensorHubMounting} />
                      {requiredHint("photo-sensorHubMounting")}
                    </div>

                    <div>
                      <label className={labelClassName}>Speed Sense Installed?</label>
                      <select
                        className={selectClassName}
                        value={speedSenseInstalled}
                        onChange={(e) => setSpeedSenseInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClassName}>Load Sense Installed?</label>
                      <select
                        className={selectClassName}
                        value={loadSenseInstalled}
                        onChange={(e) => setLoadSenseInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClassName}>GPS Installed?</label>
                      <select
                        className={selectClassName}
                        value={gpsInstalled}
                        onChange={(e) => setGpsInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClassName}>External Indicator Installed?</label>
                      <select
                        className={selectClassName}
                        value={externalIndicatorInstalled}
                        onChange={(e) => setExternalIndicatorInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    {speedSenseInstalled === "Yes" && (
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900">Speed Sense Details</h3>
                        <div id="field-photo-speedSense">
                          <label className={fieldLabelClass("photo-speedSense")}>
                            Speed Sense Photo
                            <RequiredMark />
                          </label>
                          <input
                            id="speedSensePhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => applyVacPhotoUpload("speedSense", e, "single")}
                          />
                          <label
                            htmlFor="speedSensePhoto"
                            className={photoPickClass("photo-speedSense", true, pc.speedSense >= 1)}
                          >
                            📷 Take / Upload Photo
                          </label>
                          <PhotoUploadFeedback count={pc.speedSense} names={vacPhotoFileNames.speedSense} />
                          <PhotoUploadedBadge show={pc.speedSense >= 1} />
                          <PhotoFieldError message={vacPhotoErrors.speedSense} />
                          {requiredHint("photo-speedSense")}
                        </div>
                        <div id="field-vac4-speedSenseDescription">
                          <label className={fieldLabelClass("vac4-speedSenseDescription")}>
                            Speed Sense Description
                            <RequiredMark />
                          </label>
                          <input
                            className={fieldInputClass("vac4-speedSenseDescription")}
                            placeholder="Describe speed sense install"
                            value={speedSenseDescription}
                            onChange={(e) => {
                              setSpeedSenseDescription(e.target.value);
                              clearFieldHighlight("vac4-speedSenseDescription");
                            }}
                          />
                          {requiredHint("vac4-speedSenseDescription")}
                        </div>
                        <div id="field-vac4-speedSensePulseCount">
                          <label className={fieldLabelClass("vac4-speedSensePulseCount")}>
                            Speed Sense Pulse Count
                            <RequiredMark />
                          </label>
                          <input
                            className={fieldInputClass("vac4-speedSensePulseCount")}
                            placeholder="Enter pulse count"
                            value={speedSensePulseCount}
                            onChange={(e) => {
                              setSpeedSensePulseCount(e.target.value);
                              clearFieldHighlight("vac4-speedSensePulseCount");
                            }}
                          />
                          {requiredHint("vac4-speedSensePulseCount")}
                        </div>
                      </div>
                    )}

                    {loadSenseInstalled === "Yes" && (
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900">Load Sense Details</h3>
                        <div id="field-photo-loadSense">
                          <label className={fieldLabelClass("photo-loadSense")}>
                            Load Sense Photo
                            <RequiredMark />
                          </label>
                          <input
                            id="loadSensePhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => applyVacPhotoUpload("loadSense", e, "single")}
                          />
                          <label
                            htmlFor="loadSensePhoto"
                            className={photoPickClass("photo-loadSense", true, pc.loadSense >= 1)}
                          >
                            📷 Take / Upload Photo
                          </label>
                          <PhotoUploadFeedback count={pc.loadSense} names={vacPhotoFileNames.loadSense} />
                          <PhotoUploadedBadge show={pc.loadSense >= 1} />
                          <PhotoFieldError message={vacPhotoErrors.loadSense} />
                          {requiredHint("photo-loadSense")}
                        </div>
                        <div id="field-vac4-loadSenseThresholds">
                          <label className={fieldLabelClass("vac4-loadSenseThresholds")}>
                            Load Sense VAC Thresholds
                            <RequiredMark />
                          </label>
                          <input
                            className={fieldInputClass("vac4-loadSenseThresholds")}
                            placeholder="Enter VAC thresholds"
                            value={loadSenseThresholds}
                            onChange={(e) => {
                              setLoadSenseThresholds(e.target.value);
                              clearFieldHighlight("vac4-loadSenseThresholds");
                            }}
                          />
                          {requiredHint("vac4-loadSenseThresholds")}
                        </div>
                      </div>
                    )}

                    {gpsInstalled === "Yes" && (
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900">GPS Details</h3>
                        <div id="field-photo-gps">
                          <label className={fieldLabelClass("photo-gps")}>
                            GPS Mounting Location Photo
                            <RequiredMark />
                          </label>
                          <input
                            id="gpsMountingPhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => applyVacPhotoUpload("gps", e, "single")}
                          />
                          <label
                            htmlFor="gpsMountingPhoto"
                            className={photoPickClass("photo-gps", true, pc.gps >= 1)}
                          >
                            📷 Take / Upload Photo
                          </label>
                          <PhotoUploadFeedback count={pc.gps} names={vacPhotoFileNames.gps} />
                          <PhotoUploadedBadge show={pc.gps >= 1} />
                          <PhotoFieldError message={vacPhotoErrors.gps} />
                          {requiredHint("photo-gps")}
                        </div>
                      </div>
                    )}

                    {externalIndicatorInstalled === "Yes" && (
                      <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-5">
                        <h3 className="text-lg font-bold text-gray-900">External Indicator Details</h3>
                        <div id="field-photo-externalIndicator">
                          <label className={fieldLabelClass("photo-externalIndicator")}>
                            External Indicator Mounting Location Photo
                            <RequiredMark />
                          </label>
                          <input
                            id="externalIndicatorPhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => applyVacPhotoUpload("externalIndicator", e, "single")}
                          />
                          <label
                            htmlFor="externalIndicatorPhoto"
                            className={photoPickClass("photo-externalIndicator", true, pc.externalIndicator >= 1)}
                          >
                            📷 Take / Upload Photo
                          </label>
                          <PhotoUploadFeedback count={pc.externalIndicator} names={vacPhotoFileNames.externalIndicator} />
                          <PhotoUploadedBadge show={pc.externalIndicator >= 1} />
                          <PhotoFieldError message={vacPhotoErrors.externalIndicator} />
                          {requiredHint("photo-externalIndicator")}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-5 rounded-2xl border-2 border-gray-200 bg-gray-50/90 p-4 sm:p-5">
                  <h3 className="text-lg font-bold text-gray-900">VAC4 Required Photos</h3>

                  <div id="field-photo-vacMounting">
                    <label className={fieldLabelClass("photo-vacMounting")}>
                      VAC Mounting Location Photo
                      <RequiredMark />
                    </label>
                    <input
                      id="vacMountingPhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => applyVacPhotoUpload("vacMounting", e, "single")}
                    />
                    <label
                      htmlFor="vacMountingPhoto"
                      className={photoPickClass("photo-vacMounting", true, pc.vacMounting >= 1)}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.vacMounting} names={vacPhotoFileNames.vacMounting} />
                    <PhotoUploadedBadge show={pc.vacMounting >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.vacMounting} />
                    {requiredHint("photo-vacMounting")}
                  </div>
                  <div id="field-photo-wirePath">
                    <label className={fieldLabelClass("photo-wirePath")}>
                      Wire Path Photos
                      <RequiredMark />
                    </label>
                    <input
                      id="wirePathPhotos"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      multiple
                      onChange={(e) => applyVacPhotoUpload("wirePath", e, "multi")}
                    />
                    <label
                      htmlFor="wirePathPhotos"
                      className={photoPickClass("photo-wirePath", true, pc.wirePath >= 1)}
                    >
                      📷 Take / Upload Photos
                    </label>
                    <PhotoUploadFeedback count={pc.wirePath} names={vacPhotoFileNames.wirePath} />
                    <PhotoUploadedBadge show={pc.wirePath >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.wirePath} />
                    {requiredHint("photo-wirePath")}
                    <p className="mt-2 text-base leading-relaxed text-gray-600">
                      Upload multiple photos showing the full wire route from device to connection points.
                    </p>
                  </div>

                  <div id="field-photo-redWire">
                    <label className={fieldLabelClass("photo-redWire")}>
                      Red Wire Connection Photo
                      <RequiredMark />
                    </label>
                    <p className="text-base text-gray-600">Battery positive</p>
                    <input
                      id="redWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => applyVacPhotoUpload("redWire", e, "single")}
                    />
                    <label
                      htmlFor="redWirePhoto"
                      className={`${photoPickClass("photo-redWire", true, pc.redWire >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.redWire} names={vacPhotoFileNames.redWire} />
                    <PhotoUploadedBadge show={pc.redWire >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.redWire} />
                    {requiredHint("photo-redWire")}
                    <div id="field-vac4-redWireDescription" className="mt-2">
                      <label className={fieldLabelClass("vac4-redWireDescription")}>
                        Red wire connection description
                        <RequiredMark />
                      </label>
                      <input
                        className={fieldInputClass("vac4-redWireDescription")}
                        placeholder="Red wire connection description"
                        value={redWireDescription}
                        onChange={(e) => {
                          setRedWireDescription(e.target.value);
                          clearFieldHighlight("vac4-redWireDescription");
                        }}
                      />
                      {requiredHint("vac4-redWireDescription")}
                    </div>
                  </div>
                  <div id="field-photo-blackWire">
                    <label className={fieldLabelClass("photo-blackWire")}>
                      Black Wire Connection Photo
                      <RequiredMark />
                    </label>
                    <p className="text-base text-gray-600">Battery negative</p>
                    <input
                      id="blackWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => applyVacPhotoUpload("blackWire", e, "single")}
                    />
                    <label
                      htmlFor="blackWirePhoto"
                      className={`${photoPickClass("photo-blackWire", true, pc.blackWire >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.blackWire} names={vacPhotoFileNames.blackWire} />
                    <PhotoUploadedBadge show={pc.blackWire >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.blackWire} />
                    {requiredHint("photo-blackWire")}
                    <div id="field-vac4-blackWireDescription" className="mt-2">
                      <label className={fieldLabelClass("vac4-blackWireDescription")}>
                        Black wire connection description
                        <RequiredMark />
                      </label>
                      <input
                        className={fieldInputClass("vac4-blackWireDescription")}
                        placeholder="Black wire connection description"
                        value={blackWireDescription}
                        onChange={(e) => {
                          setBlackWireDescription(e.target.value);
                          clearFieldHighlight("vac4-blackWireDescription");
                        }}
                      />
                      {requiredHint("vac4-blackWireDescription")}
                    </div>
                  </div>
                  <div id="field-photo-blueWire">
                    <label className={fieldLabelClass("photo-blueWire")}>
                      Blue Wire Connection Photo
                      {blueWireRequiredUi && <RequiredMark />}
                    </label>
                    <p className="text-base text-gray-600">{blueWireHelperText}</p>
                    <input
                      id="blueWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => applyVacPhotoUpload("blueWire", e, "single")}
                    />
                    <label
                      htmlFor="blueWirePhoto"
                      className={`${photoPickClass("photo-blueWire", blueWireRequiredUi, pc.blueWire >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.blueWire} names={vacPhotoFileNames.blueWire} />
                    <PhotoUploadedBadge show={pc.blueWire >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.blueWire} />
                    {requiredHint("photo-blueWire")}
                    {blueWireRequiredUi && (
                      <div id="field-vac4-blueWireDescription" className="mt-2">
                        <label className={fieldLabelClass("vac4-blueWireDescription")}>
                          Blue wire connection description
                          <RequiredMark />
                        </label>
                        <input
                          className={fieldInputClass("vac4-blueWireDescription")}
                          placeholder="Blue wire connection description"
                          value={blueWireDescription}
                          onChange={(e) => {
                            setBlueWireDescription(e.target.value);
                            clearFieldHighlight("vac4-blueWireDescription");
                          }}
                        />
                        {requiredHint("vac4-blueWireDescription")}
                      </div>
                    )}
                    {!blueWireRequiredUi && (
                      <input
                        className={`${inputClassName} mt-2`}
                        placeholder="Blue wire connection description"
                        value={blueWireDescription}
                        onChange={(e) => setBlueWireDescription(e.target.value)}
                      />
                    )}
                  </div>
                  <div>
                    <label className={labelClassName}>
                      Purple Wire Connection Photo
                      <RequiredMark />
                    </label>
                    <p className="text-base text-gray-600">Operator presence</p>
                    <input
                      id="purpleWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      required
                      onChange={(e) => applyVacPhotoUpload("purpleWire", e, "single")}
                    />
                    <label
                      htmlFor="purpleWirePhoto"
                      className={`${photoPickClass("photo-purpleWire", false, pc.purpleWire >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.purpleWire} names={vacPhotoFileNames.purpleWire} />
                    <PhotoUploadedBadge show={pc.purpleWire >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.purpleWire} />
                    <label className={`${labelClassName} mt-2`}>
                      Purple wire connection description
                      <RequiredMark />
                    </label>
                    <input
                      className={inputClassName}
                      placeholder="Purple wire connection description"
                      value={purpleWireDescription}
                      onChange={(e) => setPurpleWireDescription(e.target.value)}
                    />
                  </div>
                  {(vac4DriveType === "Internal Combustion" ||
                    (vac4DriveType === "Electric" && liftSenseInstalled === "Yes")) && (
                    <div id="field-photo-brownWire">
                      <label className={fieldLabelClass("photo-brownWire")}>
                        Brown Wire Connection Photo
                        <RequiredMark />
                      </label>
                      <p className="text-base text-gray-600">{brownWireHelperText}</p>
                      <input
                        id="brownWirePhoto"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => applyVacPhotoUpload("brownWire", e, "single")}
                      />
                      <label
                        htmlFor="brownWirePhoto"
                        className={`${photoPickClass("photo-brownWire", true, pc.brownWire >= 1)} mb-2`}
                      >
                        📷 Take / Upload Photo
                      </label>
                      <PhotoUploadFeedback count={pc.brownWire} names={vacPhotoFileNames.brownWire} />
                      <PhotoUploadedBadge show={pc.brownWire >= 1} />
                      <PhotoFieldError message={vacPhotoErrors.brownWire} />
                      {requiredHint("photo-brownWire")}
                      <div id="field-vac4-brownWireDescription" className="mt-2">
                        <label className={fieldLabelClass("vac4-brownWireDescription")}>
                          Brown wire connection description
                          <RequiredMark />
                        </label>
                        <input
                          className={fieldInputClass("vac4-brownWireDescription")}
                          placeholder="Brown wire connection description"
                          value={brownWireDescription}
                          onChange={(e) => {
                            setBrownWireDescription(e.target.value);
                            clearFieldHighlight("vac4-brownWireDescription");
                          }}
                        />
                        {requiredHint("vac4-brownWireDescription")}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className={labelClassName}>
                      Relay Access Control Connection(s) Photo
                      <RequiredMark />
                    </label>
                    <input
                      id="relayAccessControlPhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      required
                      onChange={(e) => applyVacPhotoUpload("relayAccess", e, "single")}
                    />
                    <label
                      htmlFor="relayAccessControlPhoto"
                      className={`${photoPickClass("photo-relayAccess", false, pc.relayAccess >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.relayAccess} names={vacPhotoFileNames.relayAccess} />
                    <PhotoUploadedBadge show={pc.relayAccess >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.relayAccess} />
                    <label className={`${labelClassName} mt-2`}>
                      Relay access control connection description
                      <RequiredMark />
                    </label>
                    <input
                      className={inputClassName}
                      placeholder="Relay access control connection description"
                      value={relayAccessDescription}
                      onChange={(e) => setRelayAccessDescription(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>
                      Impact Sensor Mounting Photo
                      <RequiredMark />
                    </label>
                    <input
                      id="impactSensorMountingPhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      required
                      onChange={(e) => applyVacPhotoUpload("impactSensor", e, "single")}
                    />
                    <label
                      htmlFor="impactSensorMountingPhoto"
                      className={`${photoPickClass("photo-impactSensor", false, pc.impactSensor >= 1)} mb-2`}
                    >
                      📷 Take / Upload Photo
                    </label>
                    <PhotoUploadFeedback count={pc.impactSensor} names={vacPhotoFileNames.impactSensor} />
                    <PhotoUploadedBadge show={pc.impactSensor >= 1} />
                    <PhotoFieldError message={vacPhotoErrors.impactSensor} />
                    <label className={`${labelClassName} mt-2`}>
                      Impact sensor mounting description
                      <RequiredMark />
                    </label>
                    <input
                      className={inputClassName}
                      placeholder="Impact sensor mounting description"
                      value={impactSensorDescription}
                      onChange={(e) => setImpactSensorDescription(e.target.value)}
                    />
                  </div>
                </div>
            </section>
          </VAC4Section>
        )}

        {/* Dynamic Sections */}
        {selectedSections
          .filter((section) => section !== "VAC4")
          .map((section) => (
            <section key={section} className={cardClassName}>
              <FormSectionHeader title={`${section} Section`} tone="green" />

              <div className="space-y-5">
                <div>
                  <label className={labelClassName}>Drive Type</label>
                  <select className={selectClassName}>
                    <option>Drive Type</option>
                    <option>Electric</option>
                    <option>Internal Combustion</option>
                    <option>Other</option>
                  </select>
                </div>

                <div>
                  <label className={labelClassName}>Notes / Details</label>
                  <input className={inputClassName} placeholder="Notes / Details" />
                </div>

                <div>
                  <label className={labelClassName}>Attachments</label>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="min-h-[52px] w-full rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-base file:mr-4 file:rounded-xl file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                  />
                </div>
              </div>
            </section>
          ))}

        <div className="hidden md:flex md:flex-row md:justify-end md:gap-3 md:pt-2">
          <button type="button" className={btnSecondaryClassName}>
            <IconFloppy className="h-5 w-5" />
            Save Draft
          </button>
          <button type="button" className={btnPrimaryClassName} onClick={handleReviewClick}>
            <IconSend className="h-5 w-5" />
            Review & Submit Job Card
          </button>
        </div>
        </>
        ) : (
        <>
        <section className={cardClassName}>
          <div className="mb-3 flex items-center gap-2">
            <IconSend className="h-6 w-6 shrink-0 text-blue-600" />
            <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Review before submit</h2>
          </div>
          <p className="text-base leading-relaxed text-gray-600">
            Everything below is grouped by section. Confirm it matches the install, then confirm and submit. Photo rows list
            file names when your browser exposes them (captured on upload).
          </p>
        </section>

        <section className={cardClassName}>
          <FormSectionHeader title="Core Job Info" tone="blue" />
          <div>
            <SummaryRow label="Customer" value={coreJob.customer} />
            <SummaryRow label="Location" value={coreJob.location} />
            <SummaryRow label="Work order #" value={coreJob.workOrder} />
            <SummaryRow label="Service appointment #" value={coreJob.serviceAppointment} />
            <SummaryRow label="Unit number" value={coreJob.unitNumber} />
            <SummaryRow label="Equipment make" value={coreJob.equipmentMake} />
            <SummaryRow label="Equipment model" value={coreJob.equipmentModel} />
            <SummaryRow label="Equipment serial #" value={coreJob.equipmentSerial} />
            <SummaryRow label="Installer name" value={coreJob.installerName} />
          </div>
        </section>

        <section className={cardClassName}>
          <FormSectionHeader title="Hardware Selection" tone="green" />
          <div>
            <SummaryRow label="Primary hardware / install type" value={primary} />
            <SummaryRow label="Additional hardware being installed?" value={hasAdditional} />
            <SummaryRow label="Additional hardware types" value={additional.join(", ")} />
            <SummaryRow label="Hardware units on this card" value={selectedSections.length ? selectedSections.join(", ") : "—"} />
          </div>
        </section>

        {selectedSections
          .filter((s) => s !== "VAC4")
          .map((section) => (
            <section key={`review-hw-${section}`} className={cardClassName}>
              <FormSectionHeader title={`${section} Section`} tone="green" />
              <p className="text-sm leading-relaxed text-gray-600">
                This hardware is selected for the job card. Detailed fields for this section are filled on the form; they are
                not yet mirrored here.
              </p>
            </section>
          ))}

        {selectedSections.includes("VAC4") && (
          <section className={cardClassName}>
            <FormSectionHeader title="VAC4 details" tone="purple" />
            <div>
              <SummaryRow
                label="Vehicle type"
                value={
                  vac4VehicleType === "Other"
                    ? `${vac4VehicleType}${vac4OtherVehicleType.trim() ? ` (${vac4OtherVehicleType})` : ""}`
                    : vac4VehicleType
                }
              />
              <SummaryRow label="Drive type" value={vac4DriveType} />
              {vac4DriveType === "Electric" && (
                <>
                  <SummaryRow
                    label="Vehicle voltage"
                    value={
                      vac4VehicleVoltage === "Other"
                        ? vac4VehicleVoltageOther.trim()
                          ? `Other (${vac4VehicleVoltageOther})`
                          : "Other"
                        : vac4VehicleVoltage
                    }
                  />
                  <SummaryRow label="Lift sense installed?" value={liftSenseInstalled} />
                </>
              )}
              <SummaryRow label="Client representative approval" value={vac4ClientApproval} />
              <SummaryRow label="Hour meter (configuration)" value={vac4HourMeter} />
              <SummaryRow label="Sensor hub installed?" value={sensorHubInstalled} />
              {sensorHubInstalled === "Yes" && (
                <>
                  <SummaryRow label="Speed sense installed?" value={speedSenseInstalled} />
                  <SummaryRow label="Load sense installed?" value={loadSenseInstalled} />
                  <SummaryRow label="GPS installed?" value={gpsInstalled} />
                  <SummaryRow label="External indicator installed?" value={externalIndicatorInstalled} />
                  {speedSenseInstalled === "Yes" && (
                    <>
                      <SummaryRow label="Speed sense description" value={speedSenseDescription} />
                      <SummaryRow label="Speed sense pulse count" value={speedSensePulseCount} />
                    </>
                  )}
                  {loadSenseInstalled === "Yes" && <SummaryRow label="Load sense VAC thresholds" value={loadSenseThresholds} />}
                </>
              )}
              {(() => {
                const descriptionValues: Record<Vac4DescriptionKey, string> = {
                  redWireDescription,
                  blackWireDescription,
                  blueWireDescription,
                  purpleWireDescription,
                  brownWireDescription,
                  relayAccessDescription,
                  impactSensorDescription,
                };
                return VAC4_ORDERED_DESCRIPTION_FIELDS.map(({ key, label }) => (
                  <SummaryRow key={`vac4-desc-${key}`} label={label} value={descriptionValues[key]} />
                ));
              })()}
              <div className="border-t border-gray-100 pt-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">VAC4 photos</p>
                {VAC4_ORDERED_PHOTO_FIELDS.map(({ key, label }) => {
                  const namesValue = vacPhotoFileNames[key as Vac4OrderedPhotoKey];
                  const names = Array.isArray(namesValue) ? namesValue : [];
                  const count = countPhotoValue(namesValue);
                  return (
                    <SummaryRow
                      key={`vac4-review-photo-${key}`}
                      label={`${label} photo`}
                      value={reviewPhotoSummary(count, names)}
                    />
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <div className="hidden md:flex md:flex-row md:justify-end md:gap-3 md:pt-2">
          <button type="button" className={btnSecondaryClassName} onClick={handleBackToForm}>
            Back (edit)
          </button>
          <button type="button" className={btnPrimaryClassName} onClick={handleFinalSubmit}>
            <IconSend className="h-5 w-5" />
            Confirm & Submit
          </button>
        </div>
        </>
        )}
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 px-4 pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur-md md:hidden"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
        role="region"
        aria-label="Job card actions"
      >
        <div className="mx-auto flex max-w-4xl gap-3">
          {step === "form" ? (
            <>
              <button type="button" className={`${btnSecondaryClassName} min-w-0 flex-1 text-sm sm:text-base`}>
                <IconFloppy className="h-5 w-5 shrink-0" />
                <span className="truncate">Save Draft</span>
              </button>
              <button type="button" className={`${btnPrimaryClassName} min-w-0 flex-1 text-sm sm:text-base`} onClick={handleReviewClick}>
                <IconSend className="h-5 w-5 shrink-0" />
                <span className="line-clamp-2 text-left leading-tight">Review & Submit Job Card</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" className={`${btnSecondaryClassName} min-w-0 flex-1 text-sm sm:text-base`} onClick={handleBackToForm}>
                <span className="truncate">Back (edit)</span>
              </button>
              <button type="button" className={`${btnPrimaryClassName} min-w-0 flex-1 text-sm sm:text-base`} onClick={handleFinalSubmit}>
                <IconSend className="h-5 w-5 shrink-0" />
                <span className="line-clamp-2 text-left leading-tight">Confirm & Submit</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
