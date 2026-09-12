-- V1 core schema baseline — NOT a new feature, a retroactive record.
--
-- WHY THIS FILE EXISTS: public.job_card_drafts, public.job_card_submissions, and the
-- job-card-photos storage bucket/policies were created directly in production before this
-- repo started tracking schema via supabase/migrations/ (see the "Recover project after
-- moving from OneDrive to local dev environment" commit, the first to add migration files).
-- No migration in this repo has ever created them — every later migration only ever does
-- `alter table if exists ... add column if not exists ...` against job_card_drafts/
-- job_card_submissions, which silently no-ops when the table is absent. As a result, replaying
-- every migration in this repo against a genuinely empty database (a fresh Supabase preview
-- branch) fails: 20260426_phase1_company_project.sql contains an unguarded
-- `update public.job_card_drafts ...` that errors out with "relation ... does not exist" and
-- rolls back that entire migration's transaction, halting replay before anything downstream
-- ever runs.
--
-- This migration documents that pre-existing baseline so a fresh database can reconstruct V1
-- correctly. It intentionally sorts before 20260426_phase1_company_project.sql so the tables it
-- creates already exist by the time that migration's ALTER/UPDATE statements run.
--
-- PRODUCTION SAFETY: every statement here is IF NOT EXISTS / ON CONFLICT guarded, so it is a
-- guaranteed no-op if ever executed against a database that already has these objects (i.e.
-- production). That said, per explicit instruction this must NOT be run against production via
-- normal replay — production already has these objects and already has every later migration
-- marked applied; inserting this version ahead of them in history would make Supabase try to
-- apply it out of order. The intended production procedure is `supabase migration repair
-- --status applied <this version>` to mark it applied without executing its SQL, only after
-- confirming production's real objects match what's defined here. This file is written and
-- validated locally/against the disposable preview branch only.
--
-- TABLE SHAPE: confirmed directly against production's information_schema.columns/pg_constraint
-- (not inferred from application code alone). id is the real surrogate primary key on both
-- tables; submission_id carries its own separate NOT NULL UNIQUE constraint — application code's
-- upsert(..., { onConflict: "submission_id" }) targets that unique constraint, not the PK.
--
-- STORAGE POLICIES: confirmed directly against production's storage.objects policies. Only two
-- exist for this bucket — public SELECT and public INSERT — there is NO update or delete policy
-- in production today. This baseline reproduces that exactly, including the gap: it is not this
-- migration's job to tighten or "fix" that, only to faithfully reconstruct current V1 behavior.
-- Any future change to that posture belongs in its own separate migration.
--
-- Policy names reproduce production's actual dashboard-generated names exactly (including the
-- "(dev) 17gh87i_0" suffix) rather than a cosmetic rename, so this baseline is a faithful
-- reconstruction, not a reinterpretation.
--
-- TRIGGERS: confirmed against production — zero triggers on either table. None added here.

create table if not exists public.job_card_drafts (
  id uuid primary key default gen_random_uuid(),
  submission_id text not null unique,
  customer text,
  unit_number text,
  payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.job_card_drafts is
  'V1 baseline (pre-migration-tracking). company_id/project_id (NOT NULL, FK to companies/projects) plus their composite index are added by 20260426_phase1_company_project.sql; do not duplicate them here.';

create table if not exists public.job_card_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_id text not null unique,
  customer text,
  unit_number text,
  payload jsonb,
  created_at timestamptz not null default now()
);

comment on table public.job_card_submissions is
  'V1 baseline (pre-migration-tracking). company_id/project_id (NOT NULL, FK to companies/projects) plus their composite index are added by 20260426_phase1_company_project.sql; email-history columns are added by 202607120001_job_card_email_history.sql. Do not duplicate either set here.';

-- RLS intentionally not enabled on either table — confirmed against production
-- (relrowsecurity = false for both), matching this app's no-RLS, app-enforced convention for
-- its core business tables (see docs/Architecture.md).

-- job-card-photos storage bucket: confirmed against production (public = true,
-- file_size_limit = null, allowed_mime_types = null — leaving both unset here matches that).
insert into storage.buckets (id, name, public)
values ('job-card-photos', 'job-card-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Allow reads (dev) 17gh87i_0" on storage.objects;
create policy "Allow reads (dev) 17gh87i_0"
on storage.objects
for select
to public
using (bucket_id = 'job-card-photos');

drop policy if exists "Allow uploads (dev) 17gh87i_0" on storage.objects;
create policy "Allow uploads (dev) 17gh87i_0"
on storage.objects
for insert
to public
with check (bucket_id = 'job-card-photos');

-- Intentionally no UPDATE or DELETE policy — production has none for this bucket today.
