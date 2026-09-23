-- ============================================================================
-- DRAFT 0003 — Q1: an inactive or missing user_profiles row revokes ALL access
-- (revision 3, Phase 2H final 3359107)
-- STATUS: NOT APPLIED. Outside supabase/migrations/ on purpose.
-- Target when applied: Installer Sheetz V1 Dev (gewtjutfjrmhwmjlovly) only.
--
-- Product decision Q1: user_profiles.is_active = false must ultimately revoke
-- all user access, but only after a V1 Dev preflight confirms legitimate
-- users are correctly marked active. Users who hold active memberships or
-- assignments but have NO profile row are data-integrity defects to repair by
-- hand first. This file never creates profiles.
--
-- APPLY ONLY WHEN ALL OF THESE HOLD:
--   1. 0001 (and 0002 if adopted) are applied and have passed regression.
--   2. The preflight below passes (it aborts the whole file otherwise).
--   3. A human has reviewed the NOTICE list of inactive profiles that still
--      hold active memberships, and confirmed each one should lose access.
--   4. The matching APP change has shipped (audit §12, "Q1 app side"):
--      authorizeProjectAccess and authorizeCompanyUserManager must return 403
--      when the requester's profile is inactive or missing. Every Phase 2H
--      route (finalize, photo-upload-url, history) runs with the service role
--      and never sees these policies. Without that change, a deactivated
--      technician could still finalize through the native outbox. With it,
--      the outbox gets 403 -> authorization-blocked (re-claimable if the user
--      is reactivated), which is the contract's intended semantics.
--
-- MECHANISM: one RESTRICTIVE policy per table (and one on storage.objects).
-- PostgreSQL ANDs restrictive policies with the permissive ones from 0001,
-- so no helper or policy from 0001 changes. Rollback = drop these policies
-- (bottom of the file).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Preflight (blocking)
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing_members uuid[];
  v_missing_assignees uuid[];
  v_inactive_with_access uuid[];
begin
  select array_agg(distinct cm.user_id) into v_missing_members
  from public.company_memberships cm
  where cm.is_active
    and not exists (select 1 from public.user_profiles up where up.id = cm.user_id);

  select array_agg(distinct pa.user_id) into v_missing_assignees
  from public.project_assignments pa
  where pa.is_active
    and not exists (select 1 from public.user_profiles up where up.id = pa.user_id);

  if v_missing_members is not null or v_missing_assignees is not null then
    raise exception 'Q1 preflight failed: active memberships without a user_profiles row for users %; active assignments without a user_profiles row for users %. Repair these profiles by hand (do not auto-create), then re-run.',
      coalesce(v_missing_members, '{}'), coalesce(v_missing_assignees, '{}');
  end if;

  select array_agg(distinct up.id) into v_inactive_with_access
  from public.user_profiles up
  where not up.is_active
    and (
      exists (select 1 from public.company_memberships cm where cm.user_id = up.id and cm.is_active)
      or exists (select 1 from public.project_assignments pa where pa.user_id = up.id and pa.is_active)
    );

  raise notice 'Q1: these inactive profiles still hold active memberships/assignments and WILL lose all access: %',
    coalesce(v_inactive_with_access, '{}');
end
$$;


-- ----------------------------------------------------------------------------
-- Helper
-- ----------------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.is_active
  );
$$;

comment on function public.is_active_user() is
  'Caller has a user_profiles row with is_active = true. A missing profile counts as inactive (Q1).';

revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated;


-- ----------------------------------------------------------------------------
-- Restrictive policies. (select ...) makes each check an initPlan, evaluated
-- once per statement.
-- ----------------------------------------------------------------------------

-- user_profiles: an inactive user may still READ their own row. At 3359107,
-- lib/auth/userContext.ts turns a readable is_active = false row into an
-- explicit { kind: "denied", reason: "inactive-user" } state, but treats an
-- unreadable/missing row as an ACTIVE user with no data. Hiding the row would
-- therefore replace a clean lock-out with a misleading empty app. Writing the
-- row still requires an active profile.
drop policy if exists user_profiles_active_profile_required on public.user_profiles;
create policy user_profiles_active_profile_required
  on public.user_profiles
  as restrictive
  for all
  to authenticated
  using ((select public.is_active_user()) or id = (select auth.uid()))
  with check ((select public.is_active_user()));

drop policy if exists companies_active_profile_required on public.companies;
create policy companies_active_profile_required
  on public.companies as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists projects_active_profile_required on public.projects;
create policy projects_active_profile_required
  on public.projects as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists company_memberships_active_profile_required on public.company_memberships;
create policy company_memberships_active_profile_required
  on public.company_memberships as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists project_assignments_active_profile_required on public.project_assignments;
create policy project_assignments_active_profile_required
  on public.project_assignments as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists expenses_active_profile_required on public.expenses;
create policy expenses_active_profile_required
  on public.expenses as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists job_card_submissions_active_profile_required on public.job_card_submissions;
create policy job_card_submissions_active_profile_required
  on public.job_card_submissions as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists job_card_drafts_active_profile_required on public.job_card_drafts;
create policy job_card_drafts_active_profile_required
  on public.job_card_drafts as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

-- company_form_products already has RLS; "all access" includes it.
drop policy if exists company_form_products_active_profile_required on public.company_form_products;
create policy company_form_products_active_profile_required
  on public.company_form_products as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

-- Storage, every bucket (job-card-photos and customer-site-files). Signed
-- uploads and service-role access are unaffected.
drop policy if exists storage_objects_active_profile_required on storage.objects;
create policy storage_objects_active_profile_required
  on storage.objects as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));


-- ----------------------------------------------------------------------------
-- NOT covered here (tracked in the audit): customers, customer_accounts,
-- customer_site_files have no RLS at all yet, so a deactivated user can still
-- reach them until those tables get their own RLS pass. Supabase Auth
-- sessions stay valid; for immediate lock-out also ban the auth user through
-- the admin API.
--
-- ROLLBACK:
--   drop policy if exists user_profiles_active_profile_required on public.user_profiles;
--   drop policy if exists companies_active_profile_required on public.companies;
--   drop policy if exists projects_active_profile_required on public.projects;
--   drop policy if exists company_memberships_active_profile_required on public.company_memberships;
--   drop policy if exists project_assignments_active_profile_required on public.project_assignments;
--   drop policy if exists expenses_active_profile_required on public.expenses;
--   drop policy if exists job_card_submissions_active_profile_required on public.job_card_submissions;
--   drop policy if exists job_card_drafts_active_profile_required on public.job_card_drafts;
--   drop policy if exists company_form_products_active_profile_required on public.company_form_products;
--   drop policy if exists storage_objects_active_profile_required on storage.objects;
--   drop function if exists public.is_active_user();
-- ----------------------------------------------------------------------------
