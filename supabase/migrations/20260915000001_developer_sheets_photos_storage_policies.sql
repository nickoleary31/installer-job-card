-- Developer Sheets Phase 1: private Storage bucket + a dedicated path-authorization helper for
-- documentation photos. DO NOT apply until reviewed. Written for review only — not run against any
-- database yet.
--
-- Deliberately NOT modeled on job-card-photos (public bucket, unrestricted public read/insert).
-- Modeled on the private customer-site-files bucket (202605080002_customer_site_files_storage_
-- policies.sql) instead, but improved: customer-site-files policies only check bucket_id, so any
-- authenticated user can read/write any file in that bucket regardless of project.
--
-- PATH CONVENTION (must be followed by application code): every object's path is exactly
--   {projectId}/{cardId}/{entryId}/{generatedFilename}
-- {generatedFilename} must be produced/sanitized by application code (reusing the existing
-- safeName pattern from app/page.tsx) and must never contain "/" — a raw client filename must
-- never be trusted to determine path structure, and this convention requires exactly four segments.
--
-- WHY A DEDICATED HELPER INSTEAD OF INLINE POLICY EXPRESSIONS: an earlier draft of these policies
-- cast object-path segments to uuid directly inside the USING/WITH CHECK expressions. Postgres does
-- not guarantee left-to-right short-circuit evaluation of "bucket_id = '...' and exists(...)", and
-- RLS is wrapped as a security-barrier view specifically to *prevent* the planner from reordering
-- quals — so a malformed path from a completely different bucket (e.g. job-card-photos, whose
-- paths are not uuid-shaped) could in principle have had its cast evaluated anyway and thrown a
-- hard error instead of simply being denied. can_access_developer_sheet_photo_path() below performs
-- all parsing internally, in a language that supports exception handling (plpgsql, not sql), and
-- guarantees it always returns a plain boolean — never an error — for any input whatsoever. The
-- policies below no longer contain any direct cast from a path string.
--
-- DEPENDS ON: public.has_project_access(), public.developer_sheet_cards,
-- public.developer_sheet_documentation_entries, public.companies.workflow_type — all from
-- 20260915000000_developer_sheets_phase1_foundation.sql.

insert into storage.buckets (id, name, public)
values ('developer-sheet-photos', 'developer-sheet-photos', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------------------------
-- Path-authorization helper.
--
-- SECURITY DEFINER, not SECURITY INVOKER: this function must query developer_sheet_cards /
-- developer_sheet_documentation_entries / companies from inside a storage.objects RLS policy
-- evaluation. Running as SECURITY INVOKER would make those lookups subject to the querying role's
-- own RLS on those tables (which already independently call has_project_access()) — not infinite
-- recursion, since these are different tables terminating in a fixed number of joins, but it would
-- make this function's behavior an incidental side effect of those tables' RLS policies rather than
-- something fully determined by this function's own body — harder to audit, and liable to silently
-- change meaning if those policies are ever edited for an unrelated reason. SECURITY DEFINER makes
-- this function self-contained and independently auditable.
--
-- Because SECURITY DEFINER runs as the function's owning role, it does NOT inherit RLS filtering
-- from the tables it queries — so this function performs its own explicit
-- public.has_project_access(c.project_id) check inside the query below. That call is not optional
-- decoration: removing it would turn this function into an unconditional "does this path exist"
-- lookup, i.e. a genuine authorization bypass, regardless of who is asking. auth.uid() itself is
-- unaffected by SECURITY DEFINER's role switch — Supabase resolves it from the session's JWT claims,
-- not from the executing role — so the authorization check below is always evaluated for the real
-- connected user, exactly as it would be for a SECURITY INVOKER function.
-- ---------------------------------------------------------------------------------------------

create or replace function public.can_access_developer_sheet_photo_path(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_segments text[];
  v_project_id uuid;
  v_card_id uuid;
  v_entry_id uuid;
begin
  -- storage.foldername() returns every "/"-delimited segment except the last (the filename).
  -- The convention {projectId}/{cardId}/{entryId}/{filename} must yield exactly 3 folder segments.
  v_segments := storage.foldername(p_object_name);

  if v_segments is null or array_length(v_segments, 1) is distinct from 3 then
    return false;
  end if;

  begin
    v_project_id := v_segments[1]::uuid;
    v_card_id := v_segments[2]::uuid;
    v_entry_id := v_segments[3]::uuid;
  exception
    when invalid_text_representation then
      -- Any segment that isn't a well-formed uuid (empty, garbage, a different bucket's path
      -- shape entirely) is simply unauthorized, never an error.
      return false;
  end;

  return exists (
    select 1
    from public.developer_sheet_documentation_entries e
    join public.developer_sheet_cards c on c.id = e.card_id
    join public.companies co on co.id = c.company_id
    where e.id = v_entry_id
      and e.card_id = v_card_id
      and c.project_id = v_project_id
      and co.workflow_type = 'developer_sheet'
      and public.has_project_access(c.project_id)
  );
end;
$$;

revoke all on function public.can_access_developer_sheet_photo_path(text) from public;
grant execute on function public.can_access_developer_sheet_photo_path(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Policies — no direct path-string casts remain here; all parsing/validation lives in the
-- helper above, which cannot throw.
-- ---------------------------------------------------------------------------------------------

drop policy if exists "developer_sheet_photos_storage_select" on storage.objects;
create policy "developer_sheet_photos_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'developer-sheet-photos'
  and public.can_access_developer_sheet_photo_path(name)
);

drop policy if exists "developer_sheet_photos_storage_insert" on storage.objects;
create policy "developer_sheet_photos_storage_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'developer-sheet-photos'
  and public.can_access_developer_sheet_photo_path(name)
);

-- No update or delete policy is defined for this bucket. Photo bytes are immutable once uploaded
-- (each upload gets a unique generated path, so there is never a legitimate need to overwrite an
-- existing object), and "removing" a photo is always a soft-delete of its
-- developer_sheet_documentation_photos row (is_active = false, admin-only — see prior migration),
-- never a Storage object deletion. This guarantees a technician's uploaded evidence can never be
-- silently destroyed by another user, at the object level as well as the DB level.
