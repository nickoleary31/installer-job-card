/**
 * Structured job-card document for HTML + plain-text email (shared preview/send).
 */

import { formatServiceAppointment, formatUpper, formatWorkOrder } from "./format";
import {
  formatSectionKeysAsLabels,
  getFormDefinitionById,
  getFormLabelBySectionKey,
  selectedSectionsIncludeEffective,
} from "./form-registry";
import { isLinxUpSectionKey } from "./linxup";
import {
  formatSectionKeysAsLabelsWithLookup,
  getProductLabelWithLookup,
} from "./product-config/product-lookup";
import type { JobCardSubmissionPayload } from "./job-card-submission";
import { PPD_JSON_FILE_KEY } from "./product-files/types";

export type EmailLayoutOptions = {
  /**
   * When true (Email Preview), include usable Product File download links.
   * Outbound email should omit storage URLs (attachments or omit links) so
   * stripStorageUrls / send guards remain valid.
   */
  includeProductFileLinks?: boolean;
};

export type EmailLayoutField = {
  label: string;
  value: string;
};

export type EmailLayoutSection = {
  id: string;
  title: string;
  fields: EmailLayoutField[];
};

export type EmailLayoutHeader = {
  title: string;
  productName: string;
  customer: string;
  assetNumber: string;
  submittedAt: string;
  installer: string;
};

export type EmailLayoutDocument = {
  header: EmailLayoutHeader;
  sections: EmailLayoutSection[];
  submissionId: string;
  formId?: string;
};

function dash(value: string | undefined | null): string {
  const v = (value || "").trim();
  return v || "—";
}

function display(value: string | undefined | null): string {
  const v = (value || "").trim();
  return v || "Not Installed";
}

function displayUpper(value: string | undefined | null): string {
  const u = formatUpper(value) || "";
  return u || "Not Installed";
}

function formatSubmittedAt(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function detectLinxUp(p: JobCardSubmissionPayload): boolean {
  const h = p.hardwareSelection;
  return (
    !!p.linxup ||
    isLinxUpSectionKey(h.primary) ||
    (p.formId ? p.formId.startsWith("linxup_") : false) ||
    (p.submissionType ? p.submissionType.startsWith("linxup_") : false) ||
    (p.selectedSections ?? []).some((s) => isLinxUpSectionKey(s))
  );
}

function productName(p: JobCardSubmissionPayload): string {
  return (
    p.linxup?.productLabel?.trim() ||
    getProductLabelWithLookup(p.hardwareSelection?.primary, p.productDisplay) ||
    getFormLabelBySectionKey(p.hardwareSelection?.primary) ||
    getFormDefinitionById(p.formId)?.label ||
    getFormDefinitionById(p.submissionType)?.label ||
    p.submissionType?.trim() ||
    p.formId?.trim() ||
    p.hardwareSelection.primary?.trim() ||
    "Job Card"
  );
}

function buildLinxUpDocument(p: JobCardSubmissionPayload): EmailLayoutDocument {
  const lx = p.linxup;
  const c = p.coreJobInfo;
  const pname = productName(p);
  const sections: EmailLayoutSection[] = [
    {
      id: "core",
      title: "Core Job Information",
      fields: [
        { label: "Customer", value: dash(lx?.customer || c.customer) },
        { label: "Location", value: dash(lx?.location || c.location) },
        { label: "Primary Contact", value: dash(lx?.primaryContact || c.primaryContact) },
        { label: "Contact Number", value: dash(lx?.contactNumber || c.contactNumber) },
        { label: "Contact Email", value: dash(lx?.contactEmail || c.contactEmail) },
        { label: "Installer", value: dash(c.installerName) },
      ],
    },
    {
      id: "vehicle",
      title: "Vehicle / Asset Information",
      fields: [
        { label: "Year", value: dash(lx?.year) },
        { label: "Make", value: dash(lx?.make || c.equipmentMake) },
        { label: "Model", value: displayUpper(lx?.model || c.equipmentModel) },
        { label: "Serial/VIN", value: displayUpper(lx?.serialVin || c.equipmentSerial) },
        { label: "Asset Number", value: displayUpper(lx?.assetNumber || c.unitNumber) },
        { label: "Vehicle Type", value: dash(lx?.vehicleType) },
        { label: "Hours/Miles", value: dash(lx?.hoursMiles) },
      ],
    },
  ];

  const formId = lx?.formId || p.formId || "";
  const hasAssetTracker =
    formId === "linxup_asset_tracker" ||
    !!(lx?.powerConnectionDescription || lx?.groundConnectionDescription || lx?.ignitionConnectionDescription);
  const vt = lx?.vehicleTracker;
  const hasVehicleTracker = formId === "linxup_vehicle_tracker" || !!vt;
  const lc = lx?.linxCam;
  const hasLinxCam = formId === "linxup_linxcam" || !!lc;

  if (hasAssetTracker) {
    sections.push({
      id: "product",
      title: pname,
      fields: [
        { label: "Power connection", value: display(lx?.powerConnectionDescription) },
        { label: "Ground connection", value: display(lx?.groundConnectionDescription) },
        { label: "Ignition connection", value: display(lx?.ignitionConnectionDescription) },
      ],
    });
  }

  if (hasVehicleTracker && vt) {
    const fields: EmailLayoutField[] = [
      { label: "Connected via OBD Port", value: dash(vt.obdPortConnected) },
    ];
    if (vt.obdPortConnected === "No") {
      fields.push(
        { label: "Power connection", value: display(vt.powerConnectionDescription) },
        { label: "Ground connection", value: display(vt.groundConnectionDescription) },
        { label: "Ignition connection", value: display(vt.ignitionConnectionDescription) },
      );
    }
    fields.push({ label: "Installation notes", value: display(vt.installationNotes) });
    sections.push({ id: "product", title: pname, fields });
  }

  if (hasLinxCam && lc) {
    const fields: EmailLayoutField[] = [
      { label: "Connected via OBD Port", value: dash(lc.obdPortConnected) },
    ];
    if (lc.obdPortConnected === "No") {
      fields.push(
        { label: "Power connection", value: display(lc.powerConnectionDescription) },
        { label: "Ground connection", value: display(lc.groundConnectionDescription) },
        { label: "Ignition connection", value: display(lc.ignitionConnectionDescription) },
        { label: "Installation notes", value: display(lc.installationNotes) },
      );
    }
    sections.push({ id: "product", title: pname, fields });
  }

  return {
    submissionId: p.submissionId,
    formId: formId || p.formId,
    header: {
      title: "Installer Job Card",
      productName: pname,
      customer: dash(lx?.customer || c.customer),
      assetNumber: displayUpper(lx?.assetNumber || c.unitNumber),
      submittedAt: formatSubmittedAt(p.submissionTimestamp),
      installer: dash(c.installerName),
    },
    sections,
  };
}

function buildLegacyDocument(
  p: JobCardSubmissionPayload,
  options: EmailLayoutOptions = {},
): EmailLayoutDocument {
  const includeLinks = options.includeProductFileLinks === true;
  const c = p.coreJobInfo;
  const v = p.vac4;
  const h = p.hardwareSelection;
  const sections: EmailLayoutSection[] = [
    {
      id: "core",
      title: "Core Job Information",
      fields: [
        { label: "Customer", value: dash(c.customer) },
        { label: "Location", value: dash(c.location) },
        { label: "Work Order #", value: formatWorkOrder(c.workOrder) || "—" },
        { label: "Service Appointment #", value: formatServiceAppointment(c.serviceAppointment) || "—" },
        { label: "Unit #", value: displayUpper(c.unitNumber) },
        { label: "Installer", value: dash(c.installerName) },
      ],
    },
    {
      id: "vehicle",
      title: "Vehicle Information",
      fields: [
        { label: "Make", value: dash(c.equipmentMake) },
        { label: "Model", value: displayUpper(c.equipmentModel) },
        { label: "Serial #", value: displayUpper(c.equipmentSerial) },
        {
          label: "Vehicle Type",
          value:
            v.vehicleType === "Other"
              ? `${display(v.vehicleType)} (${display(v.otherVehicleType)})`
              : display(v.vehicleType),
        },
        { label: "Drive Type", value: display(v.driveType) },
        {
          label: "Voltage",
          value:
            v.vehicleVoltage === "Other"
              ? `Other (${display(v.vehicleVoltageOther)})`
              : display(v.vehicleVoltage),
        },
      ],
    },
    {
      id: "hardware",
      title: "Hardware",
      fields: [
        { label: "Primary", value: dash(getProductLabelWithLookup(h.primary, p.productDisplay) || getFormLabelBySectionKey(h.primary) || h.primary) },
        {
          label: "Additional Hardware",
          value:
            h.hasAdditional === "Yes"
              ? h.additional.length
                ? formatSectionKeysAsLabelsWithLookup(h.additional, p.productDisplay) ||
                  formatSectionKeysAsLabels(h.additional)
                : "Yes"
              : dash(h.hasAdditional),
        },
      ],
    },
  ];

  if (p.selectedSections.includes("VAC4")) {
    sections.push({
      id: "vac4",
      title: "VAC4 Install",
      fields: [
        { label: "Client Approval", value: display(v.clientApproval) },
        { label: "Hour Meter", value: dash(v.hourMeter) },
        { label: "Sensor Hub", value: display(v.sensorHubInstalled) },
        { label: "Lift Sense", value: display(v.liftSenseInstalled) },
        { label: "Operator Presence", value: display(v.operatorPresenceInstalled) },
        { label: "Speed Sense", value: display(v.speedSenseInstalled) },
        { label: "Load Sense", value: display(v.loadSenseInstalled) },
        { label: "GPS", value: display(v.gpsInstalled) },
        { label: "External Indicator", value: display(v.externalIndicatorInstalled) },
      ],
    });
  }

  const includePpd = selectedSectionsIncludeEffective(p.selectedSections ?? [], "PPD");
  if (includePpd && p.ppd) {
    const ppdFields: EmailLayoutField[] = [
      { label: "Hub serial", value: dash(p.ppd.hubSerial) },
      { label: "Client approval", value: dash(p.ppd.clientApproval) },
    ];
    const ppdJsonName =
      p.ppd.jsonConfigFile?.fileName?.trim() ||
      p.ppd.jsonFileName?.trim() ||
      (p.productFiles ?? []).find((f) => f.fileKey === PPD_JSON_FILE_KEY)?.originalFileName?.trim() ||
      "";
    if (ppdJsonName) {
      ppdFields.push({ label: "JSON Configuration File", value: ppdJsonName });
    }
    const ppdLink =
      p.ppd.jsonConfigFile?.publicUrl?.trim() ||
      (p.productFiles ?? []).find((f) => f.fileKey === PPD_JSON_FILE_KEY)?.downloadUrl?.trim() ||
      "";
    if (includeLinks && ppdLink) {
      ppdFields.push({ label: "JSON Configuration File link", value: ppdLink });
    } else if (ppdJsonName && !includeLinks) {
      ppdFields.push({
        label: "JSON Configuration File delivery",
        value: "Attached to this email when available",
      });
    }
    sections.push({
      id: "ppd",
      title: "PPD Install",
      fields: ppdFields,
    });
  }

  const extraProductFiles = (p.productFiles ?? []).filter(
    (f) => f.fileKey !== PPD_JSON_FILE_KEY && f.includeInEmail !== false && f.originalFileName,
  );
  if (extraProductFiles.length > 0) {
    const fields: EmailLayoutField[] = [];
    for (const file of extraProductFiles) {
      const productLabel =
        getProductLabelWithLookup(file.productKey, p.productDisplay) || file.productKey;
      fields.push({
        label: `${file.displayLabel || "Product File"} (${productLabel})`,
        value: file.originalFileName,
      });
      if (includeLinks && file.downloadUrl?.trim()) {
        fields.push({
          label: `${file.displayLabel || "Product File"} link`,
          value: file.downloadUrl.trim(),
        });
      } else if (!includeLinks) {
        fields.push({
          label: `${file.displayLabel || "Product File"} delivery`,
          value: "Attached to this email when available",
        });
      }
    }
    sections.push({ id: "product-files", title: "Product Files", fields });
  }

  return {
    submissionId: p.submissionId,
    formId: p.formId,
    header: {
      title: "Installer Job Card",
      productName: getFormLabelBySectionKey(h.primary) || h.primary || "Powerfleet / Matrix",
      customer: dash(c.customer),
      assetNumber: displayUpper(c.unitNumber),
      submittedAt: formatSubmittedAt(p.submissionTimestamp),
      installer: dash(c.installerName),
    },
    sections,
  };
}

export function buildEmailLayoutDocument(
  p: JobCardSubmissionPayload,
  options: EmailLayoutOptions = {},
): EmailLayoutDocument {
  if (detectLinxUp(p)) return buildLinxUpDocument(p);
  return buildLegacyDocument(p, options);
}

export function renderLayoutDocumentPlainText(doc: EmailLayoutDocument): string {
  const lines: string[] = [];
  lines.push(doc.header.title.toUpperCase());
  lines.push(`Product: ${doc.header.productName}`);
  lines.push(`Customer: ${doc.header.customer}`);
  lines.push(`Asset / Unit: ${doc.header.assetNumber}`);
  lines.push(`Submitted: ${doc.header.submittedAt}`);
  lines.push(`Installer: ${doc.header.installer}`);
  lines.push("");
  for (const section of doc.sections) {
    lines.push(section.title.toUpperCase());
    for (const field of section.fields) {
      lines.push(`${field.label}: ${field.value}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
