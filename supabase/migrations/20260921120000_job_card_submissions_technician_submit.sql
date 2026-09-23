-- Phase 2H (native mobile durable outbox + idempotent foreground sync): adds the two columns
-- the new server finalization boundary (app/api/job-card-submissions/finalize/route.ts) needs.
-- Purely additive/backward-compatible — the existing web submit path (persistSubmittedJobCard in
-- components/NewSubmissionForm.tsx) is untouched and continues to insert/update this table
-- without ever setting either column; both stay null for every submission that path produces.
--
--   technician_submitted_at: the explicit technician-submit event time, as recorded by the
--     ATOMIC native transaction (see lib/native/local-submission-outbox.ts's
--     technicianSubmitAtomically) — distinct from created_at (this row's first server write,
--     which can happen much later once the device is back online and foreground sync runs).
--   submission_snapshot_hash: the frozen, transport-independent logical-identity hash computed
--     once on-device at submit time (see lib/local-submission-outbox.ts's module doc). Used by
--     the finalize route to distinguish a genuine idempotent retry (same hash) from a real
--     conflict (different hash) on the same submission_id, and by the native Submitted screen to
--     determine a truthful "Synced" status rather than trusting a matching submission_id alone.
--
-- Both nullable with no default: null means "not a Phase 2H native submission" (or not yet
-- known), never "submitted with an empty/zero identity."

alter table if exists public.job_card_submissions
  add column if not exists technician_submitted_at timestamptz,
  add column if not exists submission_snapshot_hash text;
