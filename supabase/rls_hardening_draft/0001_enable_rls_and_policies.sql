-- ============================================================================
-- DRAFT — RLS Hardening for Installer Sheetz V1
--   revision 2: adversarial review (baseline commit 7707650)
--   revision 3: reconciled with the FINAL Phase 2H commit 3359107 and the
--               product decisions Q1-Q8 / B1-B2 (commit b635f72)
--   revision 4: re-baselined on origin/main 5ded8e7 (PR #28) and mobile
--               36938d1 (Checkpoints 1+2). Adds RLS for customers,
--               customer_accounts, customer_site_files; Q9 content freeze;
--               WITHDRAWS the expenses policies (Expenses is a separate
--               workstream). See docs/RLS_Revision4_Rebaseline.md.
-- STATUS: NOT APPLIED. NOT part of supabase/migrations/ on purpose, so
-- `supabase db push` / `db diff` / CI cannot pick it up by accident.
--
-- !! This repo commits supabase/.temp/project-ref = uboutcndhvygmwfjztla
-- !! (PRODUCTION). Never run Supabase CLI commands from this worktree.
-- !! Use an explicit V1 Dev connection proven by 00_v1dev_preflight_readonly.sql.
--
-- APPLY ORDER (V1 Dev only, each step gated on the previous one's checks):
--   0. 00_v1dev_preflight_readonly.sql (read-only; proves the target is V1
--      Dev and captures the pre-state for rollback)
--   1. supabase/migrations/20260921120000_job_card_submissions_technician_submit.sql
--      (Phase 2H; Section 0 below refuses to run without its columns)
--   2. THIS FILE (table RLS)                       -> web + Android regression
--   3. 0002_job_card_photos_storage_policies.sql   -> storage regression
--      (only after the Q10 signed-upload check passes)
--   4. repair data until 0003's preflight passes, then
--      0003_enforce_active_profiles.sql (Q1)       -> regression
--   5. VALIDATE the Section 11 FKs once Section 0 reports zero mismatches.
-- Target (when eventually applied): Installer Sheetz V1 Dev ONLY
--   (gewtjutfjrmhwmjlovly). Never run this against Production
--   (uboutcndhvygmwfjztla) or Developer Sheets Dev (ipjwhhyaurjzgaychoii)
--   without a separate, explicit review.
--
-- Companion doc: docs/RLS_Hardening_Audit.md (audit, findings, policy matrix,
-- risks, regression test plan). Read it first — this file is the mechanical
-- follow-through of the decisions explained there. Section numbers in the
-- doc's "revision 2 changes" list map onto the sections below.
--
-- SCOPE (revision 4): user_profiles, company_memberships, companies, projects,
--   project_assignments, job_card_submissions, job_card_drafts, customers,
--   customer_accounts, customer_site_files.
-- NOT touched: public.expenses (owned by the separate Expenses workstream,
-- which builds its policies on the helpers in Section 1 — see Section 8),
-- storage (0002), company_form_products (existing RLS kept) and zoho_fsm_*
-- (existing service-role-only RLS kept).
--
-- Designed to run as ONE transaction (the Supabase CLI wraps each migration
-- file in one). Do not run it statement-by-statement.
--
-- DESIGN RULES (every policy below follows all of them):
--   1. Authority is derived from the AUTHORITATIVE project row
--      (projects.company_id), never from a row's own denormalized, client-
--      supplied company_id. (Revision 1 trusted job_card_*.company_id, which
--      let a company admin write rows into another company's project.)
--   2. A project assignment never grants access on its own; the caller must
--      also hold an ACTIVE membership in the project's company. This is what
--      lib/project-access.ts authorizeProjectAccess already requires
--      (membership.role === "technician" && membership.is_active). Revision 1
--      dropped it, so a deactivated technician kept full access through a
--      still-active project_assignments row.
--   3. Policies call only the SECURITY DEFINER helpers in Section 1 — no raw
--      subqueries into other RLS-protected tables, so no policy's result
--      depends on another table's RLS as a side effect.
--   4. No DELETE/UPDATE policy exists unless a real client code path needs
--      it (default deny otherwise).
--   5. Column/transition rules RLS cannot express (review fields, immutable
--      ownership keys, privileged profile columns) are enforced by BEFORE
--      triggers that constrain API roles only (see Section 2).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- SECTION 0: Pre-flight diagnostics (read-only; reports, never blocks)
--
-- Rule 1 plus the Section 11 composite FKs reject rows whose company_id
-- does not match their project's company. Any existing mismatched rows are
-- legacy data-integrity defects (e.g. a stale localStorage company/project
-- pair). They stay readable to the project's real company, but can no longer
-- be updated through the API. Run the same queries by hand before applying,
-- and clean up before running the Section 11 VALIDATE step.
-- ----------------------------------------------------------------------------

-- Hard precondition: the job_card_submissions guard (Section 9) references the
-- Phase 2H columns. Refuse to run until 20260921120000 has been applied.
do $$
begin
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_card_submissions'
      and column_name in ('technician_submitted_at', 'submission_snapshot_hash')
  ) <> 2 then
    raise exception 'rls-hardening: apply 20260921120000_job_card_submissions_technician_submit.sql (Phase 2H) first';
  end if;
end
$$;

do $$
declare
  v_submissions bigint;
  v_drafts bigint;
  v_site_file_company bigint;
  v_site_file_customer bigint;
  v_project_customer_company bigint;
  v_members_without_profile bigint;
  v_assignees_without_profile bigint;
  v_inactive_profiles_with_access bigint;
begin
  -- Q1 preparation (report only here; 0003 blocks on the first two).
  select count(distinct cm.user_id) into v_members_without_profile
  from public.company_memberships cm
  where cm.is_active
    and not exists (select 1 from public.user_profiles up where up.id = cm.user_id);

  select count(distinct pa.user_id) into v_assignees_without_profile
  from public.project_assignments pa
  where pa.is_active
    and not exists (select 1 from public.user_profiles up where up.id = pa.user_id);

  select count(distinct up.id) into v_inactive_profiles_with_access
  from public.user_profiles up
  where not up.is_active
    and exists (select 1 from public.company_memberships cm where cm.user_id = up.id and cm.is_active);

  raise notice 'rls-hardening preflight (Q1): active members without a profile=%, active assignees without a profile=%, inactive profiles that still hold active memberships=%',
    v_members_without_profile, v_assignees_without_profile, v_inactive_profiles_with_access;

  select count(*) into v_submissions
  from public.job_card_submissions s
  join public.projects p on p.id = s.project_id
  where p.company_id <> s.company_id;

  select count(*) into v_drafts
  from public.job_card_drafts d
  join public.projects p on p.id = d.project_id
  where p.company_id <> d.company_id;

  select count(*) into v_site_file_company
  from public.customer_site_files f
  join public.projects p on p.id = f.project_id
  where p.company_id <> f.company_id;

  select count(*) into v_site_file_customer
  from public.customer_site_files f
  join public.projects p on p.id = f.project_id
  where f.customer_id is not null
    and f.customer_id is distinct from p.customer_id;

  -- Projects linked to a customer (site) of a different company. RLS never
  -- lets such a link grant customer access (can_access_customer requires the
  -- same company), but the data should be cleaned up.
  select count(*) into v_project_customer_company
  from public.projects p
  join public.customers c on c.id = p.customer_id
  where c.company_id <> p.company_id;

  raise notice 'rls-hardening preflight: company/project mismatches — job_card_submissions=%, job_card_drafts=%, customer_site_files=%; customer_site_files customer mismatches=%; projects linked to another company''s customer=%',
    v_submissions, v_drafts, v_site_file_company, v_site_file_customer, v_project_customer_company;
end
$$;


-- ----------------------------------------------------------------------------
-- SECTION 1: Authorization helpers
--
-- All SECURITY DEFINER + `set search_path = ''` (every identifier is schema-
-- qualified; built-ins resolve via the implicit pg_catalog), STABLE, and they
-- only ever answer questions about the CALLER (auth.uid()).
--
-- Why SECURITY DEFINER is safe here and avoids policy recursion: the owner
-- (the migration role, which owns these tables) bypasses RLS on tables it owns,
-- so a helper's internal reads never evaluate any policy. Two invariants
-- must hold, and the audit's post-apply queries verify both:
--   * helpers are owned by the owner of the tables they read (or a BYPASSRLS
--     role);
--   * FORCE ROW LEVEL SECURITY is NOT enabled on any table in scope (FORCE
--     would make helpers evaluate policies -> infinite recursion, e.g.
--     company_memberships policy -> is_active_company_admin -> RLS on
--     company_memberships -> ...).
--
-- RPC exposure: helpers in `public` are callable via /rest/v1/rpc/<name>.
-- Every helper returns only facts about the caller's own access, so calling
-- one directly reveals nothing the caller could not learn by querying under
-- RLS. project_company_id() is deliberately caller-scoped for this reason: an
-- unscoped version would map any project UUID (listable from the public
-- job-card-photos bucket paths) to its company UUID.
--
-- EXECUTE is revoked from PUBLIC *and* anon explicitly: Supabase's default
-- privileges grant EXECUTE on new public functions to anon directly, so a
-- revoke from PUBLIC alone leaves anon's grant in place.
--
-- public.is_global_admin() already exists (20260730120000_company_form_
-- products.sql, search_path = public, fully-qualified body) and is reused
-- as-is.
-- ----------------------------------------------------------------------------

create or replace function public.is_active_company_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = p_company_id
      and cm.user_id = auth.uid()
      and cm.role = 'admin'
      and cm.is_active
  );
$$;

comment on function public.is_active_company_admin(uuid) is
  'Caller is an active admin of the given company. Mirrors authorizeCompanyUserManager (lib/company-users/admin-api.ts).';

revoke all on function public.is_active_company_admin(uuid) from public, anon;
grant execute on function public.is_active_company_admin(uuid) to authenticated;


create or replace function public.has_active_company_membership(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = p_company_id
      and cm.user_id = auth.uid()
      and cm.is_active
  );
$$;

comment on function public.has_active_company_membership(uuid) is
  'Caller holds any active membership (admin or technician) in the given company.';

revoke all on function public.has_active_company_membership(uuid) from public, anon;
grant execute on function public.has_active_company_membership(uuid) to authenticated;


-- Caller-scoped: returns the project's company only when the caller could
-- read that project row under projects_select (global admin, or active member
-- of the project's company); NULL otherwise. Used for the company/project
-- consistency check in WITH CHECK clauses.
create or replace function public.project_company_id(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.company_id
  from public.projects p
  where p.id = p_project_id
    and (
      public.is_global_admin()
      or public.has_active_company_membership(p.company_id)
    );
$$;

comment on function public.project_company_id(uuid) is
  'company_id of a project the caller can read (global admin or active member of its company), else NULL. Caller-scoped so the RPC endpoint is not a cross-tenant project->company oracle.';

revoke all on function public.project_company_id(uuid) from public, anon;
grant execute on function public.project_company_id(uuid) to authenticated;


-- Exact mirror of authorizeProjectAccess, minus its known bug: the company is
-- always derived from the project, never taken from the caller.
create or replace function public.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_global_admin()
      or exists (
        select 1
        from public.projects p
        join public.company_memberships cm
          on cm.company_id = p.company_id
         and cm.user_id = auth.uid()
         and cm.is_active
        where p.id = p_project_id
          and (
            cm.role = 'admin'
            or exists (
              select 1
              from public.project_assignments pa
              where pa.project_id = p.id
                and pa.user_id = auth.uid()
                and pa.is_active
            )
          )
      );
$$;

comment on function public.can_access_project(uuid) is
  'Global admin; OR active admin of the project''s company; OR active member of the project''s company with an active assignment on this project. Mirrors lib/project-access.ts authorizeProjectAccess (keep in sync).';

revoke all on function public.can_access_project(uuid) from public, anon;
grant execute on function public.can_access_project(uuid) to authenticated;


create or replace function public.can_admin_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_global_admin()
      or exists (
        select 1
        from public.projects p
        join public.company_memberships cm
          on cm.company_id = p.company_id
         and cm.user_id = auth.uid()
         and cm.role = 'admin'
         and cm.is_active
        where p.id = p_project_id
      );
$$;

comment on function public.can_admin_project(uuid) is
  'Global admin, or active admin of the project''s company. Gates assignment management; also part of the shared contract for the Expenses workstream.';

revoke all on function public.can_admin_project(uuid) from public, anon;
grant execute on function public.can_admin_project(uuid) to authenticated;


-- Profile visibility between users. Technicians see ACTIVE co-members; an
-- active company admin also sees INACTIVE members of that company (the
-- assignments page must still render deactivated users so they can be
-- reactivated).
create or replace function public.can_view_member_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_memberships mine
    join public.company_memberships theirs
      on theirs.company_id = mine.company_id
     and theirs.user_id = p_user_id
    where mine.user_id = auth.uid()
      and mine.is_active
      and (theirs.is_active or mine.role = 'admin')
  );
$$;

comment on function public.can_view_member_profile(uuid) is
  'Caller shares a company with p_user_id: both active, or caller is an active admin of a company where p_user_id has any membership row.';

revoke all on function public.can_view_member_profile(uuid) from public, anon;
grant execute on function public.can_view_member_profile(uuid) to authenticated;


-- Revision 4: customer (site) helpers.
--
-- Customer visibility mirrors the customers pages at 36938d1: global admins
-- and active admins of the customer's company see every company customer; a
-- technician sees a customer only when it is linked (projects.customer_id)
-- to a project IN THE SAME COMPANY that the technician can access. The
-- same-company condition stops a cross-company project->customer link (see
-- Section 0 counts) from ever granting access.
create or replace function public.can_access_customer(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.customers c
    where c.id = p_customer_id
      and (
        public.is_global_admin()
        or public.is_active_company_admin(c.company_id)
        or exists (
          select 1
          from public.projects p
          where p.customer_id = c.id
            and p.company_id = c.company_id
            and public.can_access_project(p.id)
        )
      )
  );
$$;

comment on function public.can_access_customer(uuid) is
  'Global admin; active admin of the customer''s company; or caller can access a same-company project linked to this customer.';

revoke all on function public.can_access_customer(uuid) from public, anon;
grant execute on function public.can_access_customer(uuid) to authenticated;


-- Caller-scoped like project_company_id(): the company of a customer the
-- caller can access, else NULL. Used by the projects INSERT consistency check.
create or replace function public.customer_company_id(p_customer_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.company_id
  from public.customers c
  where c.id = p_customer_id
    and public.can_access_customer(c.id);
$$;

comment on function public.customer_company_id(uuid) is
  'company_id of a customer the caller can access, else NULL (not a cross-tenant oracle).';

revoke all on function public.customer_company_id(uuid) from public, anon;
grant execute on function public.customer_company_id(uuid) to authenticated;


-- Caller-scoped: the customer (site) of a project the caller can read, else
-- NULL. Used by customer_site_files and the customer-site-files storage
-- policy (0002) to keep file metadata/paths consistent with the project.
create or replace function public.project_customer_id(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.customer_id
  from public.projects p
  where p.id = p_project_id
    and (
      public.is_global_admin()
      or public.has_active_company_membership(p.company_id)
    );
$$;

comment on function public.project_customer_id(uuid) is
  'customer_id of a project the caller can read (global admin or active member of its company), else NULL.';

revoke all on function public.project_customer_id(uuid) from public, anon;
grant execute on function public.project_customer_id(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- SECTION 2: Guard-trigger convention
--
-- The BEFORE triggers in Sections 3, 6, 7, 9, 10, 10A and 10C are SECURITY
-- INVOKER (the default) on purpose: inside an invoker trigger, current_user
-- is the role that issued the statement. (Revision 1's expense guard was
-- SECURITY DEFINER; there current_user is the owner, and its auth.uid()-only
-- check would also have rejected legitimate service-role and SQL-editor
-- writes.)
--
-- Each guard returns immediately for trusted backend roles:
--   service_role   — server routes using SUPABASE_SERVICE_ROLE_KEY (their
--                    own server-side authorization applies)
--   postgres, supabase_admin — migrations / dashboard / SQL editor
-- and constrains every other role (in practice: authenticated, anon). This
-- fails closed for any role not on the trusted list.
--
-- Exception (Section 9): job_card_submissions_guard_write protects data
-- integrity, not authorization, so on UPDATE it also binds service_role. Only
-- the maintenance roles (postgres, supabase_admin) skip it.
--
-- Service-role key naming: main reads SUPABASE_SERVICE_ROLE_KEY; mobile
-- (36938d1) reads SUPABASE_SECRET_KEY first. Both authenticate as the
-- Postgres role service_role, which is what these checks see.
--
-- Caveat for future work: a SECURITY DEFINER function owned by postgres that
-- writes these tables would run with current_user = postgres and bypass the
-- guards. No such function exists; any added later must do its own checks.
--
-- BEFORE ROW triggers run before RLS WITH CHECK is evaluated, so any value a
-- guard assigns to NEW is what the policies then check.
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- SECTION 3: user_profiles
-- ----------------------------------------------------------------------------

alter table public.user_profiles enable row level security;

drop policy if exists user_profiles_select on public.user_profiles;
create policy user_profiles_select
  on public.user_profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_global_admin())
    or public.can_view_member_profile(id)
  );

-- INSERT: none. Profiles are created by the service-role invite route only.

-- UPDATE: self only. The only client write is app/auth/accept-invite/page.tsx
-- (own row). Global-admin profile edits all go through service-role routes
-- (update-display-name, sync-profile-email, change-email), so revision 1's
-- "or is_global_admin()" branch was unused privilege and has been removed.
drop policy if exists user_profiles_update on public.user_profiles;
create policy user_profiles_update
  on public.user_profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- DELETE: none.

-- Column privileges. Revision 1 ran `revoke update (global_role, is_active)`,
-- which is a NO-OP: `authenticated` holds table-level UPDATE through
-- Supabase's default grants, and a column-level REVOKE does not reduce a
-- table-level grant. ("Granting the privilege at the table level and then
-- revoking it for one column will not do what one might wish" — PostgreSQL
-- GRANT docs.) Result: any user could still run
--   update user_profiles set global_role = 'admin' where id = auth.uid()
-- and become a global admin. Correct form: revoke table-level UPDATE, then
-- grant back only the columns accept-invite writes (buildOnboardingProfileUpdate
-- in lib/auth/onboarding.ts).
revoke update on public.user_profiles from anon, authenticated;
grant update (email, display_name, phone, job_title, onboarding_completed_at, updated_at)
  on public.user_profiles to authenticated;

-- Defense in depth: the trigger still holds if a later blanket
-- `grant all ... to authenticated` silently re-opens table-level UPDATE.
-- It also pins `email` to the caller's own verified login email. The invite
-- route resolves "existing user" by user_profiles.email
-- (app/api/company-users/invite/route.ts), so a self-chosen email would let
-- a user be linked into a company, possibly as admin, in place of the invitee.
create or replace function public.user_profiles_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.global_role is distinct from old.global_role
     or new.is_active is distinct from old.is_active
     or new.created_at is distinct from old.created_at then
    raise exception 'user_profiles: id, global_role, is_active and created_at can only be changed server-side'
      using errcode = '42501';
  end if;

  -- auth.jwt() claims are signed by Supabase Auth (not client metadata);
  -- user_metadata is deliberately NOT consulted.
  if new.email is distinct from old.email
     and new.email is not null
     and lower(new.email) is distinct from lower(nullif(auth.jwt() ->> 'email', '')) then
    raise exception 'user_profiles: email may only be set to the signed-in account''s own login email'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_user_profiles_guard_update on public.user_profiles;
create trigger trg_user_profiles_guard_update
  before update on public.user_profiles
  for each row
  execute function public.user_profiles_guard_update();


-- ----------------------------------------------------------------------------
-- SECTION 4: companies
-- ----------------------------------------------------------------------------

alter table public.companies enable row level security;

drop policy if exists companies_select on public.companies;
create policy companies_select
  on public.companies
  for select
  to authenticated
  using (
    (select public.is_global_admin())
    or public.has_active_company_membership(id)
  );

-- INSERT/UPDATE: global admin only (app/companies/page.tsx create, rename,
-- activate/deactivate).
drop policy if exists companies_insert on public.companies;
create policy companies_insert
  on public.companies
  for insert
  to authenticated
  with check ((select public.is_global_admin()));

drop policy if exists companies_update on public.companies;
create policy companies_update
  on public.companies
  for update
  to authenticated
  using ((select public.is_global_admin()))
  with check ((select public.is_global_admin()));

-- DELETE: none.


-- ----------------------------------------------------------------------------
-- SECTION 5: projects
-- ----------------------------------------------------------------------------

alter table public.projects enable row level security;

-- SELECT: global admin, or any ACTIVE member of the project's company.
-- Technicians intentionally see every project in their company, not just
-- assigned ones: app/companies/[companyId]/projects/page.tsx loads all
-- company projects and filters to assigned ones client-side, and
-- app/companies/[companyId]/assignments/page.tsx renders every company
-- project as a matrix column. This matches today's behavior; the exposed
-- columns are project metadata (name, customer display name, location,
-- external_recipient_emails). Revision 1 also granted visibility through a
-- bare assignment, without membership; that branch has been removed (rule 2).
drop policy if exists projects_select on public.projects;
create policy projects_select
  on public.projects
  for select
  to authenticated
  using (
    (select public.is_global_admin())
    or public.has_active_company_membership(company_id)
  );

-- INSERT: global admin or active admin of that company
-- (app/companies/[companyId]/projects/page.tsx canManageCompanyData).
-- Revision 4: a linked customer (site) must belong to the same company.
-- Before this, an admin could link their project to another company's site
-- (customers had no RLS, so it leaked nothing new; now it would be a way
-- around customers RLS through the projects -> customers embed).
drop policy if exists projects_insert on public.projects;
create policy projects_insert
  on public.projects
  for insert
  to authenticated
  with check (
    (
      (select public.is_global_admin())
      or public.is_active_company_admin(company_id)
    )
    and (customer_id is null or public.customer_company_id(customer_id) = company_id)
  );

-- UPDATE / DELETE: none. No client code updates or deletes projects; the
-- Zoho FSM sync uses the service role. Revision 1's "anticipatory" UPDATE
-- policy was removed. It would have let a company admin re-parent a project
-- (company_id) along with all its submissions and drafts.
drop policy if exists projects_update on public.projects;


-- ----------------------------------------------------------------------------
-- SECTION 6: company_memberships
-- ----------------------------------------------------------------------------

alter table public.company_memberships enable row level security;

-- SELECT: own rows (every page's role computation in lib/auth/userContext.ts,
-- and company_form_products_select's raw subquery depends on this branch —
-- do not remove it); global admin; active admin of that company.
-- Technicians do NOT see co-workers' membership rows. Behavior change: the
-- read-only assignment matrix a technician sees on the assignments page
-- shrinks to their own row (audit §9, open question Q3).
drop policy if exists company_memberships_select on public.company_memberships;
create policy company_memberships_select
  on public.company_memberships
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_global_admin())
    or public.is_active_company_admin(company_id)
  );

-- INSERT: global admin (app/companies/page.tsx adds the creator as admin of a
-- new company) or active admin of that company (add-existing route's
-- non-service-role fallback).
drop policy if exists company_memberships_insert on public.company_memberships;
create policy company_memberships_insert
  on public.company_memberships
  for insert
  to authenticated
  with check (
    (select public.is_global_admin())
    or public.is_active_company_admin(company_id)
  );

-- UPDATE: role change / activate / deactivate on the assignments page.
drop policy if exists company_memberships_update on public.company_memberships;
create policy company_memberships_update
  on public.company_memberships
  for update
  to authenticated
  using (
    (select public.is_global_admin())
    or public.is_active_company_admin(company_id)
  )
  with check (
    (select public.is_global_admin())
    or public.is_active_company_admin(company_id)
  );

-- DELETE: none. Membership removal is a soft deactivate (is_active = false)
-- everywhere in the app; a hard delete would also erase the audit trail.
drop policy if exists company_memberships_delete on public.company_memberships;

-- Immutable identity for API callers. The app only ever changes role,
-- is_active and updated_at. Without this guard, an admin of company A holding
-- any row could rewrite its user_id (to add an arbitrary user) or its
-- company_id (bounded only by WITH CHECK). This is done with a trigger, not
-- column grants, because PostgREST upserts (add-existing fallback) emit
-- `ON CONFLICT DO UPDATE SET user_id = EXCLUDED.user_id, ...`, which needs
-- UPDATE privilege on the key columns even when their values are unchanged.
create or replace function public.company_memberships_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.company_id is distinct from old.company_id
     or new.created_at is distinct from old.created_at then
    raise exception 'company_memberships: id, user_id, company_id and created_at are immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_company_memberships_guard_update on public.company_memberships;
create trigger trg_company_memberships_guard_update
  before update on public.company_memberships
  for each row
  execute function public.company_memberships_guard_update();

-- NOTE (business rule, deliberately not enforced here): the "cannot demote or
-- deactivate the last active admin of a company" guard stays client-only
-- (activeAdminCount in assignments/page.tsx). See audit §9.


-- ----------------------------------------------------------------------------
-- SECTION 7: project_assignments
-- ----------------------------------------------------------------------------

alter table public.project_assignments enable row level security;

-- SELECT: own rows; global admin; active admin of the project's company.
-- (Revision 1 used a raw `exists (select from projects ...)` subquery here,
-- which only worked through projects' own RLS as a side effect.)
drop policy if exists project_assignments_select on public.project_assignments;
create policy project_assignments_select
  on public.project_assignments
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_global_admin())
    or public.can_admin_project(project_id)
  );

-- INSERT/UPDATE: global admin or active admin of the project's company
-- (assignments page upsert on (user_id, project_id), and deactivate).
-- Assigning a user who is not an active member of the company grants that
-- user nothing, because can_access_project also requires membership (rule 2).
drop policy if exists project_assignments_insert on public.project_assignments;
create policy project_assignments_insert
  on public.project_assignments
  for insert
  to authenticated
  with check (
    (select public.is_global_admin())
    or public.can_admin_project(project_id)
  );

drop policy if exists project_assignments_update on public.project_assignments;
create policy project_assignments_update
  on public.project_assignments
  for update
  to authenticated
  using (
    (select public.is_global_admin())
    or public.can_admin_project(project_id)
  )
  with check (
    (select public.is_global_admin())
    or public.can_admin_project(project_id)
  );

-- DELETE: none. Unassign is a soft deactivate (is_active = false).
drop policy if exists project_assignments_delete on public.project_assignments;

-- Immutable identity for API callers (same reasoning as company_memberships;
-- the assignments page upsert re-sends user_id/project_id, unchanged).
create or replace function public.project_assignments_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.project_id is distinct from old.project_id
     or new.created_at is distinct from old.created_at then
    raise exception 'project_assignments: id, user_id, project_id and created_at are immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_project_assignments_guard_update on public.project_assignments;
create trigger trg_project_assignments_guard_update
  before update on public.project_assignments
  for each row
  execute function public.project_assignments_guard_update();


-- ----------------------------------------------------------------------------
-- SECTION 8: expenses — WITHDRAWN from the shared package (revision 4)
--
-- public.expenses is owned by the separate Expenses workstream
-- (C:\dev\tkp-expenses), which has its own draft SQL waiting on this shared
-- contract.
-- Revisions 2-3 carried expenses policies plus a review-state guard; they are
-- removed here so the shared package does not define an Expenses-specific
-- authorization model. This file therefore neither enables RLS on expenses
-- nor creates any policy, trigger or index on it.
--
-- SHARED CONTRACT the Expenses policies can build on (all in Section 1,
-- SECURITY DEFINER, search_path = '', EXECUTE for authenticated only):
--   can_access_project(project_id)  global admin | active company admin of the
--                                   project's company | active member with an
--                                   active assignment on the project
--   can_admin_project(project_id)   global admin | active company admin of the
--                                   project's company
--   project_company_id(project_id)  caller-scoped project -> company
--   is_active_user()                (0003) caller has an active profile
-- Findings handed to the Expenses workstream (docs/RLS_Revision4_Rebaseline.md
-- §H): INSERT-time self-approval, approve-then-edit, reviewer spoofing,
-- created_by/project_id reassignment, Q2 (no self-review, NULL creators
-- reviewable), Q8 (derived needs_review), receipt_url SSRF in expense-report.
--
-- Until those policies land, public.expenses stays WITHOUT RLS (cross-tenant
-- readable/writable by any signed-in user). Production must not ship this
-- package without the Expenses package, or an explicit decision otherwise.
-- Receipts in storage (job-card-photos expenses/{projectId}/...) stay
-- supported by 0002 with a project-scope rule only.


-- ----------------------------------------------------------------------------
-- SECTION 9: job_card_submissions
--
-- Writers at Phase 2H final (3359107):
--   * web: persistSubmittedJobCard in components/NewSubmissionForm.tsx — direct
--     anon-key select -> insert | update(payload, customer, unit_number) by
--     submission_id. Subject to everything in this section.
--   * native: POST /api/job-card-submissions/finalize — ALWAYS the service
--     role (requirePrivilegedServiceClient fails closed; there is no user-
--     scoped fallback any more), after authorizeProjectAccess has proven
--     project.company_id = companyId. INSERT ... ON CONFLICT (submission_id)
--     DO NOTHING + read-back; never an UPDATE.
--   * lib/email-submission-history.ts — service role, email-history columns
--     only.
-- Readers: web /submitted, /photos, project lists (RLS); native history
-- GET /api/job-card-submissions (service role, after authorizeProjectAccess).
-- ----------------------------------------------------------------------------

alter table public.job_card_submissions enable row level security;

-- SELECT is authorized by the project alone (rule 1). The row's own
-- company_id is not trusted for authorization.
drop policy if exists job_card_submissions_select on public.job_card_submissions;
create policy job_card_submissions_select
  on public.job_card_submissions
  for select
  to authenticated
  using (
    (select public.is_global_admin())
    or public.can_access_project(project_id)
  );

-- INSERT/UPDATE: project access AND company_id must equal the project's real
-- company. Without the second clause, an admin of company A could write
-- (company_id = A, project_id = <company B project>) and the row would be
-- authorized through A.
drop policy if exists job_card_submissions_insert on public.job_card_submissions;
create policy job_card_submissions_insert
  on public.job_card_submissions
  for insert
  to authenticated
  with check (
    public.can_access_project(project_id)
    and company_id = public.project_company_id(project_id)
  );

drop policy if exists job_card_submissions_update on public.job_card_submissions;
create policy job_card_submissions_update
  on public.job_card_submissions
  for update
  to authenticated
  using (
    (select public.is_global_admin())
    or public.can_access_project(project_id)
  )
  with check (
    public.can_access_project(project_id)
    and company_id = public.project_company_id(project_id)
  );

-- DELETE: none (no client path deletes submissions).

-- Canonical-identity and snapshot integrity (Phase 2H contract).
--
-- INSERT: API callers cannot set technician_submitted_at or
-- submission_snapshot_hash. Only the privileged finalize route stamps them.
-- Without this, anyone with project access could forge a row that looks like
-- a server-confirmed native submission.
--
-- UPDATE, for EVERY role except the maintenance roles (postgres,
-- supabase_admin), including service_role, because this is a data-integrity
-- invariant rather than an authorization rule:
--   submission_id, company_id, project_id, created_at,
--   technician_submitted_at and submission_snapshot_hash are immutable.
-- Nothing legitimate changes them: the web revision path updates only
-- payload/customer/unit_number, email history updates only last_email_*/
-- *_emailed_at, and finalize never UPDATEs (ON CONFLICT DO NOTHING). So a
-- retry, a code bug or a direct REST call can never rewrite the canonical
-- identity/hash that the native "same hash -> idempotent, different hash ->
-- terminal 409" reconciliation relies on.
--
-- Revision 4 (Q9 decided): once submission_snapshot_hash is set, the hashed
-- content is immutable too. payload, customer and unit_number cannot change
-- for any non-maintenance role, service_role included. Corrections to a
-- native (hash-bearing) submission need an explicit amendment/revision path,
-- which does not exist yet. Until it does, the web edit-submitted flow
-- (persistSubmittedJobCard's UPDATE) is rejected with 42501 for native
-- submissions. Web-created submissions (hash NULL) stay revisable as today.
-- Email-history columns stay writable (email history, service role).
create or replace function public.job_card_submissions_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if current_user <> 'service_role'
       and (new.technician_submitted_at is not null or new.submission_snapshot_hash is not null) then
      raise exception 'job_card_submissions: technician_submitted_at and submission_snapshot_hash are set only by the server finalize route'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.submission_id is distinct from old.submission_id
     or new.company_id is distinct from old.company_id
     or new.project_id is distinct from old.project_id
     or new.created_at is distinct from old.created_at
     or new.technician_submitted_at is distinct from old.technician_submitted_at
     or new.submission_snapshot_hash is distinct from old.submission_snapshot_hash then
    raise exception 'job_card_submissions: submission identity and snapshot fields are immutable'
      using errcode = '42501';
  end if;

  if old.submission_snapshot_hash is not null
     and (new.payload is distinct from old.payload
          or new.customer is distinct from old.customer
          or new.unit_number is distinct from old.unit_number) then
    raise exception 'job_card_submissions: the content of a snapshot-hashed submission is immutable; use an amendment/revision path'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_job_card_submissions_guard_write on public.job_card_submissions;
create trigger trg_job_card_submissions_guard_write
  before insert or update on public.job_card_submissions
  for each row
  execute function public.job_card_submissions_guard_write();


-- ----------------------------------------------------------------------------
-- SECTION 10: job_card_drafts
--
-- Drafts have no owner column: they are shared by everyone with access to the
-- project, which is today's behavior. Draft upserts re-send company_id/
-- project_id from the currently selected context, so moving a draft between
-- two projects the caller can access stays allowed.
-- ----------------------------------------------------------------------------

alter table public.job_card_drafts enable row level security;

drop policy if exists job_card_drafts_select on public.job_card_drafts;
create policy job_card_drafts_select
  on public.job_card_drafts
  for select
  to authenticated
  using (
    (select public.is_global_admin())
    or public.can_access_project(project_id)
  );

drop policy if exists job_card_drafts_insert on public.job_card_drafts;
create policy job_card_drafts_insert
  on public.job_card_drafts
  for insert
  to authenticated
  with check (
    public.can_access_project(project_id)
    and company_id = public.project_company_id(project_id)
  );

drop policy if exists job_card_drafts_update on public.job_card_drafts;
create policy job_card_drafts_update
  on public.job_card_drafts
  for update
  to authenticated
  using (
    (select public.is_global_admin())
    or public.can_access_project(project_id)
  )
  with check (
    public.can_access_project(project_id)
    and company_id = public.project_company_id(project_id)
  );

-- DELETE: the web submit path (persistSubmittedJobCard, app/page.tsx on
-- main; components/NewSubmissionForm.tsx on mobile) deletes the draft by
-- submission_id after a successful submit.
drop policy if exists job_card_drafts_delete on public.job_card_drafts;
create policy job_card_drafts_delete
  on public.job_card_drafts
  for delete
  to authenticated
  using (
    (select public.is_global_admin())
    or public.can_access_project(project_id)
  );

-- Revision 4: identity guard for API callers. The draft upsert re-sends
-- submission_id unchanged (ON CONFLICT (submission_id)), and company_id/
-- project_id may legitimately move between two accessible projects (both
-- USING and WITH CHECK apply). But a draft must never be renamed onto
-- another submission_id, e.g. a pending native id (see audit Q11).
create or replace function public.job_card_drafts_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.submission_id is distinct from old.submission_id
     or new.created_at is distinct from old.created_at then
    raise exception 'job_card_drafts: id, submission_id and created_at are immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_job_card_drafts_guard_update on public.job_card_drafts;
create trigger trg_job_card_drafts_guard_update
  before update on public.job_card_drafts
  for each row
  execute function public.job_card_drafts_guard_update();


-- ----------------------------------------------------------------------------
-- SECTION 10A (revision 4): customers — sites, including wifi_password
--
-- Access at 36938d1 (same client code on main):
--   read   customers pages, projects page picker, project detail embed
--          (projects -> customers), NewSubmissionForm autofill, the expense
--          report embed. Technicians are limited client-side to customers
--          linked to their assigned projects.
--   insert customers/new (company admin), projects page inline "new site"
--          (canManageCompanyData).
--   update customers/[id]/edit. Admins send the full form
--          (toCustomerUpdatePayload); technicians send ONLY wifi_ssid +
--          wifi_password.
--   delete none.
--   service role: Zoho FSM sync creates/updates sites (bypasses RLS/guard).
-- ----------------------------------------------------------------------------

alter table public.customers enable row level security;

drop policy if exists customers_select on public.customers;
create policy customers_select
  on public.customers
  for select
  to authenticated
  using (
    (select public.is_global_admin())
    or public.can_access_customer(id)
  );

drop policy if exists customers_insert on public.customers;
create policy customers_insert
  on public.customers
  for insert
  to authenticated
  with check (
    (select public.is_global_admin())
    or public.is_active_company_admin(company_id)
  );

-- UPDATE: anyone who can read the customer may attempt an update; the guard
-- limits a non-admin (technician) to the two Wi-Fi columns.
drop policy if exists customers_update on public.customers;
create policy customers_update
  on public.customers
  for update
  to authenticated
  using (
    (select public.is_global_admin())
    or public.can_access_customer(id)
  )
  with check (
    (select public.is_global_admin())
    or public.can_access_customer(id)
  );

-- DELETE: none.

-- Guard (API roles):
--   INSERT: the Zoho linkage columns (customer_account_id,
--           zoho_service_address_id, end_customer_name) are set only by the
--           Zoho sync (service role).
--   UPDATE: id, company_id, created_at and the Zoho linkage columns are
--           immutable. A caller who is not a global admin or active admin of
--           the customer's company may change ONLY wifi_ssid, wifi_password
--           and updated_at. The comparison is on the whole row image (jsonb),
--           so a column added later (e.g. by the dashboard) is protected by
--           default.
create or replace function public.customers_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.customer_account_id is not null
       or new.zoho_service_address_id is not null
       or new.end_customer_name is not null then
      raise exception 'customers: Zoho linkage columns are set only by the Zoho FSM sync'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.company_id is distinct from old.company_id
     or new.created_at is distinct from old.created_at
     or new.customer_account_id is distinct from old.customer_account_id
     or new.zoho_service_address_id is distinct from old.zoho_service_address_id
     or new.end_customer_name is distinct from old.end_customer_name then
    raise exception 'customers: id, company_id, created_at and Zoho linkage columns are immutable'
      using errcode = '42501';
  end if;

  if not (public.is_global_admin() or public.is_active_company_admin(old.company_id))
     and (to_jsonb(new) - 'wifi_ssid' - 'wifi_password' - 'updated_at')
         is distinct from (to_jsonb(old) - 'wifi_ssid' - 'wifi_password' - 'updated_at') then
    raise exception 'customers: technicians may change only wifi_ssid and wifi_password'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_customers_guard_write on public.customers;
create trigger trg_customers_guard_write
  before insert or update on public.customers
  for each row
  execute function public.customers_guard_write();


-- ----------------------------------------------------------------------------
-- SECTION 10B (revision 4): customer_accounts — dealer / customer account
--
-- Access: read-only for clients (name on ActiveProjectsScreen and
-- ProjectDetailScreen). Written only by the Zoho FSM sync (service role).
-- Visibility mirrors projects: global admin or any active company member.
-- ----------------------------------------------------------------------------

alter table public.customer_accounts enable row level security;

drop policy if exists customer_accounts_select on public.customer_accounts;
create policy customer_accounts_select
  on public.customer_accounts
  for select
  to authenticated
  using (
    (select public.is_global_admin())
    or public.has_active_company_membership(company_id)
  );

-- INSERT / UPDATE / DELETE: none for API roles.


-- ----------------------------------------------------------------------------
-- SECTION 10C (revision 4): customer_site_files — PPD JSON / product-file metadata
--
-- Access at 36938d1: technicians and admins insert a row after uploading a
-- file to the customer-site-files bucket (lib/ppd-json-storage.ts,
-- lib/product-files/storage.ts, NewSubmissionForm), and read rows by
-- project_id / customer_id / submission_id. No client updates or deletes.
-- Rows point at storage paths. Reading the file itself goes through the
-- storage policy (0002), which re-checks project access on the path, so a
-- forged storage_path in a row cannot expose another tenant's file.
-- ----------------------------------------------------------------------------

alter table public.customer_site_files enable row level security;

drop policy if exists customer_site_files_select on public.customer_site_files;
create policy customer_site_files_select
  on public.customer_site_files
  for select
  to authenticated
  using (
    (select public.is_global_admin())
    or public.can_access_project(project_id)
  );

drop policy if exists customer_site_files_insert on public.customer_site_files;
create policy customer_site_files_insert
  on public.customer_site_files
  for insert
  to authenticated
  with check (
    public.can_access_project(project_id)
    and company_id = public.project_company_id(project_id)
    and (customer_id is null or customer_id = public.project_customer_id(project_id))
  );

-- UPDATE / DELETE: none.

-- Guard (API roles): uploaded_by and uploaded_at are stamped server-side.
-- Clients send uploaded_by from getUser() or pass it through (it can be
-- null), so it is overwritten rather than checked, which prevents spoofing
-- the uploader without breaking any caller.
create or replace function public.customer_site_files_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();
  return new;
end;
$$;

drop trigger if exists trg_customer_site_files_guard_insert on public.customer_site_files;
create trigger trg_customer_site_files_guard_insert
  before insert on public.customer_site_files
  for each row
  execute function public.customer_site_files_guard_insert();


-- ----------------------------------------------------------------------------
-- SECTION 11: company/project consistency as a hard invariant (ALL roles)
--
-- RLS only binds API roles. The Phase 2H finalize route writes
-- job_card_submissions with the SERVICE ROLE. At Phase 2H final (3359107),
-- authorizeProjectAccess proves project.company_id = companyId before any
-- write (mismatch -> 409, terminal in the outbox), which closes audit
-- finding A2 in code. This composite FK is the DB-level defense in depth
-- for that invariant, for every role including service_role, so a future
-- code path that skips the check still cannot write a cross-tenant row.
--
-- NOT VALID: enforced immediately for new rows and for any change to
-- (project_id, company_id); existing rows are not checked. After the Section
-- 0 counts are zero, run the VALIDATE statements separately (they take only a
-- SHARE UPDATE EXCLUSIVE lock):
--   alter table public.job_card_submissions validate constraint job_card_submissions_project_company_fkey;
--   alter table public.job_card_drafts      validate constraint job_card_drafts_project_company_fkey;
--   alter table public.customer_site_files  validate constraint customer_site_files_project_company_fkey;
-- Nothing updates projects.company_id today (the Zoho sync writes only
-- project_name/customer_name/location), so the default NO ACTION is correct:
-- a project that has submissions or drafts can no longer silently change
-- company.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_id_company_id_key') then
    alter table public.projects
      add constraint projects_id_company_id_key unique (id, company_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'job_card_submissions_project_company_fkey') then
    alter table public.job_card_submissions
      add constraint job_card_submissions_project_company_fkey
      foreign key (project_id, company_id) references public.projects (id, company_id)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'job_card_drafts_project_company_fkey') then
    alter table public.job_card_drafts
      add constraint job_card_drafts_project_company_fkey
      foreign key (project_id, company_id) references public.projects (id, company_id)
      not valid;
  end if;

  -- Revision 4: same invariant for the site-file metadata.
  if not exists (select 1 from pg_constraint where conname = 'customer_site_files_project_company_fkey') then
    alter table public.customer_site_files
      add constraint customer_site_files_project_company_fkey
      foreign key (project_id, company_id) references public.projects (id, company_id)
      not valid;
  end if;
end
$$;

-- Revision 4 index: can_access_customer() looks up projects by customer_id.
-- The existing (company_id, customer_id) index cannot serve a customer_id-only
-- probe.
create index if not exists idx_projects_customer_id
  on public.projects (customer_id)
  where customer_id is not null;


-- ----------------------------------------------------------------------------
-- SECTION 12: Privilege hygiene
--
-- TRUNCATE is not subject to RLS. PostgREST cannot issue it, but Supabase's
-- default grants give it to anon/authenticated. Revoking it costs nothing.
-- ----------------------------------------------------------------------------

revoke truncate on
  public.user_profiles,
  public.company_memberships,
  public.companies,
  public.projects,
  public.project_assignments,
  public.job_card_submissions,
  public.job_card_drafts,
  public.customers,
  public.customer_accounts,
  public.customer_site_files
from anon, authenticated;


-- ----------------------------------------------------------------------------
-- SECTION 13: Revision 1 helper cleanup
--
-- Revision 1 defined can_access_project(uuid, uuid), shares_active_company_with
-- (uuid) and has_active_project_assignment(uuid). None was ever applied. The
-- drops sit last so that, on a database where revision 1 had been applied,
-- every dependent policy has already been replaced above. If anything else
-- still depends on them, the DROP fails and the whole migration rolls back.
-- ----------------------------------------------------------------------------

drop function if exists public.can_access_project(uuid, uuid);
drop function if exists public.shares_active_company_with(uuid);
drop function if exists public.has_active_project_assignment(uuid);


-- ----------------------------------------------------------------------------
-- SECTION 14: service_role — no SQL needed
--
-- service_role has BYPASSRLS and skips every guard trigger. Routes using it
-- depend entirely on their own server-side authorization (see audit §5 for
-- the routes where that authorization is missing or wrong — RLS cannot fix
-- them). Routes that fall back to createUserScopedClient() when the service
-- key is absent run as `authenticated` and are fully subject to everything
-- above.
-- ----------------------------------------------------------------------------
