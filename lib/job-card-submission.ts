import { formatServiceAppointment, formatUpper, formatWorkOrder } from "@/lib/format";

export type VacPhotoFileNames = {
  vacMounting: string[];
  wirePath: string[];
  redWire: string[];
  blackWire: string[];
  blueWire: string[];
  brownWire: string[];
  sensorHubMounting: string[];
  speedSense: string[];
  loadSense: string[];
  gps: string[];
  externalIndicator: string[];
  purpleWire: string[];
  relayAccess: string[];
  impactSensor: string[];
};

export type CoreJobFields = {
  customer: string;
  location: string;
  workOrder: string;
  serviceAppointment: string;
  unitNumber: string;
  equipmentMake: string;
  equipmentModel: string;
  equipmentSerial: string;
  installerName: string;
};

/** Metadata for uploaded PPD JSON config (Supabase Storage + site repository). */
export type JobCardPpdJsonConfigFile = {
  fileName: string;
  storagePath: string;
  publicUrl: string;
  customerId: string | null;
  projectId: string;
  companyId: string;
  make: string;
  model: string;
  unitNumber: string;
  notes: string;
  uploadedAt: string;
};

/** Form snapshot for email / preview (make/model/unit/notes alongside JSON file). */
export type JobCardPpdJsonConfigForm = {
  make: string;
  model: string;
  unitNumber: string;
  notes: string;
};

/** PPD text fields included on submission when PPD hardware is selected. */
export type JobCardPpdPayload = {
  hubSerial: string;
  cameraLocations: string[];
  cameraSerialsByLocation: Record<string, string>;
  monitorInstalled: string;
  customBracketsNeeded: string;
  customBracketNotes: string;
  clientApproval: string;
  /** Display / legacy: human-readable file name (selected upload or typed label). */
  jsonFileName: string;
  /** Set after successful upload with submission email. */
  jsonConfigFile?: JobCardPpdJsonConfigFile;
  /** Mirrors PPD JSON section fields for email when upload not yet stored. */
  jsonConfigForm?: JobCardPpdJsonConfigForm;
  relaysUsedForSpeedControl: string;
  redWireDescription: string;
  blackWireDescription: string;
  yellowWireDescription: string;
  greyWireDescription: string;
  blueWireDescription: string;
  powerConverterDescription: string;
  redAlarmOutDescription: string;
  yellowAlarmOutDescription: string;
  blackAlarmGroundDescription: string;
};

/** CP4 text fields included on submission when CP4 hardware is selected. */
export type JobCardCp4Payload = {
  drid: string;
  serial: string;
  cameraQuantity: string;
  monitorInstalled: string;
  clientApproval: string;
  customBracketsNeeded: string;
  customBracketNotes: string;
  alarmIn1RelayInstalled: string;
  alarmIn1Description: string;
  alarmIn2RelayInstalled: string;
  alarmIn2Description: string;
  hubMountingDescription: string;
  microphoneMountingDescription: string;
  remoteControlMountingDescription: string;
  gpsSensorMountingDescription: string;
  redWireDescription: string;
  blackWireDescription: string;
  whiteWireDescription: string;
  monitorMountingDescription: string;
  powerConverterDescription: string;
};

export type JobCardSubmissionPayload = {
  submissionId: string;
  submissionTimestamp: string;
  status: "Submitted";
  companyId?: string;
  projectId?: string;
  projectName?: string;
  projectRecipientEmails?: string[];
  coreJobInfo: CoreJobFields;
  hardwareSelection: {
    primary: string;
    hasAdditional: string;
    additional: string[];
  };
  selectedSections: string[];
  photoUploads: UploadedPhotoMetadata[];
  ppd?: JobCardPpdPayload;
  cp4?: JobCardCp4Payload;
  vac4: {
    vehicleType: string;
    otherVehicleType: string;
    driveType: string;
    vehicleVoltage: string;
    vehicleVoltageOther: string;
    clientApproval: string;
    hourMeter: string;
    sensorHubInstalled: string;
    liftSenseInstalled: string;
    operatorPresenceInstalled?: string;
    speedSenseInstalled: string;
    loadSenseInstalled: string;
    gpsInstalled: string;
    externalIndicatorInstalled: string;
    speedSenseDescription: string;
    speedSensePulseCount: string;
    loadSenseThresholds: string;
    redWireDescription: string;
    blackWireDescription: string;
    blueWireDescription: string;
    brownWireDescription: string;
    purpleWireDescription?: string;
    relayAccessDescription?: string;
    impactSensorDescription?: string;
    photoCounts: Record<string, number>;
    photoFileNames: VacPhotoFileNames;
    photoUrls: VacPhotoFileNames;
  };
};

export type UploadedPhotoMetadata = {
  fieldName: string;
  group: "vac4" | "vehicle" | "ppd" | "cp4";
  label: string;
  filename: string;
  storagePath: string;
  publicUrl: string;
  uploadedAt: string;
};

export const DEFAULT_JOB_CARD_EMAIL_TO = "install-submissions@example.com";
const DEFAULT_APP_URL = "https://install.tkptelematics.com";

function resolvePublicAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (!raw) return DEFAULT_APP_URL;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return DEFAULT_APP_URL;
    if (host.endsWith(".vercel.app")) return DEFAULT_APP_URL;
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return DEFAULT_APP_URL;
  }
}

export type Vac4OrderedPhotoKey =
  | "vacMounting"
  | "wirePath"
  | "redWire"
  | "blackWire"
  | "blueWire"
  | "purpleWire"
  | "brownWire"
  | "relayAccess"
  | "impactSensor"
  | "sensorHubMounting"
  | "speedSense"
  | "loadSense"
  | "gps"
  | "externalIndicator";

export type Vac4DescriptionKey =
  | "redWireDescription"
  | "blackWireDescription"
  | "blueWireDescription"
  | "purpleWireDescription"
  | "brownWireDescription"
  | "relayAccessDescription"
  | "impactSensorDescription";

export const VAC4_ORDERED_DESCRIPTION_FIELDS: ReadonlyArray<{
  key: Vac4DescriptionKey;
  label: string;
}> = [
  { key: "redWireDescription", label: "Red (+) — connection note" },
  { key: "blackWireDescription", label: "Black (−) — connection note" },
  { key: "blueWireDescription", label: "Blue — connection note" },
  { key: "purpleWireDescription", label: "Purple — connection note" },
  { key: "brownWireDescription", label: "Brown — connection note" },
  { key: "relayAccessDescription", label: "Relay access — connection note" },
  { key: "impactSensorDescription", label: "Impact sensor — mounting note" },
];

export const VAC4_ORDERED_PHOTO_FIELDS: ReadonlyArray<{
  key: Vac4OrderedPhotoKey;
  label: string;
  descriptionField?: Vac4DescriptionKey;
}> = [
  { key: "vacMounting", label: "VAC4 mounting" },
  { key: "wirePath", label: "Wire path" },
  { key: "redWire", label: "Red (+) battery", descriptionField: "redWireDescription" },
  { key: "blackWire", label: "Black (−) battery", descriptionField: "blackWireDescription" },
  { key: "blueWire", label: "Blue wire", descriptionField: "blueWireDescription" },
  { key: "purpleWire", label: "Purple wire", descriptionField: "purpleWireDescription" },
  { key: "brownWire", label: "Brown wire", descriptionField: "brownWireDescription" },
  { key: "relayAccess", label: "Relay access", descriptionField: "relayAccessDescription" },
  { key: "impactSensor", label: "Impact sensor", descriptionField: "impactSensorDescription" },
  { key: "sensorHubMounting", label: "Sensor hub" },
  { key: "speedSense", label: "Speed sense" },
  { key: "loadSense", label: "Load sense" },
  { key: "gps", label: "GPS" },
  { key: "externalIndicator", label: "External indicator" },
];

function countPhotoValue(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") return value.trim() ? 1 : 0;
  return 0;
}

export function formatEmailSubject(customer: string, unitNumber: string) {
  const c = customer.trim() || "Unknown";
  const u = formatUpper(unitNumber) || "—";
  return `Installer Job Card - ${c} - ${u}`;
}

function formatPhotoGroupSummaryLines(uploads: UploadedPhotoMetadata[], group: "ppd" | "cp4"): string[] {
  const rows = uploads.filter((u) => u.group === group);
  if (rows.length === 0) return ["None uploaded"];
  const byField = new Map<string, UploadedPhotoMetadata[]>();
  for (const u of rows) {
    const k = u.fieldName;
    const list = byField.get(k) ?? [];
    list.push(u);
    byField.set(k, list);
  }
  return [...byField.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fieldName, items]) => {
      const label = items[0]?.label?.trim() || fieldName;
      const names = items.map((i) => i.filename.trim()).filter(Boolean);
      const count = names.length;
      return `${label}: ${count > 0 ? `${count} file${count === 1 ? "" : "s"} (${names.join(", ")})` : "None uploaded"}`;
    });
}

function formatPpdInstallLines(ppd: JobCardPpdPayload): string[] {
  const textOrDash = (value: string | undefined) => (value && value.trim() ? value.trim() : "—");
  const displayValue = (value: string | undefined | null) => (value && value.trim() ? value.trim() : "Not Installed");
  const lines: string[] = [];
  lines.push(`Hub serial: ${textOrDash(ppd.hubSerial)}`);
  const locs = Array.isArray(ppd.cameraLocations) ? ppd.cameraLocations : [];
  lines.push(
    `Camera locations: ${locs.length ? locs.map((l) => String(l).trim()).filter(Boolean).join(", ") : "—"}`,
  );
  const serials = ppd.cameraSerialsByLocation && typeof ppd.cameraSerialsByLocation === "object" ? ppd.cameraSerialsByLocation : {};
  for (const loc of locs) {
    const key = String(loc);
    const serial = serials[key];
    lines.push(`  ${key}: camera serial ${textOrDash(serial)}`);
  }
  lines.push(`Monitor installed: ${displayValue(ppd.monitorInstalled)}`);
  lines.push(`Custom brackets needed: ${displayValue(ppd.customBracketsNeeded)}`);
  lines.push(`Custom bracket notes: ${textOrDash(ppd.customBracketNotes)}`);
  lines.push(`Client approval: ${textOrDash(ppd.clientApproval)}`);
  lines.push(`JSON file name: ${textOrDash(ppd.jsonFileName)}`);
  if (ppd.jsonConfigFile) {
    const j = ppd.jsonConfigFile;
    lines.push(`PPD JSON — make: ${textOrDash(j.make)}`);
    lines.push(`PPD JSON — model: ${textOrDash(j.model)}`);
    lines.push(`PPD JSON — unit #: ${textOrDash(j.unitNumber)}`);
    if (j.notes?.trim()) lines.push(`PPD JSON — notes: ${textOrDash(j.notes)}`);
    lines.push(`PPD JSON file (uploaded): ${textOrDash(j.fileName)}`);
    lines.push(`PPD JSON storage path: ${textOrDash(j.storagePath)}`);
    if (j.publicUrl?.trim()) lines.push(`PPD JSON link: ${j.publicUrl.trim()}`);
    lines.push(`PPD JSON uploaded: ${textOrDash(j.uploadedAt)}`);
  } else if (ppd.jsonConfigForm) {
    const jf = ppd.jsonConfigForm;
    lines.push(`PPD JSON — make: ${textOrDash(jf.make)}`);
    lines.push(`PPD JSON — model: ${textOrDash(jf.model)}`);
    lines.push(`PPD JSON — unit #: ${textOrDash(jf.unitNumber)}`);
    if (jf.notes?.trim()) lines.push(`PPD JSON — notes: ${textOrDash(jf.notes)}`);
  }
  lines.push(`Relays used for speed control: ${displayValue(ppd.relaysUsedForSpeedControl)}`);
  lines.push(`Red wire: ${displayValue(ppd.redWireDescription)}`);
  lines.push(`Black wire: ${displayValue(ppd.blackWireDescription)}`);
  lines.push(`Yellow wire: ${displayValue(ppd.yellowWireDescription)}`);
  lines.push(`Grey wire: ${displayValue(ppd.greyWireDescription)}`);
  lines.push(`Blue wire: ${displayValue(ppd.blueWireDescription)}`);
  lines.push(`Power converter: ${displayValue(ppd.powerConverterDescription)}`);
  lines.push(`Red alarm out: ${displayValue(ppd.redAlarmOutDescription)}`);
  lines.push(`Yellow alarm out: ${displayValue(ppd.yellowAlarmOutDescription)}`);
  lines.push(`Black alarm ground: ${displayValue(ppd.blackAlarmGroundDescription)}`);
  return lines;
}

function formatCp4InstallLines(cp4: JobCardCp4Payload): string[] {
  const textOrDash = (value: string | undefined) => (value && value.trim() ? value.trim() : "—");
  const displayValue = (value: string | undefined | null) => (value && value.trim() ? value.trim() : "Not Installed");
  const lines: string[] = [];
  lines.push(`DRID: ${textOrDash(cp4.drid)}`);
  lines.push(`CP4 serial: ${textOrDash(cp4.serial)}`);
  lines.push(`Quantity of cameras: ${textOrDash(cp4.cameraQuantity)}`);
  lines.push(`Monitor installed: ${displayValue(cp4.monitorInstalled)}`);
  lines.push(`Client approval: ${textOrDash(cp4.clientApproval)}`);
  lines.push(`Custom brackets needed: ${displayValue(cp4.customBracketsNeeded)}`);
  lines.push(`Custom bracket notes: ${textOrDash(cp4.customBracketNotes)}`);
  lines.push(`Alarm IN 1 relay installed: ${displayValue(cp4.alarmIn1RelayInstalled)}`);
  lines.push(`Alarm IN 1 description: ${textOrDash(cp4.alarmIn1Description)}`);
  lines.push(`Alarm IN 2 relay installed: ${displayValue(cp4.alarmIn2RelayInstalled)}`);
  lines.push(`Alarm IN 2 description: ${textOrDash(cp4.alarmIn2Description)}`);
  lines.push(`Hub / DVR mounting: ${textOrDash(cp4.hubMountingDescription)}`);
  lines.push(`Microphone mounting: ${textOrDash(cp4.microphoneMountingDescription)}`);
  lines.push(`Remote control mounting: ${textOrDash(cp4.remoteControlMountingDescription)}`);
  lines.push(`GPS sensor mounting: ${textOrDash(cp4.gpsSensorMountingDescription)}`);
  lines.push(`Red battery wire: ${textOrDash(cp4.redWireDescription)}`);
  lines.push(`Black battery wire: ${textOrDash(cp4.blackWireDescription)}`);
  lines.push(`White ignition wire: ${textOrDash(cp4.whiteWireDescription)}`);
  lines.push(`Monitor mounting: ${textOrDash(cp4.monitorMountingDescription)}`);
  lines.push(`Power converter: ${textOrDash(cp4.powerConverterDescription)}`);
  return lines;
}

export function formatEmailBodyFromPayload(p: JobCardSubmissionPayload): string {
  const c = p.coreJobInfo;
  const h = p.hardwareSelection;
  const v = p.vac4;
  const sectionSet = new Set(p.selectedSections ?? []);
  const includeVac4 = sectionSet.has("VAC4");
  const includePpd = sectionSet.has("PPD");
  const includeCp4 = sectionSet.has("CP4");

  const textOrDash = (value: string | undefined) => (value && value.trim() ? value.trim() : "—");
  const displayValue = (value: string | undefined | null) => (value && value.trim() ? value.trim() : "Not Installed");
  const displayUppercase = (value: string | undefined | null) => {
    const shown = formatUpper(value) || "Not Installed";
    return shown === "Not Installed" ? shown : shown.toUpperCase();
  };
  const appUrl = resolvePublicAppUrl();
  const photoGalleryUrl = `${appUrl}/photos/${encodeURIComponent(p.submissionId)}`;
  const divider = "--------------------------------";

  let orderedDescriptions: Record<Vac4DescriptionKey, string> | null = null;
  let photoLinesByKey: Record<Vac4OrderedPhotoKey, string> | null = null;
  if (includeVac4) {
    orderedDescriptions = VAC4_ORDERED_DESCRIPTION_FIELDS.reduce<Record<Vac4DescriptionKey, string>>(
      (acc, { key }) => {
        acc[key] = displayValue(v[key]);
        return acc;
      },
      {
        redWireDescription: "Not Installed",
        blackWireDescription: "Not Installed",
        blueWireDescription: "Not Installed",
        purpleWireDescription: "Not Installed",
        brownWireDescription: "Not Installed",
        relayAccessDescription: "Not Installed",
        impactSensorDescription: "Not Installed",
      },
    );
    photoLinesByKey = VAC4_ORDERED_PHOTO_FIELDS.reduce<Record<Vac4OrderedPhotoKey, string>>(
      (acc, { key }) => {
        const names = v.photoFileNames[key];
        const count = countPhotoValue(names);
        acc[key] = count > 0 ? `${count} file${count === 1 ? "" : "s"} (${names.join(", ")})` : "None uploaded";
        return acc;
      },
      {
        vacMounting: "None uploaded",
        wirePath: "None uploaded",
        redWire: "None uploaded",
        blackWire: "None uploaded",
        blueWire: "None uploaded",
        purpleWire: "None uploaded",
        brownWire: "None uploaded",
        relayAccess: "None uploaded",
        impactSensor: "None uploaded",
        sensorHubMounting: "None uploaded",
        speedSense: "None uploaded",
        loadSense: "None uploaded",
        gps: "None uploaded",
        externalIndicator: "None uploaded",
      },
    );
  }

  const lines: string[] = [];

  lines.push("INSTALLER JOB CARD");
  lines.push("");
  lines.push(`Submission ID: ${textOrDash(p.submissionId)}`);
  lines.push(`Customer: ${textOrDash(c.customer)}`);
  lines.push(`Location: ${textOrDash(c.location)}`);
  lines.push(`Work Order #: ${formatWorkOrder(c.workOrder) || "Not Installed"}`);
  lines.push(`Service Appointment #: ${formatServiceAppointment(c.serviceAppointment) || "Not Installed"}`);
  lines.push(`Unit #: ${displayUppercase(c.unitNumber)}`);
  lines.push(`Installer: ${textOrDash(c.installerName)}`);
  lines.push(`Submitted: ${p.submissionTimestamp}`);
  lines.push("");
  lines.push(divider);
  lines.push("");
  lines.push("VEHICLE INFORMATION");
  lines.push(`Make: ${textOrDash(c.equipmentMake)}`);
  lines.push(`Model: ${displayUppercase(c.equipmentModel)}`);
  lines.push(`Serial #: ${displayUppercase(c.equipmentSerial)}`);
  lines.push(
    `Vehicle Type: ${
      v.vehicleType === "Other" ? `${displayValue(v.vehicleType)} (${displayValue(v.otherVehicleType)})` : displayValue(v.vehicleType)
    }`,
  );
  lines.push(`Drive Type: ${displayValue(v.driveType)}`);
  lines.push(
    `Voltage: ${
      v.vehicleVoltage === "Other"
        ? `Other (${displayValue(v.vehicleVoltageOther)})`
        : displayValue(v.vehicleVoltage)
    }`,
  );
  lines.push("");
  lines.push(divider);
  lines.push("");
  lines.push("HARDWARE");
  lines.push(`Primary: ${textOrDash(h.primary)}`);
  lines.push(
    `Additional Hardware: ${
      h.hasAdditional === "Yes" ? (h.additional.length ? h.additional.join(", ") : "Yes") : textOrDash(h.hasAdditional)
    }`,
  );
  lines.push("");
  lines.push(divider);
  lines.push("");

  if (includeVac4 && orderedDescriptions && photoLinesByKey) {
    lines.push("VAC4 INSTALL");
    lines.push(`Client Approval: ${displayValue(v.clientApproval)}`);
    lines.push(`Hour Meter: ${textOrDash(v.hourMeter)}`);
    lines.push(`Sensor Hub: ${displayValue(v.sensorHubInstalled)}`);
    lines.push(`Lift Sense: ${displayValue(v.liftSenseInstalled)}`);
    lines.push(`Operator Presence: ${displayValue(v.operatorPresenceInstalled)}`);
    lines.push(`Speed Sense: ${displayValue(v.speedSenseInstalled)}`);
    lines.push(`Load Sense: ${displayValue(v.loadSenseInstalled)}`);
    lines.push(`GPS: ${displayValue(v.gpsInstalled)}`);
    lines.push(`External Indicator: ${displayValue(v.externalIndicatorInstalled)}`);
    lines.push("");
    lines.push(`Red Wire: ${orderedDescriptions.redWireDescription}`);
    lines.push(`Black Wire: ${orderedDescriptions.blackWireDescription}`);
    lines.push(`Blue Wire: ${orderedDescriptions.blueWireDescription}`);
    lines.push(`Purple Wire: ${orderedDescriptions.purpleWireDescription}`);
    lines.push(`Brown Wire: ${orderedDescriptions.brownWireDescription}`);
    lines.push(`Relay Access: ${orderedDescriptions.relayAccessDescription}`);
    lines.push(`Impact Sensor: ${orderedDescriptions.impactSensorDescription}`);
    lines.push(`Speed Sense Description: ${displayValue(v.speedSenseDescription)}`);
    lines.push(`Speed Sense Pulse Count: ${displayValue(v.speedSensePulseCount)}`);
    lines.push(`Load Sense Thresholds: ${displayValue(v.loadSenseThresholds)}`);
    lines.push("");
    lines.push(divider);
    lines.push("");
  }

  if (includePpd && p.ppd) {
    lines.push("PPD INSTALL");
    lines.push(...formatPpdInstallLines(p.ppd));
    lines.push("");
    lines.push(divider);
    lines.push("");
  }

  if (includeCp4 && p.cp4) {
    lines.push("CP4 INSTALL");
    lines.push(...formatCp4InstallLines(p.cp4));
    lines.push("");
    lines.push(divider);
    lines.push("");
  }

  lines.push("PHOTO GALLERY");
  lines.push(photoGalleryUrl);
  lines.push("");
  lines.push(divider);
  lines.push("");
  lines.push("PHOTOS");

  if (includeVac4 && photoLinesByKey) {
    lines.push(`VAC Mount: ${photoLinesByKey.vacMounting}`);
    lines.push(`Wire Path: ${photoLinesByKey.wirePath}`);
    lines.push(`Red Wire: ${photoLinesByKey.redWire}`);
    lines.push(`Black Wire: ${photoLinesByKey.blackWire}`);
    lines.push(`Blue Wire: ${photoLinesByKey.blueWire}`);
    lines.push(`Purple Wire: ${photoLinesByKey.purpleWire}`);
    lines.push(`Brown Wire: ${photoLinesByKey.brownWire}`);
    lines.push(`Relay Access: ${photoLinesByKey.relayAccess}`);
    lines.push(`Impact Sensor: ${photoLinesByKey.impactSensor}`);
    lines.push(`Sensor Hub: ${photoLinesByKey.sensorHubMounting}`);
    lines.push(`Speed Sense: ${photoLinesByKey.speedSense}`);
    lines.push(`Load Sense: ${photoLinesByKey.loadSense}`);
    lines.push(`GPS: ${photoLinesByKey.gps}`);
    lines.push(`External Indicator: ${photoLinesByKey.externalIndicator}`);
  }

  if (includePpd) {
    if (includeVac4) {
      lines.push("");
    }
    lines.push("PPD PHOTOS (metadata)");
    lines.push(...formatPhotoGroupSummaryLines(p.photoUploads, "ppd"));
  }

  if (includeCp4) {
    if (includeVac4 || includePpd) {
      lines.push("");
    }
    lines.push("CP4 PHOTOS (metadata)");
    lines.push(...formatPhotoGroupSummaryLines(p.photoUploads, "cp4"));
  }

  return lines.join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatEmailHtmlFromPayload(p: JobCardSubmissionPayload): string {
  const text = formatEmailBodyFromPayload(p);
  const escaped = escapeHtml(text);
  const highlighted = escaped.replaceAll(
    "Not Installed",
    '<span style="color:#b91c1c;font-weight:700;">Not Installed</span>',
  );
  return `<div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.45;">${highlighted}</div>`;
}
