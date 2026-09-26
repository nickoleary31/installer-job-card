-- ============================================================================
-- 00 — V1 Dev PREFLIGHT, READ-ONLY (RLS revision 4)
-- Every statement in this file is a SELECT against catalogs or data, or a
-- read-only DO block that only RAISEs NOTICEs. Nothing here writes. Run it
-- in ONE session, with the output saved, BEFORE any of 0001/0002/0003 is
-- approved for V1 Dev.
--
-- HOW TO CONNECT (never through the Supabase CLI link state in this repo):
--   supabase/.temp/project-ref in this repository = uboutcndhvygmwfjztla =
--   PRODUCTION. Do not run `supabase db ...` / `supabase migration ...` from
--   this worktree. Connect with an explicit V1 Dev connection string whose
--   host or user contains  gewtjutfjrmhwmjlovly , e.g.
--     psql "postgresql://postgres.gewtjutfjrmhwmjlovly@<pooler-host>:5432/postgres" \
--          -v ON_ERROR_STOP=1 -f 00_v1dev_preflight_readonly.sql
--   and open the session read-only first:  set default_transaction_read_only = on;
-- ============================================================================

set default_transaction_read_only = on;


-- ----------------------------------------------------------------------------
-- A. PROVE THE TARGET IS V1 DEV (stop if any check disagrees)
--   A1 is operator-verified: the connection string contains gewtjutfjrmhwmjlovly.
--   A2 schema discriminator: the Phase 2H migration 20260921120000 exists only
--      on feature/mobile-shell and has been exercised on V1 Dev. Production
--      (main) does not have it. Expect 1 row / 2 columns on V1 Dev.
-- ----------------------------------------------------------------------------
select current_database() as db, current_user as role, version() as pg_version;

select version, name
from supabase_migrations.schema_migrations
where version = '20260921120000';

select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'job_card_submissions'
  and column_name in ('technician_submitted_at', 'submission_snapshot_hash');


-- ----------------------------------------------------------------------------
-- B. CURRENT RLS / POLICY STATE (snapshot = rollback reference)
-- ----------------------------------------------------------------------------
select c.relname, pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by c.relname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;


-- ----------------------------------------------------------------------------
-- C. FUNCTIONS: definitions, owners, SECURITY DEFINER, search_path, grants
--    (expect only is_global_admin before 0001; everything else absent)
-- ----------------------------------------------------------------------------
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
       p.proconfig as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by p.proname;

select pg_get_functiondef('public.is_global_admin()'::regprocedure);


-- ----------------------------------------------------------------------------
-- D. TABLE / COLUMN PRIVILEGES for the API roles (0001 assumes Supabase's
--    default table-level grants; D1 must show UPDATE for authenticated on
--    user_profiles, which is why 0001 revokes it at table level)
-- ----------------------------------------------------------------------------
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
  and table_name in ('user_profiles','companies','projects','company_memberships','project_assignments',
                     'job_card_submissions','job_card_drafts','customers','customer_accounts',
                     'customer_site_files','expenses','company_form_products')
group by table_name, grantee
order by table_name, grantee;

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'user_profiles'
  and grantee in ('anon', 'authenticated')
order by grantee, column_name, privilege_type;


-- ----------------------------------------------------------------------------
-- E. EVERY COLUMN THE DRAFTS REFERENCE MUST EXIST (present = false -> stop)
-- ----------------------------------------------------------------------------
select e.table_schema, e.table_name, e.column_name,
       (c.column_name is not null) as present
from (values
  ('public','user_profiles','id'), ('public','user_profiles','global_role'), ('public','user_profiles','is_active'),
  ('public','user_profiles','email'), ('public','user_profiles','display_name'), ('public','user_profiles','phone'),
  ('public','user_profiles','job_title'), ('public','user_profiles','onboarding_completed_at'),
  ('public','user_profiles','created_at'), ('public','user_profiles','updated_at'),
  ('public','companies','id'),
  ('public','projects','id'), ('public','projects','company_id'), ('public','projects','customer_id'), ('public','projects','active'),
  ('public','company_memberships','id'), ('public','company_memberships','user_id'), ('public','company_memberships','company_id'),
  ('public','company_memberships','role'), ('public','company_memberships','is_active'), ('public','company_memberships','created_at'),
  ('public','project_assignments','id'), ('public','project_assignments','user_id'), ('public','project_assignments','project_id'),
  ('public','project_assignments','is_active'), ('public','project_assignments','created_at'),
  ('public','job_card_submissions','id'), ('public','job_card_submissions','submission_id'), ('public','job_card_submissions','company_id'),
  ('public','job_card_submissions','project_id'), ('public','job_card_submissions','created_at'), ('public','job_card_submissions','payload'),
  ('public','job_card_submissions','customer'), ('public','job_card_submissions','unit_number'),
  ('public','job_card_submissions','technician_submitted_at'), ('public','job_card_submissions','submission_snapshot_hash'),
  ('public','job_card_drafts','id'), ('public','job_card_drafts','submission_id'), ('public','job_card_drafts','company_id'),
  ('public','job_card_drafts','project_id'), ('public','job_card_drafts','created_at'),
  ('public','customers','id'), ('public','customers','company_id'), ('public','customers','created_at'), ('public','customers','updated_at'),
  ('public','customers','customer_account_id'), ('public','customers','zoho_service_address_id'), ('public','customers','end_customer_name'),
  ('public','customers','wifi_ssid'), ('public','customers','wifi_password'),
  ('public','customer_accounts','id'), ('public','customer_accounts','company_id'),
  ('public','customer_site_files','id'), ('public','customer_site_files','company_id'), ('public','customer_site_files','customer_id'),
  ('public','customer_site_files','project_id'), ('public','customer_site_files','uploaded_by'), ('public','customer_site_files','uploaded_at'),
  ('storage','objects','name'), ('storage','objects','bucket_id'), ('storage','objects','owner'), ('storage','objects','owner_id')
) as e(table_schema, table_name, column_name)
left join information_schema.columns c
  on c.table_schema = e.table_schema and c.table_name = e.table_name and c.column_name = e.column_name
order by present, e.table_schema, e.table_name, e.column_name;

-- Columns that exist in the DB but in no repo migration (schema drift, Q6),
-- e.g. companies.active. Review, don't fix here.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('companies','projects','customers','user_profiles','company_memberships','project_assignments',
                     'job_card_submissions','job_card_drafts','customer_accounts','customer_site_files')
order by table_name, ordinal_position;


-- ----------------------------------------------------------------------------
-- F. INDEXES the policy predicates rely on
-- ----------------------------------------------------------------------------
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('user_profiles','companies','projects','company_memberships','project_assignments',
                    'job_card_submissions','job_card_drafts','customers','customer_accounts','customer_site_files')
order by tablename, indexname;


-- ----------------------------------------------------------------------------
-- G. TRIGGERS (Q5): on the in-scope tables and on auth.users. A trigger on
--    auth.users that writes public.user_profiles with INVOKER rights would
--    break under RLS (no INSERT policy).
-- ----------------------------------------------------------------------------
select t.tgrelid::regclass as on_table, t.tgname, p.proname as function,
       pg_get_userbyid(p.proowner) as fn_owner, p.prosecdef as fn_security_definer,
       pg_get_triggerdef(t.oid) as definition
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and (t.tgrelid::regclass::text in ('auth.users','public.user_profiles','public.companies','public.projects',
         'public.company_memberships','public.project_assignments','public.job_card_submissions',
         'public.job_card_drafts','public.customers','public.customer_accounts','public.customer_site_files'))
order by 1, 2;


-- ----------------------------------------------------------------------------
-- H. DASHBOARD-CREATED OBJECTS (Q6): views over the in-scope tables, and the
--    realtime publication (Realtime honours RLS, but know what is published)
-- ----------------------------------------------------------------------------
select distinct view_schema, view_name, table_name
from information_schema.view_table_usage
where table_schema = 'public'
  and table_name in ('user_profiles','companies','projects','company_memberships','project_assignments',
                     'job_card_submissions','job_card_drafts','customers','customer_accounts','customer_site_files')
order by 1, 2;

select pubname, schemaname, tablename from pg_publication_tables order by 1, 2, 3;


-- ----------------------------------------------------------------------------
-- I. STORAGE: buckets, and the object path-family distribution. Objects in
--    "other" lose API access under 0002 (public URLs of job-card-photos keep
--    working). Review every "other" before approving 0002.
-- ----------------------------------------------------------------------------
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

with jc as (
  select name, storage.foldername(name) as f,
         coalesce(array_length(storage.foldername(name), 1), 0) as depth,
         coalesce(owner_id, owner::text) as obj_owner
  from storage.objects where bucket_id = 'job-card-photos'
)
select case
         when depth = 6 and f[1] ~* '^[0-9a-f-]{36}$' and f[2] ~* '^[0-9a-f-]{36}$' and f[3] ~* '^[0-9a-f-]{36}$' then 'N7 native current'
         when depth = 5 and f[1] ~* '^[0-9a-f-]{36}$' and f[2] ~* '^[0-9a-f-]{36}$' then 'N6 native pre-checkpoint-2'
         when depth = 3 and f[1] = 'expenses' then 'R4 receipts'
         when depth = 3 and f[1] ~ '^[A-Za-z0-9_-]+$' then 'W4 web'
         else 'other (no API access after 0002)'
       end as family,
       count(*) as objects,
       count(*) filter (where obj_owner is null) as objects_without_owner
from jc group by 1 order by 1;

-- W4 objects whose submission id has neither a submission nor a draft row
-- (after 0002 these are visible only to their uploader).
select count(*) as w4_objects_without_row
from storage.objects o
where o.bucket_id = 'job-card-photos'
  and coalesce(array_length(storage.foldername(o.name), 1), 0) = 3
  and (storage.foldername(o.name))[1] <> 'expenses'
  and not exists (select 1 from public.job_card_submissions s where s.submission_id = (storage.foldername(o.name))[1])
  and not exists (select 1 from public.job_card_drafts d where d.submission_id = (storage.foldername(o.name))[1]);

with cs as (
  select storage.foldername(name) as f, coalesce(array_length(storage.foldername(name), 1), 0) as depth
  from storage.objects where bucket_id = 'customer-site-files'
)
select case
         when depth = 4 and f[1] = 'customer-sites' and f[3] = 'ppd-json' then 'P5 ppd-json'
         when depth = 6 and f[1] = 'customer-sites' and f[3] = 'product-files' then 'F7 product-files'
         else 'other (no API access after 0002)'
       end as family,
       count(*) as objects
from cs group by 1 order by 1;


-- ----------------------------------------------------------------------------
-- J. DATA INTEGRITY (0001 Section 0 + 0003 preflight, read-only)
-- ----------------------------------------------------------------------------
select 'job_card_submissions company<>project.company' as check, count(*)
from public.job_card_submissions s join public.projects p on p.id = s.project_id where p.company_id <> s.company_id
union all
select 'job_card_drafts company<>project.company', count(*)
from public.job_card_drafts d join public.projects p on p.id = d.project_id where p.company_id <> d.company_id
union all
select 'customer_site_files company<>project.company', count(*)
from public.customer_site_files f join public.projects p on p.id = f.project_id where p.company_id <> f.company_id
union all
select 'customer_site_files customer<>project.customer', count(*)
from public.customer_site_files f join public.projects p on p.id = f.project_id
where f.customer_id is not null and f.customer_id is distinct from p.customer_id
union all
select 'projects linked to another company''s customer', count(*)
from public.projects p join public.customers c on c.id = p.customer_id where c.company_id <> p.company_id
union all
select 'active memberships without a profile (0003 blocks)', count(distinct cm.user_id)
from public.company_memberships cm where cm.is_active
  and not exists (select 1 from public.user_profiles up where up.id = cm.user_id)
union all
select 'active assignments without a profile (0003 blocks)', count(distinct pa.user_id)
from public.project_assignments pa where pa.is_active
  and not exists (select 1 from public.user_profiles up where up.id = pa.user_id)
union all
select 'inactive profiles still holding active memberships (0003 NOTICE)', count(distinct up.id)
from public.user_profiles up where not up.is_active
  and exists (select 1 from public.company_memberships cm where cm.user_id = up.id and cm.is_active)
union all
select 'native (hash-bearing) submissions (Q9 freezes their content)', count(*)
from public.job_card_submissions where submission_snapshot_hash is not null;


-- ----------------------------------------------------------------------------
-- K. TEST IDENTITIES available in V1 Dev (for the §J matrix). Pick one of
--    each: global admin, company admin (co A), assigned technician (co A),
--    unassigned technician (co A), member of co B, inactive user.
-- ----------------------------------------------------------------------------
select up.id, up.email, up.global_role, up.is_active as profile_active,
       cm.company_id, cm.role, cm.is_active as membership_active,
       (select count(*) from public.project_assignments pa where pa.user_id = up.id and pa.is_active) as active_assignments
from public.user_profiles up
left join public.company_memberships cm on cm.user_id = up.id
order by up.global_role, up.email;


-- ----------------------------------------------------------------------------
-- NOT read-only, therefore NOT in this file (each needs its own approval):
--   Q10  Signed-upload vs storage policies. Procedure: in V1 Dev create a
--        throwaway PRIVATE bucket with NO policies; with the service role,
--        createSignedUploadUrl('q10/probe.txt'); upload with the anon key via
--        uploadToSignedUrl. Success = signed uploads bypass policies (0002
--        safe). Then delete the object and bucket.
--   Baseline REST probes: as each test identity, run the §J direct-REST
--        cases BEFORE applying anything, to record today's (unprotected)
--        behavior for comparison.
-- ----------------------------------------------------------------------------
