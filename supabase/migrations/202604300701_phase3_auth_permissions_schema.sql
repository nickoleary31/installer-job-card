-- Phase 3B: additive auth/permissions schema foundation.
-- Scope intentionally limited to new tables/indexes only.
-- No RLS/policies, no seed data, no app behavior changes.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  global_role text not null check (global_role in ('admin', 'technician')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null check (role in ('admin', 'technician')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_memberships_user_company_key unique (user_id, company_id)
);

create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_assignments_user_project_key unique (user_id, project_id)
);

create index if not exists idx_user_profiles_global_role_active
  on public.user_profiles (global_role, is_active);

create index if not exists idx_company_memberships_user_active
  on public.company_memberships (user_id, is_active);

create index if not exists idx_company_memberships_company_active
  on public.company_memberships (company_id, is_active);

create index if not exists idx_project_assignments_user_active
  on public.project_assignments (user_id, is_active);

create index if not exists idx_project_assignments_project_active
  on public.project_assignments (project_id, is_active);
