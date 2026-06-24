-- PPD JSON and future site-scoped files. RLS intentionally not enabled (per product decision).

create table if not exists public.customer_site_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  project_id uuid not null references public.projects (id) on delete cascade,
  submission_id text,
  file_type text not null default 'ppd_json',
  file_name text not null,
  storage_path text not null,
  make text,
  model text,
  unit_number text,
  notes text,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_customer_site_files_project_type
  on public.customer_site_files (project_id, file_type, uploaded_at desc);

create index if not exists idx_customer_site_files_customer_type
  on public.customer_site_files (customer_id, file_type, uploaded_at desc)
  where customer_id is not null;

comment on table public.customer_site_files is
  'Site-scoped uploaded files (PPD JSON, etc.). Listing by project_id / customer_id for repository UI.';

-- Public bucket for direct links in email (same pattern as job-card-photos).
insert into storage.buckets (id, name, public)
values ('customer-site-files', 'customer-site-files', true)
on conflict (id) do update set public = excluded.public;
