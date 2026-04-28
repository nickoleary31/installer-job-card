import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  type JobCardSubmissionPayload,
  DEFAULT_JOB_CARD_EMAIL_TO,
  formatEmailBodyFromPayload,
  formatEmailHtmlFromPayload,
  formatEmailSubject,
} from "@/lib/job-card-submission";

const DEFAULT_RESEND_FROM = "onboarding@resend.dev";
const ALWAYS_EMAIL_TO = "installs@tkpautomotive.com";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrEmpty(v: unknown) {
  return typeof v === "string" ? v : "";
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
    },
    hardwareSelection: {
      primary: stringOrEmpty(hw.primary),
      hasAdditional: stringOrEmpty(hw.hasAdditional),
      additional,
    },
    selectedSections,
    photoUploads: photoUploads as JobCardSubmissionPayload["photoUploads"],
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

function readExternalRecipientsFromPayload(payload: unknown): string[] {
  if (!isRecord(payload)) return [];
  const candidates: unknown[] = [];
  if (Array.isArray(payload.projectRecipientEmails)) candidates.push(...payload.projectRecipientEmails);
  if (Array.isArray(payload.externalRecipientEmails)) candidates.push(...payload.externalRecipientEmails);
  if (isRecord(payload.project) && Array.isArray(payload.project.externalRecipientEmails)) {
    candidates.push(...payload.project.externalRecipientEmails);
  }
  return candidates
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function POST(req: Request) {
  console.log("RESEND key loaded:", Boolean(process.env.RESEND_API_KEY));
  console.log("JOB_CARD_EMAIL_TO:", process.env.JOB_CARD_EMAIL_TO);

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

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Email is not configured: set RESEND_API_KEY." },
      { status: 503 },
    );
  }

  const from = process.env.JOB_CARD_EMAIL_FROM?.trim() || DEFAULT_RESEND_FROM;
  const fallbackTo = process.env.JOB_CARD_EMAIL_TO?.trim() || DEFAULT_JOB_CARD_EMAIL_TO;
  const to = Array.from(
    new Set(
      [ALWAYS_EMAIL_TO, fallbackTo, ...readExternalRecipientsFromPayload(payload)]
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  const subject = formatEmailSubject(payload.coreJobInfo.customer, payload.coreJobInfo.unitNumber);
  const text = formatEmailBodyFromPayload(payload);
  const html = formatEmailHtmlFromPayload(payload);

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject,
      text,
      html,
    });

    if (error) {
      console.error("Resend send-email returned error:", error);
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
  } catch (err: unknown) {
    console.error("Resend send-email threw error:", err);
    const message = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
