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

export type JobCardSubmissionPayload = {
  submissionId: string;
  submissionTimestamp: string;
  status: "Submitted";
  coreJobInfo: CoreJobFields;
  hardwareSelection: {
    primary: string;
    hasAdditional: string;
    additional: string[];
  };
  selectedSections: string[];
  photoUploads: UploadedPhotoMetadata[];
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
  group: "vac4" | "vehicle";
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
  { key: "redWireDescription", label: "Red wire description" },
  { key: "blackWireDescription", label: "Black wire description" },
  { key: "blueWireDescription", label: "Blue wire description" },
  { key: "purpleWireDescription", label: "Purple wire description" },
  { key: "brownWireDescription", label: "Brown wire description" },
  { key: "relayAccessDescription", label: "Relay access control description" },
  { key: "impactSensorDescription", label: "Impact sensor mounting description" },
];

export const VAC4_ORDERED_PHOTO_FIELDS: ReadonlyArray<{
  key: Vac4OrderedPhotoKey;
  label: string;
  descriptionField?: Vac4DescriptionKey;
}> = [
  { key: "vacMounting", label: "VAC mounting" },
  { key: "wirePath", label: "Wire path" },
  { key: "redWire", label: "Red wire", descriptionField: "redWireDescription" },
  { key: "blackWire", label: "Black wire", descriptionField: "blackWireDescription" },
  { key: "blueWire", label: "Blue wire", descriptionField: "blueWireDescription" },
  { key: "purpleWire", label: "Purple wire", descriptionField: "purpleWireDescription" },
  { key: "brownWire", label: "Brown wire", descriptionField: "brownWireDescription" },
  { key: "relayAccess", label: "Relay access control", descriptionField: "relayAccessDescription" },
  { key: "impactSensor", label: "Impact sensor mounting", descriptionField: "impactSensorDescription" },
  { key: "sensorHubMounting", label: "Sensor hub mounting" },
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
  const u = unitNumber.trim() || "—";
  return `Installer Job Card - ${c} - ${u}`;
}

export function formatEmailBodyFromPayload(p: JobCardSubmissionPayload): string {
  const c = p.coreJobInfo;
  const h = p.hardwareSelection;
  const v = p.vac4;
  const textOrDash = (value: string | undefined) => (value && value.trim() ? value.trim() : "—");
  const appUrl = resolvePublicAppUrl();
  const photoGalleryUrl = `${appUrl}/photos/${encodeURIComponent(p.submissionId)}`;
  const divider = "--------------------------------";
  const orderedDescriptions = VAC4_ORDERED_DESCRIPTION_FIELDS.reduce<Record<Vac4DescriptionKey, string>>(
    (acc, { key }) => {
      acc[key] = textOrDash(v[key]);
      return acc;
    },
    {
      redWireDescription: "—",
      blackWireDescription: "—",
      blueWireDescription: "—",
      purpleWireDescription: "—",
      brownWireDescription: "—",
      relayAccessDescription: "—",
      impactSensorDescription: "—",
    },
  );
  const photoLinesByKey = VAC4_ORDERED_PHOTO_FIELDS.reduce<Record<Vac4OrderedPhotoKey, string>>(
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
  const lines: string[] = [];

  lines.push("INSTALLER JOB CARD");
  lines.push("");
  lines.push(`Submission ID: ${textOrDash(p.submissionId)}`);
  lines.push(`Customer: ${textOrDash(c.customer)}`);
  lines.push(`Location: ${textOrDash(c.location)}`);
  lines.push(`Work Order #: ${textOrDash(c.workOrder)}`);
  lines.push(`Service Appointment #: ${textOrDash(c.serviceAppointment)}`);
  lines.push(`Unit #: ${textOrDash(c.unitNumber)}`);
  lines.push(`Installer: ${textOrDash(c.installerName)}`);
  lines.push(`Submitted: ${p.submissionTimestamp}`);
  lines.push("");
  lines.push(divider);
  lines.push("");
  lines.push("VEHICLE INFORMATION");
  lines.push(`Make: ${textOrDash(c.equipmentMake)}`);
  lines.push(`Model: ${textOrDash(c.equipmentModel)}`);
  lines.push(`Serial #: ${textOrDash(c.equipmentSerial)}`);
  lines.push(
    `Vehicle Type: ${
      v.vehicleType === "Other" ? `${textOrDash(v.vehicleType)} (${textOrDash(v.otherVehicleType)})` : textOrDash(v.vehicleType)
    }`,
  );
  lines.push(`Drive Type: ${textOrDash(v.driveType)}`);
  lines.push(
    `Voltage: ${
      v.vehicleVoltage === "Other"
        ? `Other (${textOrDash(v.vehicleVoltageOther)})`
        : textOrDash(v.vehicleVoltage)
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
  lines.push("VAC4 INSTALL");
  lines.push(`Client Approval: ${textOrDash(v.clientApproval)}`);
  lines.push(`Hour Meter: ${textOrDash(v.hourMeter)}`);
  lines.push(`Sensor Hub: ${textOrDash(v.sensorHubInstalled)}`);
  lines.push(`Lift Sense: ${textOrDash(v.liftSenseInstalled)}`);
  lines.push("");
  lines.push(`Red Wire: ${orderedDescriptions.redWireDescription}`);
  lines.push(`Black Wire: ${orderedDescriptions.blackWireDescription}`);
  lines.push(`Blue Wire: ${orderedDescriptions.blueWireDescription}`);
  lines.push(`Purple Wire: ${orderedDescriptions.purpleWireDescription}`);
  lines.push(`Brown Wire: ${orderedDescriptions.brownWireDescription}`);
  lines.push(`Relay Access: ${orderedDescriptions.relayAccessDescription}`);
  lines.push(`Impact Sensor: ${orderedDescriptions.impactSensorDescription}`);
  lines.push("");
  lines.push(divider);
  lines.push("");
  lines.push("PHOTO GALLERY");
  lines.push(photoGalleryUrl);
  lines.push("");
  lines.push(divider);
  lines.push("");
  lines.push("PHOTOS");
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

  return lines.join("\n");
}
