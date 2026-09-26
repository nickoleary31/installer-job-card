-- ============================================================================
-- DRAFT 0002 — storage policies for job-card-photos AND customer-site-files
--   revision 3: job-card-photos only (Phase 2H final 3359107)
--   revision 4: re-derived from the EXACT path builders/validators at
--               origin/main 5ded8e7 and mobile 36938d1 (native uploader
--               segment); adds customer-site-files; owner-scoped pre-save
--               web photos. See docs/RLS_Revision4_Rebaseline.md §G.
-- STATUS: NOT APPLIED. Outside supabase/migrations/ on purpose.
-- Target when applied: Installer Sheetz V1 Dev (gewtjutfjrmhwmjlovly) only.
-- (This repo commits supabase/.temp/project-ref = PRODUCTION. Never run the
-- Supabase CLI from this worktree.)
--
-- DEPENDS ON 0001 (can_access_project, project_company_id, project_customer_id).
-- Apply only after 0001 has passed regression.
--
-- GATE Q10 (must pass in V1 Dev BEFORE applying): native photos are uploaded
-- with uploadToSignedUrl against a URL minted by the service role
-- (photo-upload-url-server.ts, createSignedUploadUrl(path, {upsert:true})).
-- This file assumes the Storage API performs signed uploads as its own
-- privileged user, independent of storage.objects policies, and therefore
-- DENIES direct client writes into the native namespace. Verify on V1 Dev (see
-- 00_v1dev_preflight_readonly.sql, "Q10"). If signed uploads ARE evaluated
-- against these policies, do NOT apply this file.
--
-- ---------------------------------------------------------------------------
-- PATH FAMILIES (segments separated by '/'; "folders" = all but the file)
--
-- job-card-photos (bucket public = true; public URLs keep working regardless
-- of policies, so these policies govern API list/download/upload only):
--   N7  {companyId}/{projectId}/{uploaderUserId}/{submissionId}/{group}/{field}/{photoId}.{ext}
--       native, current (mobile Checkpoint 2). Built ONLY server-side by
--       photo-upload-url after authorizeProjectAccess(requireActiveProject);
--       uploaderUserId = the verified requester (lib/local-photo.ts
--       buildRemotePhotoStoragePath). Folders: 6.
--   N6  {companyId}/{projectId}/{submissionId}/{group}/{field}/{photoId}.{ext}
--       native, pre-Checkpoint-2 (Phase 2H 3359107). No longer produced; kept
--       readable for existing objects. Folders: 5.
--   W4  {submissionId}/{group}/{field}/{timestamp}-{name}
--       web job-card photos (NewSubmissionForm direct upload, upsert: true;
--       /photos/[submissionId] lists it). submissionId = crypto.randomUUID()
--       in current code. Folders: 3.
--   R4  expenses/{projectId}/{expenseId}/{timestamp}-{name}
--       expense receipts (ProjectDetailScreen direct upload, upsert: true).
--       Folders: 3. Project scope only — anything Expenses-specific belongs
--       to the Expenses workstream.
--   anything else -> no API access.
--   (lib/storage-references.ts validates N7/N6/W4 for finalize/send-email.)
--
-- customer-site-files (bucket public = false; reads are signed URLs):
--   P5  customer-sites/{customerId|unassigned}/ppd-json/{projectId}/{file}
--       (lib/ppd-json-storage.ts buildPpdJsonStoragePath). Folders: 4.
--   F7  customer-sites/{customerId|unassigned}/product-files/{productKey}/{fileKey}/{projectId}/{file}
--       (lib/product-files/storage.ts buildProductFileStoragePath). Folders: 6.
--   anything else -> no API access.
--
-- RULES
--   N7, N6  read: caller can access the project AND the company segment is
--                 the project's real company. write: NONE (server-signed
--                 only). So a technician can neither plant nor overwrite
--                 another technician's native photo directly; through the
--                 server route the uploader segment is always the verified
--                 caller, and same-path retries by the same technician are
--                 upserts on the signed URL.
--   W4      if a job_card_submissions or job_card_drafts row with that
--           submission_id exists: caller must be able to access its project
--           (submission first, then draft). If none exists yet (photos
--           uploaded before the first save, or abandoned): only the object's
--           OWNER (the uploader) may read or write it.
--   R4      read/write: caller can access {projectId}.
--   P5, F7  read: caller can access {projectId}. write: also the customer
--           segment must equal the project's customer (or 'unassigned' when
--           the project has none).
--   UPDATE / DELETE: no policy in either bucket (default deny). Upserts onto
--   an existing object therefore fail for API callers (the app's upserts
--   always target fresh timestamped names). App remove() calls stay no-ops in
--   job-card-photos exactly as today. In customer-site-files, revision 4
--   REMOVES the bucket-wide authenticated UPDATE/DELETE policies (no app code
--   uses them).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Preconditions (abort on mismatch)
-- ----------------------------------------------------------------------------
do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'storage' and table_name = 'objects'
        and column_name in ('owner', 'owner_id', 'name', 'bucket_id')) <> 4 then
    raise exception '0002: storage.objects must have owner, owner_id, name and bucket_id columns';
  end if;
  if not exists (select 1 from storage.buckets where id = 'job-card-photos' and public) then
    raise exception '0002: bucket job-card-photos missing or not public (unexpected state)';
  end if;
  if not exists (select 1 from storage.buckets where id = 'customer-site-files' and not public) then
    raise exception '0002: bucket customer-site-files missing or public (unexpected state)';
  end if;
end
$$;


-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- W4 authorization. SECURITY DEFINER because it must see whether a
-- submission/draft row exists at all, independent of the caller's RLS view
-- ("invisible" must not be mistaken for "not saved yet"). It answers only
-- about the caller. RPC note: for a guessed submission id it reveals
-- exists-and-inaccessible vs not-saved; ids are random UUIDs.
create or replace function public.job_card_photo_submission_access(p_submission_id text, p_object_owner text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select s.project_id into v_project_id
  from public.job_card_submissions s
  where s.submission_id = p_submission_id;

  if v_project_id is null then
    select d.project_id into v_project_id
    from public.job_card_drafts d
    where d.submission_id = p_submission_id;
  end if;

  if v_project_id is not null then
    return public.can_access_project(v_project_id);
  end if;

  -- Not saved yet (or abandoned): the uploader only.
  return p_object_owner is not null and p_object_owner = auth.uid()::text;
end;
$$;

comment on function public.job_card_photo_submission_access(text, text) is
  'Web photo path {submissionId}/...: project access of the stored submission/draft; before the first save, only the object owner.';

revoke all on function public.job_card_photo_submission_access(text, text) from public, anon;
grant execute on function public.job_card_photo_submission_access(text, text) to authenticated;


-- job-card-photos object authorization (SECURITY INVOKER; delegates every
-- table read to SECURITY DEFINER helpers). Every ::uuid cast runs only after
-- its regex check, inside plpgsql control flow.
create or replace function public.job_card_photo_object_access(p_name text, p_object_owner text, p_for_write boolean)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_f text[] := storage.foldername(p_name);
  v_depth integer := coalesce(array_length(storage.foldername(p_name), 1), 0);
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_safe constant text := '^[A-Za-z0-9_-]+$';
begin
  -- N7 native current / N6 native pre-Checkpoint-2
  if (v_depth = 6 and v_f[1] ~* v_uuid and v_f[2] ~* v_uuid and v_f[3] ~* v_uuid)
     or (v_depth = 5 and v_f[1] ~* v_uuid and v_f[2] ~* v_uuid and v_f[3] ~ v_safe) then
    if p_for_write then
      return false; -- server-signed uploads only
    end if;
    return public.can_access_project(v_f[2]::uuid)
       and v_f[1]::uuid = public.project_company_id(v_f[2]::uuid);
  end if;

  -- R4 receipts
  if v_depth = 3 and v_f[1] = 'expenses' then
    if v_f[2] !~* v_uuid or v_f[3] !~* v_uuid then
      return false;
    end if;
    return public.can_access_project(v_f[2]::uuid);
  end if;

  -- W4 web photos
  if v_depth = 3 and v_f[1] ~ v_safe then
    return public.job_card_photo_submission_access(v_f[1], p_object_owner);
  end if;

  return false;
end;
$$;

comment on function public.job_card_photo_object_access(text, text, boolean) is
  'job-card-photos path families N7/N6 (native, project members read, server-signed writes only), W4 (web, submission project or pre-save owner), R4 (receipts, project access); everything else denied.';

revoke all on function public.job_card_photo_object_access(text, text, boolean) from public, anon;
grant execute on function public.job_card_photo_object_access(text, text, boolean) to authenticated;


-- customer-site-files object authorization (SECURITY INVOKER).
create or replace function public.customer_site_file_object_access(p_name text, p_for_write boolean)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_f text[] := storage.foldername(p_name);
  v_depth integer := coalesce(array_length(storage.foldername(p_name), 1), 0);
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_project_text text;
  v_project uuid;
begin
  if v_depth < 4 or v_f[1] <> 'customer-sites' then
    return false;
  end if;

  if v_depth = 4 and v_f[3] = 'ppd-json' then
    v_project_text := v_f[4];          -- P5
  elsif v_depth = 6 and v_f[3] = 'product-files' then
    v_project_text := v_f[6];          -- F7
  else
    return false;
  end if;

  if v_project_text !~* v_uuid then
    return false;
  end if;
  v_project := v_project_text::uuid;

  if not public.can_access_project(v_project) then
    return false;
  end if;
  if not p_for_write then
    return true;
  end if;
  return v_f[2] = coalesce(public.project_customer_id(v_project)::text, 'unassigned');
end;
$$;

comment on function public.customer_site_file_object_access(text, boolean) is
  'customer-site-files path families P5/F7: project access for reads; writes also require the customer segment to match the project''s customer.';

revoke all on function public.customer_site_file_object_access(text, boolean) from public, anon;
grant execute on function public.customer_site_file_object_access(text, boolean) to authenticated;


-- ----------------------------------------------------------------------------
-- job-card-photos policies
-- ----------------------------------------------------------------------------
drop policy if exists "Allow reads (dev) 17gh87i_0" on storage.objects;
drop policy if exists "Allow uploads (dev) 17gh87i_0" on storage.objects;

drop policy if exists job_card_photos_select on storage.objects;
create policy job_card_photos_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-card-photos'
    and public.job_card_photo_object_access(name, coalesce(owner_id, owner::text), false)
  );

drop policy if exists job_card_photos_insert on storage.objects;
create policy job_card_photos_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-card-photos'
    and public.job_card_photo_object_access(name, coalesce(owner_id, owner::text), true)
  );


-- ----------------------------------------------------------------------------
-- customer-site-files policies
-- ----------------------------------------------------------------------------
drop policy if exists "Authenticated users can upload customer site files" on storage.objects;
drop policy if exists "Authenticated users can read customer site files" on storage.objects;
drop policy if exists "Authenticated users can update customer site files" on storage.objects;
drop policy if exists "Authenticated users can delete customer site files" on storage.objects;

drop policy if exists customer_site_files_objects_select on storage.objects;
create policy customer_site_files_objects_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'customer-site-files'
    and public.customer_site_file_object_access(name, false)
  );

drop policy if exists customer_site_files_objects_insert on storage.objects;
create policy customer_site_files_objects_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'customer-site-files'
    and public.customer_site_file_object_access(name, true)
  );


-- Revision 3 leftover (never applied): the old two-argument helper.
drop function if exists public.job_card_photo_object_access(text, boolean);


-- ----------------------------------------------------------------------------
-- ROLLBACK (restores the exact pre-0002 production-equivalent state; one txn):
--   drop policy if exists job_card_photos_select on storage.objects;
--   drop policy if exists job_card_photos_insert on storage.objects;
--   drop policy if exists customer_site_files_objects_select on storage.objects;
--   drop policy if exists customer_site_files_objects_insert on storage.objects;
--   create policy "Allow reads (dev) 17gh87i_0" on storage.objects
--     for select to public using (bucket_id = 'job-card-photos');
--   create policy "Allow uploads (dev) 17gh87i_0" on storage.objects
--     for insert to public with check (bucket_id = 'job-card-photos');
--   create policy "Authenticated users can upload customer site files" on storage.objects
--     for insert to authenticated with check (bucket_id = 'customer-site-files');
--   create policy "Authenticated users can read customer site files" on storage.objects
--     for select to authenticated using (bucket_id = 'customer-site-files');
--   create policy "Authenticated users can update customer site files" on storage.objects
--     for update to authenticated using (bucket_id = 'customer-site-files')
--     with check (bucket_id = 'customer-site-files');
--   create policy "Authenticated users can delete customer site files" on storage.objects
--     for delete to authenticated using (bucket_id = 'customer-site-files');
--   drop function if exists public.job_card_photo_object_access(text, text, boolean);
--   drop function if exists public.customer_site_file_object_access(text, boolean);
--   drop function if exists public.job_card_photo_submission_access(text, text);
-- Before rollback, compare against the policy snapshot captured by
-- 00_v1dev_preflight_readonly.sql and restore THAT if it differs.
-- ----------------------------------------------------------------------------
