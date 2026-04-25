import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  type JobCardSubmissionPayload,
  DEFAULT_JOB_CARD_EMAIL_TO,
  formatEmailBodyFromPayload,
  formatEmailSubject,
} from "@/lib/job-card-submission";

const DEFAULT_RESEND_FROM = "onboarding@resend.dev";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSubmissionPayload(p: unknown): p is JobCardSubmissionPayload {
  if (!isRecord(p)) return false;
  if (p.status !== "Submitted") return false;
  if (typeof p.submissionTimestamp !== "string") return false;
  if (!isRecord(p.coreJobInfo)) return false;
  if (!isRecord(p.hardwareSelection)) return false;
  if (!Array.isArray(p.selectedSections)) return false;
  if (!isRecord(p.vac4)) return false;
  if (!isRecord(p.vac4.photoCounts) || !isRecord(p.vac4.photoFileNames)) return false;
  return true;
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

  if (!isSubmissionPayload(body.payload)) {
    return NextResponse.json({ error: "Invalid submission payload" }, { status: 400 });
  }

  const payload = body.payload;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Email is not configured: set RESEND_API_KEY." },
      { status: 503 },
    );
  }

  const from = process.env.JOB_CARD_EMAIL_FROM?.trim() || DEFAULT_RESEND_FROM;
  const to = process.env.JOB_CARD_EMAIL_TO?.trim() || DEFAULT_JOB_CARD_EMAIL_TO;

  const subject = formatEmailSubject(payload.coreJobInfo.customer, payload.coreJobInfo.unitNumber);
  const text = formatEmailBodyFromPayload(payload);

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject,
      text,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
