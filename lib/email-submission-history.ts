import { createClient } from "@supabase/supabase-js";
import type { EmailSendMode } from "@/lib/email-recipients";
import type { EmailRecipient } from "@/lib/email-recipients";

export type EmailHistoryUpdate = {
  submissionId: string;
  sendMode: EmailSendMode;
  recipients: EmailRecipient[];
  resendId?: string | null;
  error?: string | null;
  sentByUserId?: string | null;
  status: "sent" | "failed";
};

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) throw new Error("Missing Supabase service role for email history.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function persistEmailHistory(update: EmailHistoryUpdate): Promise<void> {
  const now = new Date().toISOString();
  const sb = createServiceRoleClient();

  const patch: Record<string, unknown> = {
    last_emailed_at: update.status === "sent" ? now : undefined,
    last_email_mode: update.sendMode,
    last_email_recipients: update.recipients,
    last_email_status: update.status,
    last_email_resend_id: update.resendId ?? null,
    last_email_error: update.error ?? null,
    last_email_sent_by: update.sentByUserId ?? null,
  };

  if (update.status === "sent") {
    if (update.sendMode === "internal_only") {
      patch.internal_emailed_at = now;
    } else {
      patch.client_emailed_at = now;
      patch.internal_emailed_at = now;
    }
  } else {
    patch.last_email_error = update.error ?? "Email failed";
  }

  const { error } = await sb
    .from("job_card_submissions")
    .update(patch)
    .eq("submission_id", update.submissionId);
  if (error) throw error;
}
