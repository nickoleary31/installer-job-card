-- ============================================================================
-- DRAFT 0003 — Q1: an inactive or missing user_profiles row revokes ALL access
-- (revision 3, Phase 2H final 3359107; revision 4: main 5ded8e7 / mobile 36938d1)
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
--   4. The matching APP change covers every service-role route. Service-role
--      routes never see these policies. Status at revision 4:
--        DONE  authorizeProjectAccess / decideProjectAccess / decideCompanyAccess
--              refuse an inactive or missing profile for every requester
--              (main 5ded8e7 PR #28 and mobile 36938d1), covering send-email,
--              Zoho project routes, expense-report, auto-publish and the native
--              finalize/photo-upload-url/history routes. The native outbox gets
--              403 -> authorization-blocked (re-claimable after reactivation).
--        OPEN  authorizeCompanyUserManager (company-users search, add-existing,
--              invite) still checks is_active only for global admins. An
--              inactive company admin can still manage company users through
--              those server routes until it is fixed.
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

-- Revision 4: the customer tables (RLS enabled by 0001 §10A-10C).
drop policy if exists customers_active_profile_required on public.customers;
create policy customers_active_profile_required
  on public.customers as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists customer_accounts_active_profile_required on public.customer_accounts;
create policy customer_accounts_active_profile_required
  on public.customer_accounts as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists customer_site_files_active_profile_required on public.customer_site_files;
create policy customer_site_files_active_profile_required
  on public.customer_site_files as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

-- public.expenses: intentionally NOT covered here. It belongs to the Expenses
-- workstream, which should AND public.is_active_user() into its own policies.

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
-- NOT covered here: public.expenses (Expenses workstream; see above).
-- Supabase Auth sessions stay valid; for immediate lock-out also ban the auth
-- user through the admin API.
--
-- ROLLBACK:
--   drop policy if exists user_profiles_active_profile_required on public.user_profiles;
--   drop policy if exists companies_active_profile_required on public.companies;
--   drop policy if exists projects_active_profile_required on public.projects;
--   drop policy if exists company_memberships_active_profile_required on public.company_memberships;
--   drop policy if exists project_assignments_active_profile_required on public.project_assignments;
--   drop policy if exists customers_active_profile_required on public.customers;
--   drop policy if exists customer_accounts_active_profile_required on public.customer_accounts;
--   drop policy if exists customer_site_files_active_profile_required on public.customer_site_files;
--   drop policy if exists job_card_submissions_active_profile_required on public.job_card_submissions;
--   drop policy if exists job_card_drafts_active_profile_required on public.job_card_drafts;
--   drop policy if exists company_form_products_active_profile_required on public.company_form_products;
--   drop policy if exists storage_objects_active_profile_required on storage.objects;
--   drop function if exists public.is_active_user();
-- ----------------------------------------------------------------------------
