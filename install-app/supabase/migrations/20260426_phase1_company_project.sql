-- Phase 1: company/project data model + backfill.
-- Scope intentionally limited to schema/data only (no route/UI/email/photo logic changes).

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_name text not null,
  customer_name text not null default '',
  location text not null default '',
  external_recipient_emails text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_company_project_name_key unique (company_id, project_name)
);

alter table if exists public.job_card_drafts
  add column if not exists company_id uuid,
  add column if not exists project_id uuid;

alter table if exists public.job_card_submissions
  add column if not exists company_id uuid,
  add column if not exists project_id uuid;

do $$
declare
  v_company_id uuid;
  v_project_id uuid;
begin
  select id into v_company_id
  from public.companies
  where name = 'Powerfleet'
  limit 1;

  if v_company_id is null then
    insert into public.companies (name)
    values ('Powerfleet')
    returning id into v_company_id;
  end if;

  select id into v_project_id
  from public.projects
  where company_id = v_company_id
    and project_name = 'Default Project'
  limit 1;

  if v_project_id is null then
    insert into public.projects (
      company_id,
      project_name,
      customer_name,
      location,
      external_recipient_emails,
      active
    )
    values (
      v_company_id,
      'Default Project',
      '',
      '',
      '{}',
      true
    )
    returning id into v_project_id;
  end if;

  update public.job_card_drafts
  set
    company_id = coalesce(company_id, v_company_id),
    project_id = coalesce(project_id, v_project_id)
  where company_id is null or project_id is null;

  update public.job_card_submissions
  set
    company_id = coalesce(company_id, v_company_id),
    project_id = coalesce(project_id, v_project_id)
  where company_id is null or project_id is null;
end
$$;

alter table if exists public.job_card_drafts
  alter column company_id set not null,
  alter column project_id set not null;

alter table if exists public.job_card_submissions
  alter column company_id set not null,
  alter column project_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'job_card_drafts_company_id_fkey'
  ) then
    alter table public.job_card_drafts
      add constraint job_card_drafts_company_id_fkey
      foreign key (company_id) references public.companies(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'job_card_drafts_project_id_fkey'
  ) then
    alter table public.job_card_drafts
      add constraint job_card_drafts_project_id_fkey
      foreign key (project_id) references public.projects(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'job_card_submissions_company_id_fkey'
  ) then
    alter table public.job_card_submissions
      add constraint job_card_submissions_company_id_fkey
      foreign key (company_id) references public.companies(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'job_card_submissions_project_id_fkey'
  ) then
    alter table public.job_card_submissions
      add constraint job_card_submissions_project_id_fkey
      foreign key (project_id) references public.projects(id);
  end if;
end
$$;

create index if not exists idx_job_card_drafts_company_project_updated_at
  on public.job_card_drafts (company_id, project_id, updated_at desc);

create index if not exists idx_job_card_submissions_company_project_created_at
  on public.job_card_submissions (company_id, project_id, created_at desc);

