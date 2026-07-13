import { NextResponse } from "next/server";
import {
  resolveJobCardEmailRecipients,
  type EmailSendMode,
} from "@/lib/email-recipients";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isRecord(body) || !isRecord(body.payload)) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }
  const sendMode = (body.sendMode === "internal_only" ? "internal_only" : "client_and_internal") as EmailSendMode;
  const resolved = resolveJobCardEmailRecipients({
    sendMode,
    payload: body.payload as Parameters<typeof resolveJobCardEmailRecipients>[0]["payload"],
  });
  return NextResponse.json({
    sendMode: resolved.sendMode,
    to: resolved.to,
    cc: resolved.cc,
    bcc: resolved.bcc,
    toAddresses: resolved.toAddresses,
  });
}
