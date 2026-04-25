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
  submissionTimestamp: string;
  status: "Submitted";
  coreJobInfo: CoreJobFields;
  hardwareSelection: {
    primary: string;
    hasAdditional: string;
    additional: string[];
  };
  selectedSections: string[];
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
  };
};

export const DEFAULT_JOB_CARD_EMAIL_TO = "install-submissions@example.com";

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
  const lines: string[] = [];

  lines.push("CORE JOB INFO");
  lines.push(`  Customer: ${c.customer}`);
  lines.push(`  Location: ${c.location}`);
  lines.push(`  Work order #: ${c.workOrder}`);
  lines.push(`  Service appointment #: ${c.serviceAppointment}`);
  lines.push(`  Unit number: ${c.unitNumber}`);
  lines.push(`  Equipment make: ${c.equipmentMake}`);
  lines.push(`  Equipment model: ${c.equipmentModel}`);
  lines.push(`  Equipment serial #: ${c.equipmentSerial}`);
  lines.push(`  Installer name: ${c.installerName}`);
  lines.push("");

  lines.push("HARDWARE SELECTION");
  lines.push(`  Primary hardware: ${h.primary || "—"}`);
  lines.push(`  Additional hardware question: ${h.hasAdditional || "—"}`);
  lines.push(`  Additional types: ${h.additional.length ? h.additional.join(", ") : "—"}`);
  lines.push(`  Selected sections: ${p.selectedSections.length ? p.selectedSections.join(", ") : "—"}`);
  lines.push("");

  lines.push("VAC4");
  lines.push(`  Vehicle type: ${v.vehicleType || "—"}`);
  lines.push(`  Other vehicle type: ${v.otherVehicleType || "—"}`);
  lines.push(`  Drive type: ${v.driveType || "—"}`);
  lines.push(`  Vehicle voltage: ${v.vehicleVoltage || "—"}`);
  lines.push(`  Other vehicle voltage: ${v.vehicleVoltageOther || "—"}`);
  lines.push(`  Client approval: ${v.clientApproval || "—"}`);
  lines.push(`  Hour meter: ${v.hourMeter || "—"}`);
  lines.push(`  Sensor hub installed: ${v.sensorHubInstalled || "—"}`);
  lines.push(`  Lift sense installed: ${v.liftSenseInstalled || "—"}`);
  lines.push(`  Speed sense installed: ${v.speedSenseInstalled || "—"}`);
  lines.push(`  Load sense installed: ${v.loadSenseInstalled || "—"}`);
  lines.push(`  GPS installed: ${v.gpsInstalled || "—"}`);
  lines.push(`  External indicator installed: ${v.externalIndicatorInstalled || "—"}`);
  lines.push(`  Speed sense description: ${v.speedSenseDescription || "—"}`);
  lines.push(`  Speed sense pulse count: ${v.speedSensePulseCount || "—"}`);
  lines.push(`  Load sense VAC thresholds: ${v.loadSenseThresholds || "—"}`);
  lines.push("");
  lines.push("  VAC4 ordered wire descriptions:");
  VAC4_ORDERED_DESCRIPTION_FIELDS.forEach(({ key, label }) => {
    const value = v[key];
    lines.push(`    ${label}: ${value?.trim() ? value : "—"}`);
  });
  lines.push("");
  lines.push("  VAC4 ordered photo details:");
  VAC4_ORDERED_PHOTO_FIELDS.forEach(({ key, label }) => {
    const photoValue = v.photoFileNames[key];
    const count = countPhotoValue(photoValue);
    const fileNames = photoValue.length ? photoValue.join(", ") : "—";
    lines.push(`    ${label} photo count: ${count}`);
    lines.push(`    ${label} photo file names: ${fileNames}`);
  });
  lines.push("");
  lines.push(`Submission timestamp: ${p.submissionTimestamp}`);
  lines.push(`Status: ${p.status}`);

  return lines.join("\n");
}
