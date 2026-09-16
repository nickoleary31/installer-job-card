-- Developer Sheets follow-up: fix has_project_access() to mirror
-- lib/project-access.ts:authorizeProjectAccess() exactly.
--
-- WHY: the version shipped in 20260915000000_developer_sheets_phase1_foundation.sql (already
-- applied to Installer Sheetz Dev and committed — NOT modified here) checked the
-- project_assignments branch independently of company_memberships. The rest of the app's
-- authorizeProjectAccess() requires an active company_memberships row with role = 'technician'
-- for the SAME company as the project, in addition to an active project_assignments row — mere
-- company membership with no assignment must never grant access. This migration replaces only
-- the function body so Developer Sheets access matches that existing semantic exactly:
--   global admin
--   OR active company admin
--   OR (active company technician membership AND active project assignment, same company)
--
-- No table, RLS policy, trigger, or storage policy changes. CREATE OR REPLACE on the same
-- signature (has_project_access(uuid)) preserves the function's existing grants automatically;
-- the revoke/grant lines below are re-stated only for explicitness, matching this repo's
-- convention of always showing grants alongside the function they apply to.

create or replace function public.has_project_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_global_admin()
    or exists (
      select 1
      from public.projects p
      join public.company_memberships cm on cm.company_id = p.company_id
      where p.id = p_project_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
        and cm.is_active = true
    )
    or exists (
      select 1
      from public.projects p
      join public.company_memberships cm on cm.company_id = p.company_id
      join public.project_assignments pa
        on pa.project_id = p.id
        and pa.user_id = auth.uid()
        and pa.is_active = true
      where p.id = p_project_id
        and cm.user_id = auth.uid()
        and cm.role = 'technician'
        and cm.is_active = true
    );
$$;

revoke all on function public.has_project_access(uuid) from public;
grant execute on function public.has_project_access(uuid) to authenticated;
