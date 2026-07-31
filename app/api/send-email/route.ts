import { NextResponse } from "next/server";
import { Resend } from "resend";
import { buildCidPhotoAttachments } from "@/lib/email-cid-attachments";
import { buildProductFileEmailAttachments } from "@/lib/email-product-file-attachments";
import { buildEmailPhotoSections } from "@/lib/email-photo-sections";
import { buildOutboundEmailBodies } from "@/lib/email-view-model";
import {
  resolveJobCardEmailRecipients,
  type EmailSendMode,
} from "@/lib/email-recipients";
import { persistEmailHistory } from "@/lib/email-submission-history";
import {
  type JobCardCp4Payload,
  type JobCardPpdPayload,
  type JobCardSubmissionPayload,
} from "@/lib/job-card-submission";
import type { JobCardLinxupPayload } from "@/lib/linxup";
import { readUploadedProductFiles } from "@/lib/product-files";

const DEFAULT_RESEND_FROM = "onboarding@resend.dev";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrEmpty(v: unknown) {
  return typeof v === "string" ? v : "";
}

function normalizePpdJsonConfigForm(raw: unknown): JobCardPpdPayload["jsonConfigForm"] {
  if (!isRecord(raw)) return undefined;
  return {
    make: stringOrEmpty(raw.make),
    model: stringOrEmpty(raw.model),
    unitNumber: stringOrEmpty(raw.unitNumber),
    notes: stringOrEmpty(raw.notes),
  };
}

function normalizePpdJsonConfigFilePayload(raw: unknown): JobCardPpdPayload["jsonConfigFile"] {
  if (!isRecord(raw)) return undefined;
  if (!stringOrEmpty(raw.fileName).trim() && !stringOrEmpty(raw.storagePath).trim()) return undefined;
  const cid = raw.customerId;
  const customerId =
    cid === null ? null : typeof cid === "string" && cid.trim() ? cid.trim() : null;
  return {
    fileName: stringOrEmpty(raw.fileName),
    storagePath: stringOrEmpty(raw.storagePath),
    publicUrl: stringOrEmpty(raw.publicUrl),
    customerId,
    projectId: stringOrEmpty(raw.projectId),
    companyId: stringOrEmpty(raw.companyId),
    make: stringOrEmpty(raw.make),
    model: stringOrEmpty(raw.model),
    unitNumber: stringOrEmpty(raw.unitNumber),
    notes: stringOrEmpty(raw.notes),
    uploadedAt: stringOrEmpty(raw.uploadedAt),
  };
}

function normalizePpdPayload(raw: unknown): JobCardPpdPayload | undefined {
  if (!isRecord(raw)) return undefined;
  const serialsRaw = isRecord(raw.cameraSerialsByLocation) ? raw.cameraSerialsByLocation : {};
  const cameraSerialsByLocation: Record<string, string> = {};
  for (const [k, v] of Object.entries(serialsRaw)) {
    if (typeof v === "string") cameraSerialsByLocation[k] = v;
  }
  const cameraLocations = Array.isArray(raw.cameraLocations)
    ? raw.cameraLocations.filter((x): x is string => typeof x === "string")
    : [];
  const jsonConfigForm = normalizePpdJsonConfigForm(raw.jsonConfigForm);
  const jsonConfigFile = normalizePpdJsonConfigFilePayload(raw.jsonConfigFile);
  return {
    hubSerial: stringOrEmpty(raw.hubSerial),
    cameraLocations,
    cameraSerialsByLocation,
    monitorInstalled: stringOrEmpty(raw.monitorInstalled),
    customBracketsNeeded: stringOrEmpty(raw.customBracketsNeeded),
    customBracketNotes: stringOrEmpty(raw.customBracketNotes),
    clientApproval: stringOrEmpty(raw.clientApproval),
    jsonFileName: stringOrEmpty(raw.jsonFileName),
    ...(jsonConfigForm ? { jsonConfigForm } : {}),
    ...(jsonConfigFile ? { jsonConfigFile } : {}),
    relaysUsedForSpeedControl: stringOrEmpty(raw.relaysUsedForSpeedControl),
    redWireDescription: stringOrEmpty(raw.redWireDescription),
    blackWireDescription: stringOrEmpty(raw.blackWireDescription),
    yellowWireDescription: stringOrEmpty(raw.yellowWireDescription),
    greyWireDescription: stringOrEmpty(raw.greyWireDescription),
    blueWireDescription: stringOrEmpty(raw.blueWireDescription),
    powerConverterDescription: stringOrEmpty(raw.powerConverterDescription),
    redAlarmOutDescription: stringOrEmpty(raw.redAlarmOutDescription),
    yellowAlarmOutDescription: stringOrEmpty(raw.yellowAlarmOutDescription),
    blackAlarmGroundDescription: stringOrEmpty(raw.blackAlarmGroundDescription),
  };
}

function normalizeCp4Payload(raw: unknown): JobCardCp4Payload | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    drid: stringOrEmpty(raw.drid),
    serial: stringOrEmpty(raw.serial),
    cameraQuantity: stringOrEmpty(raw.cameraQuantity),
    monitorInstalled: stringOrEmpty(raw.monitorInstalled),
    clientApproval: stringOrEmpty(raw.clientApproval),
    customBracketsNeeded: stringOrEmpty(raw.customBracketsNeeded),
    customBracketNotes: stringOrEmpty(raw.customBracketNotes),
    alarmIn1RelayInstalled: stringOrEmpty(raw.alarmIn1RelayInstalled),
    alarmIn1Description: stringOrEmpty(raw.alarmIn1Description),
    alarmIn2RelayInstalled: stringOrEmpty(raw.alarmIn2RelayInstalled),
    alarmIn2Description: stringOrEmpty(raw.alarmIn2Description),
    hubMountingDescription: stringOrEmpty(raw.hubMountingDescription),
    microphoneMountingDescription: stringOrEmpty(raw.microphoneMountingDescription),
    remoteControlMountingDescription: stringOrEmpty(raw.remoteControlMountingDescription),
    gpsSensorMountingDescription: stringOrEmpty(raw.gpsSensorMountingDescription),
    redWireDescription: stringOrEmpty(raw.redWireDescription),
    blackWireDescription: stringOrEmpty(raw.blackWireDescription),
    whiteWireDescription: stringOrEmpty(raw.whiteWireDescription),
    monitorMountingDescription: stringOrEmpty(raw.monitorMountingDescription),
    powerConverterDescription: stringOrEmpty(raw.powerConverterDescription),
  };
}

function normalizeLinxupPayload(raw: unknown): JobCardLinxupPayload | undefined {
  if (!isRecord(raw)) return undefined;
  const formId = stringOrEmpty(raw.formId);
  const submissionType = stringOrEmpty(raw.submissionType) || formId;
  const productLabel = stringOrEmpty(raw.productLabel) || submissionType || formId;
  if (!formId && !productLabel) return undefined;
  const vtRaw = isRecord(raw.vehicleTracker) ? raw.vehicleTracker : null;
  const lcRaw = isRecord(raw.linxCam) ? raw.linxCam : null;
  const base: JobCardLinxupPayload = {
    formId,
    submissionType,
    productLabel,
    customer: stringOrEmpty(raw.customer),
    location: stringOrEmpty(raw.location),
    primaryContact: stringOrEmpty(raw.primaryContact),
    contactNumber: stringOrEmpty(raw.contactNumber),
    contactEmail: stringOrEmpty(raw.contactEmail),
    year: stringOrEmpty(raw.year),
    make: stringOrEmpty(raw.make),
    model: stringOrEmpty(raw.model),
    serialVin: stringOrEmpty(raw.serialVin),
    assetNumber: stringOrEmpty(raw.assetNumber),
    vehicleType: stringOrEmpty(raw.vehicleType),
    hoursMiles: stringOrEmpty(raw.hoursMiles),
  };
  if (typeof raw.powerConnectionDescription === "string") {
    base.powerConnectionDescription = raw.powerConnectionDescription;
  }
  if (typeof raw.groundConnectionDescription === "string") {
    base.groundConnectionDescription = raw.groundConnectionDescription;
  }
  if (typeof raw.ignitionConnectionDescription === "string") {
    base.ignitionConnectionDescription = raw.ignitionConnectionDescription;
  }
  if (vtRaw) {
    base.vehicleTracker = {
      obdPortConnected: stringOrEmpty(vtRaw.obdPortConnected),
      installationNotes: stringOrEmpty(vtRaw.installationNotes),
      powerConnectionDescription: stringOrEmpty(vtRaw.powerConnectionDescription),
      groundConnectionDescription: stringOrEmpty(vtRaw.groundConnectionDescription),
      ignitionConnectionDescription: stringOrEmpty(vtRaw.ignitionConnectionDescription),
    };
  }
  if (lcRaw) {
    base.linxCam = {
      obdPortConnected: stringOrEmpty(lcRaw.obdPortConnected),
      installationNotes: stringOrEmpty(lcRaw.installationNotes),
      powerConnectionDescription: stringOrEmpty(lcRaw.powerConnectionDescription),
      groundConnectionDescription: stringOrEmpty(lcRaw.groundConnectionDescription),
      ignitionConnectionDescription: stringOrEmpty(lcRaw.ignitionConnectionDescription),
    };
  }
  return base;
}

function normalizeSubmissionPayload(p: unknown): JobCardSubmissionPayload | null {
  if (!isRecord(p)) return null;
  const core = isRecord(p.coreJobInfo) ? p.coreJobInfo : {};
  const hw = isRecord(p.hardwareSelection) ? p.hardwareSelection : {};
  const vac = isRecord(p.vac4) ? p.vac4 : {};
  const photoCounts = isRecord(vac.photoCounts) ? vac.photoCounts : {};
  const photoFileNames = isRecord(vac.photoFileNames) ? vac.photoFileNames : {};
  const photoUrls = isRecord(vac.photoUrls) ? vac.photoUrls : {};
  const selectedSections = Array.isArray(p.selectedSections) ? p.selectedSections.filter((x) => typeof x === "string") : [];
  const additional = Array.isArray(hw.additional) ? hw.additional.filter((x) => typeof x === "string") : [];
  const photoUploads = Array.isArray(p.photoUploads) ? p.photoUploads.filter((x) => isRecord(x)) : [];
  const ppd = p.ppd !== undefined ? normalizePpdPayload(p.ppd) : undefined;
  const cp4 = p.cp4 !== undefined ? normalizeCp4Payload(p.cp4) : undefined;
  const linxup = p.linxup !== undefined ? normalizeLinxupPayload(p.linxup) : undefined;
  const productFiles = readUploadedProductFiles(p.productFiles ?? p.productArtifacts);
  const projectRecipientEmails = Array.isArray(p.projectRecipientEmails)
    ? p.projectRecipientEmails.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
    : [];
  return {
    submissionId: stringOrEmpty(p.submissionId),
    submissionTimestamp: stringOrEmpty(p.submissionTimestamp) || new Date().toISOString(),
    status: "Submitted",
    companyId: stringOrEmpty(p.companyId),
    projectId: stringOrEmpty(p.projectId),
    projectName: stringOrEmpty(p.projectName),
    projectRecipientEmails,
    formId: stringOrEmpty(p.formId) || undefined,
    submissionType: stringOrEmpty(p.submissionType) || undefined,
    coreJobInfo: {
      customer: stringOrEmpty(core.customer),
      location: stringOrEmpty(core.location),
      workOrder: stringOrEmpty(core.workOrder),
      serviceAppointment: stringOrEmpty(core.serviceAppointment),
      unitNumber: stringOrEmpty(core.unitNumber),
      equipmentMake: stringOrEmpty(core.equipmentMake),
      equipmentModel: stringOrEmpty(core.equipmentModel),
      equipmentSerial: stringOrEmpty(core.equipmentSerial),
      installerName: stringOrEmpty(core.installerName),
      primaryContact: stringOrEmpty(core.primaryContact) || undefined,
      contactNumber: stringOrEmpty(core.contactNumber) || undefined,
      contactEmail: stringOrEmpty(core.contactEmail) || undefined,
    },
    hardwareSelection: {
      primary: stringOrEmpty(hw.primary),
      hasAdditional: stringOrEmpty(hw.hasAdditional),
      additional,
    },
    selectedSections,
    photoUploads: photoUploads as JobCardSubmissionPayload["photoUploads"],
    ...(ppd ? { ppd } : {}),
    ...(cp4 ? { cp4 } : {}),
    ...(linxup ? { linxup } : {}),
    ...(productFiles && productFiles.length > 0 ? { productFiles } : {}),
    vac4: {
      vehicleType: stringOrEmpty(vac.vehicleType),
      otherVehicleType: stringOrEmpty(vac.otherVehicleType),
      driveType: stringOrEmpty(vac.driveType),
      vehicleVoltage: stringOrEmpty(vac.vehicleVoltage),
      vehicleVoltageOther: stringOrEmpty(vac.vehicleVoltageOther),
      clientApproval: stringOrEmpty(vac.clientApproval),
      hourMeter: stringOrEmpty(vac.hourMeter),
      sensorHubInstalled: stringOrEmpty(vac.sensorHubInstalled),
      liftSenseInstalled: stringOrEmpty(vac.liftSenseInstalled),
      operatorPresenceInstalled: stringOrEmpty(vac.operatorPresenceInstalled),
      speedSenseInstalled: stringOrEmpty(vac.speedSenseInstalled),
      loadSenseInstalled: stringOrEmpty(vac.loadSenseInstalled),
      gpsInstalled: stringOrEmpty(vac.gpsInstalled),
      externalIndicatorInstalled: stringOrEmpty(vac.externalIndicatorInstalled),
      speedSenseDescription: stringOrEmpty(vac.speedSenseDescription),
      speedSensePulseCount: stringOrEmpty(vac.speedSensePulseCount),
      loadSenseThresholds: stringOrEmpty(vac.loadSenseThresholds),
      redWireDescription: stringOrEmpty(vac.redWireDescription),
      blackWireDescription: stringOrEmpty(vac.blackWireDescription),
      blueWireDescription: stringOrEmpty(vac.blueWireDescription),
      brownWireDescription: stringOrEmpty(vac.brownWireDescription),
      purpleWireDescription: stringOrEmpty(vac.purpleWireDescription),
      relayAccessDescription: stringOrEmpty(vac.relayAccessDescription),
      impactSensorDescription: stringOrEmpty(vac.impactSensorDescription),
      photoCounts: photoCounts as Record<string, number>,
      photoFileNames: photoFileNames as JobCardSubmissionPayload["vac4"]["photoFileNames"],
      photoUrls: photoUrls as JobCardSubmissionPayload["vac4"]["photoUrls"],
    },
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(body) || body.payload === undefined) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  const payload = normalizeSubmissionPayload(body.payload);
  if (!payload) {
    return NextResponse.json({ error: "Invalid submission payload" }, { status: 400 });
  }

  const sendMode: EmailSendMode = body.sendMode === "internal_only" ? "internal_only" : "client_and_internal";
  const allowPartialSend = body.allowPartialSend === true;
  const sentByUserId = typeof body.sentByUserId === "string" ? body.sentByUserId.trim() : null;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Email is not configured: set RESEND_API_KEY." }, { status: 503 });
  }

  const from = process.env.JOB_CARD_EMAIL_FROM?.trim() || DEFAULT_RESEND_FROM;
  const recipients = resolveJobCardEmailRecipients({ sendMode, payload });
  const to = recipients.toAddresses;

  const filenameContext = {
    customer: payload.linxup?.customer || payload.coreJobInfo.customer || "Customer",
    assetNumber: payload.linxup?.assetNumber || payload.coreJobInfo.unitNumber || "Unit",
  };

  let photoAttachments;
  try {
    const sections = buildEmailPhotoSections(payload);
    photoAttachments = await buildCidPhotoAttachments(sections, {
      filenameContext,
      allowPartialSend,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to attach photos";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  // Complete send requires every expected photo downloaded, optimized, attached, and CID-mapped.
  if (
    photoAttachments.attachedCount !== photoAttachments.expectedCount ||
    photoAttachments.failures.length > 0 ||
    photoAttachments.cidByStoragePath.size !== photoAttachments.expectedCount
  ) {
    if (!allowPartialSend) {
      photoAttachments = {
        ...photoAttachments,
        blocked: true,
      };
    }
  }

  const failureMessages = photoAttachments.failures.map(
    (f) => `${f.label} (${f.filename}): ${f.reason}`,
  );

  if (photoAttachments.blocked) {
    return NextResponse.json(
      {
        error: "One or more photos failed to attach. Email was not sent.",
        photoAttachments: {
          expectedCount: photoAttachments.expectedCount,
          attachedCount: photoAttachments.attachedCount,
          skippedCount: photoAttachments.skippedCount,
          optimized: photoAttachments.optimized,
          attached: photoAttachments.attached,
          warnings: photoAttachments.warnings,
          failures: photoAttachments.failures,
          failureMessages,
          totalOriginalBytes: photoAttachments.totalOriginalBytes,
          totalOptimizedBytes: photoAttachments.totalOptimizedBytes,
          blocked: true,
        },
      },
      { status: 422 },
    );
  }

  // Only true failures may appear in the email body (partial-send path).
  // Successful optimizations stay in server logs / API diagnostics only.
  const outbound = buildOutboundEmailBodies(payload, {
    cidByStoragePath: photoAttachments.cidByStoragePath,
    attachmentFailures: failureMessages.length > 0 ? failureMessages : undefined,
    photoSections: photoAttachments.photoSections,
  });

  if (/supabase\.co\/storage/i.test(outbound.htmlBody) || /supabase\.co\/storage/i.test(outbound.textBody)) {
    return NextResponse.json({ error: "Email body incorrectly included Storage URLs. Send aborted." }, { status: 500 });
  }

  if (!/cid:photo-/i.test(outbound.htmlBody) && photoAttachments.attachedCount > 0) {
    return NextResponse.json({ error: "Email HTML missing CID photo references. Send aborted." }, { status: 500 });
  }

  // Attach Product Files (PPD JSON, etc.) so recipients are not tied to expired signed URLs.
  let productFileAttachments: Awaited<ReturnType<typeof buildProductFileEmailAttachments>> = {
    attachments: [],
    attached: [],
    skipped: [],
  };
  try {
    productFileAttachments = await buildProductFileEmailAttachments(payload);
    if (productFileAttachments.skipped.length > 0) {
      console.warn("[send-email] product file attachment skips", productFileAttachments.skipped);
    }
  } catch (err: unknown) {
    console.warn("[send-email] product file attachments unavailable", err);
  }

  const resend = new Resend(apiKey);
  let resendId: string | null = null;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: outbound.subject,
      text: outbound.textBody,
      html: outbound.htmlBody,
      attachments: [
        ...photoAttachments.attachments.map((a) => ({
          content: a.content,
          filename: a.filename,
          contentId: a.contentId,
          contentType: a.contentType,
        })),
        ...productFileAttachments.attachments.map((a) => ({
          content: a.content,
          filename: a.filename,
          contentType: a.contentType,
        })),
      ],
    });

    if (error) {
      try {
        await persistEmailHistory({
          submissionId: payload.submissionId,
          sendMode,
          recipients: recipients.to,
          status: "failed",
          error: error.message,
          sentByUserId,
        });
      } catch {
        // submission row may not exist yet
      }
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    resendId = data?.id ?? null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    try {
      await persistEmailHistory({
        submissionId: payload.submissionId,
        sendMode,
        recipients: recipients.to,
        status: "failed",
        error: message,
        sentByUserId,
      });
    } catch {
      // ignore
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }

  try {
    await persistEmailHistory({
      submissionId: payload.submissionId,
      sendMode,
      recipients: recipients.to,
      status: "sent",
      resendId,
      sentByUserId,
    });
  } catch (e) {
    console.error("Email sent but history update failed:", e);
  }

  return NextResponse.json({
    ok: true,
    resendId,
    sendMode,
    recipients: recipients.to,
    photoAttachments: {
      expectedCount: photoAttachments.expectedCount,
      attachedCount: photoAttachments.attachedCount,
      skippedCount: photoAttachments.skippedCount,
      optimized: photoAttachments.optimized,
      attached: photoAttachments.attached,
      warnings: photoAttachments.warnings,
      failures: photoAttachments.failures,
      totalOriginalBytes: photoAttachments.totalOriginalBytes,
      totalOptimizedBytes: photoAttachments.totalOptimizedBytes,
      attachmentFilenames: photoAttachments.attachments.map((a) => a.filename),
    },
  });
}
