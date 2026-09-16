-- Developer Sheets Phase 1: dedicated domain tables.
-- DO NOT apply until reviewed. Written for review only — not run against any database yet.
--
-- WHY A DEDICATED DOMAIN: Developer Sheets are collaborative product-documentation records, not
-- installation job cards. They must never be counted as completed submissions, published as Zoho
-- evidence, listed as submitted job cards, touched by job-card email history, or included in
-- installation completion/progress math. Three brand-new tables (never referenced by any of that
-- existing code) make that exclusion structural rather than something enforced by a filter that
-- could later be forgotten. See docs/Architecture.md for the app's existing RLS/app-enforcement
-- conventions this migration follows.
--
-- COLLABORATION MODEL: any user with project access (global admin, active company admin, or an
-- active project_assignments row) may read and edit a card/entry. Attribution (created_by/
-- updated_by/uploaded_by) is stamped SERVER-SIDE by trigger from auth.uid() — client-supplied
-- values for these columns, and for company_id/project_id on child tables, are always overwritten
-- and never trusted. This deliberately does NOT reuse the older client-trusted attribution pattern
-- seen on customer_site_files.uploaded_by / expenses.created_by.
--
-- ARCHIVE MODEL: soft-delete only. Flipping is_active is gated by an UPDATE trigger requiring
-- company-admin or global-admin privilege, regardless of what the RLS UPDATE policy would
-- otherwise allow an ordinary assigned user to do to other columns. No DELETE policy is defined on
-- any of these three tables, so hard deletion is unsupported through the app entirely in Phase 1
-- (only possible out-of-band via the Supabase dashboard/service role, intentionally not exposed).
--
-- DEPENDS ON: public.is_global_admin() (20260730120000_company_form_products.sql) and
-- public.company_memberships / public.project_assignments / public.user_profiles
-- (202604300701_phase3_auth_permissions_schema.sql). This migration's timestamp sorts after both.

-- ---------------------------------------------------------------------------------------------
-- 0. Company-level capability flag (approved mechanism from the architecture review — avoids any
--    `company.name === "Developer Sheets"` check anywhere in application code).
-- ---------------------------------------------------------------------------------------------

alter table public.companies
  add column if not exists workflow_type text not null default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_workflow_type_check'
  ) then
    alter table public.companies
      add constraint companies_workflow_type_check
      check (workflow_type in ('standard', 'developer_sheet'));
  end if;
end $$;

comment on column public.companies.workflow_type is
  'standard = normal installation job-card workflow. developer_sheet = the collaborative product-documentation workflow; every project/card under such a company uses developer_sheet_cards, never job_card_drafts/job_card_submissions.';

-- MANUAL STEP — do not run as part of this migration. After confirming the exact production
-- company_id for the existing "Developer Sheets" company row (do not guess/hardcode it here),
-- run separately:
--   update public.companies set workflow_type = 'developer_sheet' where id = '<confirmed-uuid>';

-- ---------------------------------------------------------------------------------------------
-- 1. Shared access-check function — mirrors lib/project-access.ts:authorizeProjectAccess()
--    exactly (global admin -> active company admin -> active project assignment).
-- ---------------------------------------------------------------------------------------------

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
      from public.project_assignments pa
      where pa.project_id = p_project_id
        and pa.user_id = auth.uid()
        and pa.is_active = true
    );
$$;

revoke all on function public.has_project_access(uuid) from public;
grant execute on function public.has_project_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. developer_sheet_cards — the persistent Product card. Top of the domain; never lives in, or
--    transitions to/from, job_card_drafts/job_card_submissions.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.developer_sheet_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  product_name text not null,
  product_scope text,
  product_part_numbers text[] not null default '{}',
  additional_notes text,
  developer_summary text,
  is_active boolean not null default true,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint developer_sheet_cards_product_name_nonempty check (length(trim(product_name)) > 0)
);

comment on table public.developer_sheet_cards is
  'Developer Sheets persistent Product card. company_id/project_id are server-derived by trigger from project_id, not trusted from the client. Deliberately independent of job_card_drafts/job_card_submissions — see migration header.';

create index if not exists idx_developer_sheet_cards_company_project_active
  on public.developer_sheet_cards (company_id, project_id, is_active, updated_at desc);

create or replace function public.developer_sheet_cards_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_is_admin boolean;
begin
  if tg_op = 'INSERT' then
    select company_id into v_company_id from public.projects where id = new.project_id;
    if v_company_id is null then
      raise exception 'developer_sheet_cards.project_id % does not reference an existing project', new.project_id;
    end if;
    if not exists (
      select 1 from public.companies c
      where c.id = v_company_id and c.workflow_type = 'developer_sheet'
    ) then
      raise exception 'developer_sheet_cards.project_id % belongs to a company that is not flagged workflow_type = ''developer_sheet''', new.project_id;
    end if;
    new.company_id := v_company_id;
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
    new.is_active := true;
    new.archived_at := null;
    new.archived_by := null;
    return new;
  end if;

  -- UPDATE: project/company assignment and original authorship are immutable.
  new.project_id := old.project_id;
  new.company_id := old.company_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := auth.uid();
  new.updated_at := now();

  if new.is_active is distinct from old.is_active then
    select
      public.is_global_admin()
      or exists (
        select 1 from public.company_memberships cm
        where cm.company_id = old.company_id
          and cm.user_id = auth.uid()
          and cm.role = 'admin'
          and cm.is_active = true
      )
    into v_is_admin;

    if not v_is_admin then
      raise exception 'Only a company admin or global admin may archive or restore a Developer Sheet card.';
    end if;

    if new.is_active = false then
      new.archived_at := now();
      new.archived_by := auth.uid();
    else
      new.archived_at := null;
      new.archived_by := null;
    end if;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  return new;
end;
$$;

-- Trigger-only function: never called directly by client SQL, so it needs no EXECUTE grant to
-- authenticated (or any other role) — only the trigger mechanism itself invokes it.
revoke all on function public.developer_sheet_cards_before_write() from public;

drop trigger if exists trg_developer_sheet_cards_before_write on public.developer_sheet_cards;
create trigger trg_developer_sheet_cards_before_write
  before insert or update on public.developer_sheet_cards
  for each row
  execute function public.developer_sheet_cards_before_write();

alter table public.developer_sheet_cards enable row level security;

drop policy if exists developer_sheet_cards_select on public.developer_sheet_cards;
create policy developer_sheet_cards_select
  on public.developer_sheet_cards
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists developer_sheet_cards_insert on public.developer_sheet_cards;
create policy developer_sheet_cards_insert
  on public.developer_sheet_cards
  for insert to authenticated
  with check (public.has_project_access(project_id));

drop policy if exists developer_sheet_cards_update on public.developer_sheet_cards;
create policy developer_sheet_cards_update
  on public.developer_sheet_cards
  for update to authenticated
  using (public.has_project_access(project_id))
  with check (public.has_project_access(project_id));

-- Intentionally no delete policy — hard deletion is unsupported via the app in Phase 1.

-- ---------------------------------------------------------------------------------------------
-- 3. developer_sheet_documentation_entries — one row per "Add Documentation" entry.
--    company_id/project_id are denormalized from the parent card (trigger-derived, immutable)
--    purely so RLS/list queries here don't need a join, matching this app's existing convention
--    of denormalizing company_id+project_id onto job_card_drafts/job_card_submissions.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.developer_sheet_documentation_entries (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.developer_sheet_cards(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text,
  notes text,
  part_number text,
  tag text,
  is_active boolean not null default true,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.developer_sheet_documentation_entries is
  'Developer Sheets collaborative documentation entries. company_id/project_id are copied from the parent card by trigger at insert time and pinned immutable thereafter — never trusted from the client.';

create index if not exists idx_developer_sheet_entries_card_active
  on public.developer_sheet_documentation_entries (card_id, is_active, created_at desc);

create index if not exists idx_developer_sheet_entries_project_active
  on public.developer_sheet_documentation_entries (project_id, is_active);

create or replace function public.developer_sheet_entries_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_project_id uuid;
  v_is_admin boolean;
begin
  if tg_op = 'INSERT' then
    select company_id, project_id into v_company_id, v_project_id
    from public.developer_sheet_cards where id = new.card_id;
    if v_company_id is null then
      raise exception 'developer_sheet_documentation_entries.card_id % does not reference an existing card', new.card_id;
    end if;
    new.company_id := v_company_id;
    new.project_id := v_project_id;
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
    new.is_active := true;
    new.archived_at := null;
    new.archived_by := null;
    return new;
  end if;

  new.card_id := old.card_id;
  new.company_id := old.company_id;
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := auth.uid();
  new.updated_at := now();

  if new.is_active is distinct from old.is_active then
    select
      public.is_global_admin()
      or exists (
        select 1 from public.company_memberships cm
        where cm.company_id = old.company_id
          and cm.user_id = auth.uid()
          and cm.role = 'admin'
          and cm.is_active = true
      )
    into v_is_admin;

    if not v_is_admin then
      raise exception 'Only a company admin or global admin may archive or restore a documentation entry.';
    end if;

    if new.is_active = false then
      new.archived_at := now();
      new.archived_by := auth.uid();
    else
      new.archived_at := null;
      new.archived_by := null;
    end if;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  return new;
end;
$$;

-- Trigger-only function: never called directly by client SQL, so it needs no EXECUTE grant to
-- authenticated (or any other role) — only the trigger mechanism itself invokes it.
revoke all on function public.developer_sheet_entries_before_write() from public;

drop trigger if exists trg_developer_sheet_entries_before_write on public.developer_sheet_documentation_entries;
create trigger trg_developer_sheet_entries_before_write
  before insert or update on public.developer_sheet_documentation_entries
  for each row
  execute function public.developer_sheet_entries_before_write();

alter table public.developer_sheet_documentation_entries enable row level security;

drop policy if exists developer_sheet_entries_select on public.developer_sheet_documentation_entries;
create policy developer_sheet_entries_select
  on public.developer_sheet_documentation_entries
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists developer_sheet_entries_insert on public.developer_sheet_documentation_entries;
create policy developer_sheet_entries_insert
  on public.developer_sheet_documentation_entries
  for insert to authenticated
  with check (public.has_project_access(project_id));

drop policy if exists developer_sheet_entries_update on public.developer_sheet_documentation_entries;
create policy developer_sheet_entries_update
  on public.developer_sheet_documentation_entries
  for update to authenticated
  using (public.has_project_access(project_id))
  with check (public.has_project_access(project_id));

-- Intentionally no delete policy — hard deletion is unsupported via the app in Phase 1.

-- ---------------------------------------------------------------------------------------------
-- 4. developer_sheet_documentation_photos — one row per uploaded photo. No update-editing
--    concept beyond archive/restore: storage_path, entry_id, and uploaded_by/uploaded_at are
--    pinned immutable for the row's entire life, so evidence can never be silently altered.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.developer_sheet_documentation_photos (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.developer_sheet_documentation_entries(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null,
  file_name text,
  is_active boolean not null default true,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  constraint developer_sheet_documentation_photos_storage_path_key unique (storage_path),
  -- Row-local sanity guard only — checks the persisted storage_path's leading segment against
  -- this row's own project_id, and confirms entry_id appears in the path as a full segment.
  -- card_id is NOT checked here: it isn't a column on this table (only entry_id is denormalized),
  -- and Postgres CHECK constraints cannot run subqueries/joins, so a real relational check (entry
  -- exists, belongs to card, card belongs to project, company is workflow_type = 'developer_sheet')
  -- is only possible in the Storage policy itself (see the storage policies migration) — this
  -- constraint exists purely to catch an application bug writing a mismatched project_id/entry_id
  -- into the row relative to what was actually uploaded, not to be the source of truth.
  constraint developer_sheet_documentation_photos_storage_path_scoped check (
    storage_path like (project_id::text || '/%')
    and storage_path like ('%/' || entry_id::text || '/%')
  )
);

comment on table public.developer_sheet_documentation_photos is
  'Developer Sheets documentation photos. storage_path points into the private developer-sheet-photos Storage bucket (see 20260915000001_developer_sheets_photos_storage_policies.sql) — never a public_url. Rows are archived, never hard-deleted, and archiving never removes the underlying Storage object.';

create index if not exists idx_developer_sheet_photos_entry_active
  on public.developer_sheet_documentation_photos (entry_id, is_active, uploaded_at desc);

create index if not exists idx_developer_sheet_photos_project_active
  on public.developer_sheet_documentation_photos (project_id, is_active);

create or replace function public.developer_sheet_photos_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_project_id uuid;
  v_is_admin boolean;
begin
  if tg_op = 'INSERT' then
    select company_id, project_id into v_company_id, v_project_id
    from public.developer_sheet_documentation_entries where id = new.entry_id;
    if v_company_id is null then
      raise exception 'developer_sheet_documentation_photos.entry_id % does not reference an existing entry', new.entry_id;
    end if;
    new.company_id := v_company_id;
    new.project_id := v_project_id;
    new.uploaded_by := auth.uid();
    new.uploaded_at := coalesce(new.uploaded_at, now());
    new.is_active := true;
    new.archived_at := null;
    new.archived_by := null;
    return new;
  end if;

  -- UPDATE: only the archive toggle may change — every other column, including storage_path and
  -- uploaded_by/uploaded_at, is pinned so a photo's evidence is immutable for its entire life.
  new.entry_id := old.entry_id;
  new.company_id := old.company_id;
  new.project_id := old.project_id;
  new.storage_path := old.storage_path;
  new.file_name := old.file_name;
  new.uploaded_by := old.uploaded_by;
  new.uploaded_at := old.uploaded_at;

  if new.is_active is distinct from old.is_active then
    select
      public.is_global_admin()
      or exists (
        select 1 from public.company_memberships cm
        where cm.company_id = old.company_id
          and cm.user_id = auth.uid()
          and cm.role = 'admin'
          and cm.is_active = true
      )
    into v_is_admin;

    if not v_is_admin then
      raise exception 'Only a company admin or global admin may archive or restore a documentation photo.';
    end if;

    if new.is_active = false then
      new.archived_at := now();
      new.archived_by := auth.uid();
    else
      new.archived_at := null;
      new.archived_by := null;
    end if;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  return new;
end;
$$;

-- Trigger-only function: never called directly by client SQL, so it needs no EXECUTE grant to
-- authenticated (or any other role) — only the trigger mechanism itself invokes it.
revoke all on function public.developer_sheet_photos_before_write() from public;

drop trigger if exists trg_developer_sheet_photos_before_write on public.developer_sheet_documentation_photos;
create trigger trg_developer_sheet_photos_before_write
  before insert or update on public.developer_sheet_documentation_photos
  for each row
  execute function public.developer_sheet_photos_before_write();

alter table public.developer_sheet_documentation_photos enable row level security;

drop policy if exists developer_sheet_photos_select on public.developer_sheet_documentation_photos;
create policy developer_sheet_photos_select
  on public.developer_sheet_documentation_photos
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists developer_sheet_photos_insert on public.developer_sheet_documentation_photos;
create policy developer_sheet_photos_insert
  on public.developer_sheet_documentation_photos
  for insert to authenticated
  with check (public.has_project_access(project_id));

drop policy if exists developer_sheet_photos_update on public.developer_sheet_documentation_photos;
create policy developer_sheet_photos_update
  on public.developer_sheet_documentation_photos
  for update to authenticated
  using (public.has_project_access(project_id))
  with check (public.has_project_access(project_id));

-- Intentionally no delete policy — hard deletion is unsupported via the app in Phase 1. Removing a
-- photo from view is always an archive (is_active = false, admin-only per the trigger above), and
-- archiving a row never deletes the underlying Storage object — see the storage policies migration.
