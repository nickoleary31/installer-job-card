-- ============================================================================
-- DRAFT 0002 — job-card-photos storage policies (revision 3, Phase 2H final 3359107)
-- STATUS: NOT APPLIED. Outside supabase/migrations/ on purpose.
-- Target when applied: Installer Sheetz V1 Dev (gewtjutfjrmhwmjlovly) only.
--
-- DEPENDS ON 0001 (uses public.can_access_project / public.project_company_id).
-- Apply only after 0001 has passed the web + Android regression, so a storage
-- regression can never be confused with a table-RLS one. Kept as a separate
-- file so it can be rolled back on its own (rollback at the end).
--
-- PRECONDITION TO VERIFY IN V1 DEV FIRST: Phase 2H photo uploads use
-- createSignedUploadUrl (service role, lib/job-card-submissions/
-- photo-upload-url-server.ts) + uploadToSignedUrl (device, lib/submission-
-- sync.ts). The Storage API performs signed uploads as its own privileged
-- user, independent of storage.objects policies. This file relies on that
-- (it denies direct client INSERTs into the Phase 2H namespace). If a V1 Dev
-- test shows a signed upload being evaluated against these policies, do NOT
-- apply this file.
--
-- CURRENT STATE (20260425000000_v1_core_schema_baseline.sql, confirmed prod):
--   "Allow reads (dev) 17gh87i_0"    SELECT to public  -> anyone, even without
--                                     a session, can LIST and download every
--                                     object through the Storage API
--   "Allow uploads (dev) 17gh87i_0"  INSERT to public  -> anyone, even without
--                                     a session, can upload anything
--   no UPDATE, no DELETE policy
-- The bucket stays PUBLIC: /storage/v1/object/public/... URLs keep working
-- regardless of these policies (emails, <img> tags, getPublicUrl). This file
-- removes anonymous LISTING and anonymous UPLOADS; it does not make photos
-- private. That would need a signed-URL read path in the app (audit §8).
--
-- PATH FAMILIES written to job-card-photos at 3359107:
--   A  {companyId}/{projectId}/{localSubmissionId}/{group}/{fieldName}/{localPhotoId}.{ext}
--      Phase 2H native. Path derived server-side after authorizeProjectAccess
--      proved project/company binding; uploaded through a signed URL.
--   B  expenses/{projectId}/{expenseId}/{timestamp}-{name}
--      Receipts. Direct client upload, upsert: true
--      (components/ProjectDetailScreen.tsx).
--   C  {submissionId}/{group}/{fieldName}/{timestamp}-{name}
--      Web job-card photos. Direct client upload, upsert: true
--      (components/NewSubmissionForm.tsx); listed by /photos/[submissionId].
--
-- WHY family C stays open to any signed-in user (documented residual):
-- storage uploads with upsert: true run INSERT ... ON CONFLICT DO UPDATE,
-- which in PostgreSQL also applies SELECT policies to the new row. Web
-- photos are uploaded before any draft/submission row necessarily exists, so
-- binding family C to "caller can access that submission" would break web
-- photo upload. The fix is an app change: move web uploads onto the family A
-- signed flow, then drop family C access (audit §12).
-- ============================================================================


-- Object-path authorization for job-card-photos. SECURITY INVOKER: it reads no
-- table itself and only calls the SECURITY DEFINER helpers from 0001, which
-- answer for the caller. Every ::uuid cast happens only after the regex
-- check, inside plpgsql control flow, so a malformed path can never raise a
-- cast error.
create or replace function public.job_card_photo_object_access(p_name text, p_for_write boolean)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_depth integer := coalesce(array_length(storage.foldername(p_name), 1), 0);
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  -- Family A: Phase 2H tenant namespace {companyId}/{projectId}/...
  if v_depth >= 2 and v_parts[1] ~* v_uuid and v_parts[2] ~* v_uuid then
    if p_for_write then
      -- Only server-signed uploads (which bypass policies) may write here, so
      -- nobody can plant objects inside another tenant's namespace directly.
      return false;
    end if;
    return public.can_access_project(v_parts[2]::uuid)
       and v_parts[1]::uuid = public.project_company_id(v_parts[2]::uuid);
  end if;

  -- Family B: receipts expenses/{projectId}/...
  if v_depth >= 1 and v_parts[1] = 'expenses' then
    if v_depth < 2 or v_parts[2] !~* v_uuid then
      return false;
    end if;
    return public.can_access_project(v_parts[2]::uuid);
  end if;

  -- Family C: legacy web photo paths {submissionId}/... (residual, see header).
  -- Objects at the bucket root are never allowed.
  return v_depth >= 1;
end;
$$;

comment on function public.job_card_photo_object_access(text, boolean) is
  'job-card-photos object authorization: Phase 2H namespace {company}/{project}/... readable by project members only and writable only via server-signed uploads; expenses/{project}/... bound to project access; legacy {submissionId}/... open to signed-in users (residual).';

revoke all on function public.job_card_photo_object_access(text, boolean) from public, anon;
grant execute on function public.job_card_photo_object_access(text, boolean) to authenticated;


-- Replace the anonymous policies.
drop policy if exists "Allow reads (dev) 17gh87i_0" on storage.objects;
drop policy if exists "Allow uploads (dev) 17gh87i_0" on storage.objects;

drop policy if exists job_card_photos_select on storage.objects;
create policy job_card_photos_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-card-photos'
    and public.job_card_photo_object_access(name, false)
  );

drop policy if exists job_card_photos_insert on storage.objects;
create policy job_card_photos_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-card-photos'
    and public.job_card_photo_object_access(name, true)
  );

-- UPDATE / DELETE: still none. Receipt/photo remove() calls in the app remain
-- no-ops exactly as today (unchanged behavior). Overwrites happen only through
-- server-signed upserts (Phase 2H retries of the same deterministic path).


-- ----------------------------------------------------------------------------
-- ROLLBACK (restores the exact pre-0002 state; run as one transaction):
--   drop policy if exists job_card_photos_select on storage.objects;
--   drop policy if exists job_card_photos_insert on storage.objects;
--   create policy "Allow reads (dev) 17gh87i_0" on storage.objects
--     for select to public using (bucket_id = 'job-card-photos');
--   create policy "Allow uploads (dev) 17gh87i_0" on storage.objects
--     for insert to public with check (bucket_id = 'job-card-photos');
--   drop function if exists public.job_card_photo_object_access(text, boolean);
-- ----------------------------------------------------------------------------
