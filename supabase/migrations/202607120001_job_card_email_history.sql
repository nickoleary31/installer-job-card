-- Email delivery history on submitted job cards (submission remains independent of email success).

alter table if exists public.job_card_submissions
  add column if not exists internal_emailed_at timestamptz,
  add column if not exists client_emailed_at timestamptz,
  add column if not exists last_emailed_at timestamptz,
  add column if not exists last_email_mode text,
  add column if not exists last_email_recipients jsonb,
  add column if not exists last_email_status text,
  add column if not exists last_email_resend_id text,
  add column if not exists last_email_error text,
  add column if not exists last_email_sent_by uuid;

comment on column public.job_card_submissions.last_email_mode is 'client_and_internal | internal_only';
comment on column public.job_card_submissions.last_email_recipients is 'JSON array of {email, source, label, route} at last send';
