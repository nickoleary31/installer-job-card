/**
 * Product Files email layout checks (tsx — resolves extensionless lib imports).
 * Run: npx tsx scripts/verify-product-files-email-layout.ts
 */
import assert from "node:assert/strict";
import { buildEmailLayoutDocument } from "../lib/email-layout-model";
import type { JobCardSubmissionPayload } from "../lib/job-card-submission";

const payload = {
  submissionId: "sub-pf",
  submissionTimestamp: "2026-07-31T18:00:00.000Z",
  status: "Submitted",
  companyId: "co",
  projectId: "proj",
  projectName: "Test",
  projectRecipientEmails: [],
  formId: "ppd",
  submissionType: "ppd",
  coreJobInfo: {
    customer: "Verify",
    location: "ATL",
    workOrder: "WO-1",
    serviceAppointment: "SA-1",
    unitNumber: "U1",
    equipmentMake: "Toyota",
    equipmentModel: "8F",
    equipmentSerial: "SN",
    installerName: "Nick",
  },
  hardwareSelection: { primary: "PPD", hasAdditional: "No", additional: [] },
  selectedSections: ["PPD"],
  photoUploads: [],
  productFiles: [
    {
      fileKey: "ppd_json_config",
      productKey: "PPD",
      originalFileName: "verify-config.json",
      storageBucket: "customer-site-files",
      storagePath: "customer-sites/c/ppd-json/p/u-verify-config.json",
      mimeType: "application/json",
      sizeBytes: 12,
      uploadedAt: "2026-07-31T18:00:00.000Z",
      displayLabel: "JSON Configuration File",
      downloadUrl: "https://example.supabase.co/storage/v1/object/sign/customer-site-files/x?token=abc",
      includeInEmail: true,
      includeInReview: true,
    },
  ],
  ppd: {
    hubSerial: "HUB",
    cameraLocations: [],
    cameraSerialsByLocation: {},
    monitorInstalled: "Yes",
    customBracketsNeeded: "No",
    customBracketNotes: "",
    clientApproval: "OK",
    jsonFileName: "verify-config.json",
    jsonConfigFile: {
      fileName: "verify-config.json",
      storagePath: "customer-sites/c/ppd-json/p/u-verify-config.json",
      publicUrl: "https://example.supabase.co/storage/v1/object/sign/customer-site-files/x?token=abc",
      customerId: "c",
      projectId: "proj",
      companyId: "co",
      make: "Toyota",
      model: "8F",
      unitNumber: "U1",
      notes: "",
      uploadedAt: "2026-07-31T18:00:00.000Z",
    },
    relaysUsedForSpeedControl: "",
    redWireDescription: "",
    blackWireDescription: "",
    yellowWireDescription: "",
    greyWireDescription: "",
    blueWireDescription: "",
    powerConverterDescription: "",
    redAlarmOutDescription: "",
    yellowAlarmOutDescription: "",
    blackAlarmGroundDescription: "",
  },
  vac4: {
    vehicleType: "Forklift Rider",
    otherVehicleType: "",
    driveType: "Electric",
    vehicleVoltage: "36",
    vehicleVoltageOther: "",
    clientApproval: "",
    hourMeter: "",
    photoCounts: {},
    photoFileNames: {},
    photoUrls: {},
  },
} as JobCardSubmissionPayload;

const preview = buildEmailLayoutDocument(payload, { includeProductFileLinks: true });
const previewPpd = preview.sections.find((s) => s.id === "ppd");
assert.ok(previewPpd);
assert.ok(previewPpd!.fields.some((f) => f.label === "JSON Configuration File" && f.value === "verify-config.json"));
assert.ok(previewPpd!.fields.some((f) => f.label === "JSON Configuration File link" && /object\/sign/.test(f.value)));
assert.equal(
  previewPpd!.fields.some(
    (f) => /storage path/i.test(f.label) || (/ppd-json\//.test(f.value) && !/object\/sign/.test(f.value)),
  ),
  false,
);

const outbound = buildEmailLayoutDocument(payload, { includeProductFileLinks: false });
const outboundPpd = outbound.sections.find((s) => s.id === "ppd");
assert.ok(outboundPpd);
assert.ok(outboundPpd!.fields.some((f) => f.label === "JSON Configuration File" && f.value === "verify-config.json"));
assert.ok(
  outboundPpd!.fields.some(
    (f) => f.label === "JSON Configuration File delivery" && /Attached to this email/.test(f.value),
  ),
);
assert.equal(outboundPpd!.fields.some((f) => /link/i.test(f.label) && /supabase\.co\/storage/.test(f.value)), false);

console.log(JSON.stringify({ ok: true, previewFields: previewPpd!.fields.map((f) => f.label), outboundFields: outboundPpd!.fields.map((f) => f.label) }, null, 2));
