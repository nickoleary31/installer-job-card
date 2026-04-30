-- Phase 2E-1: customer-backed project schema foundation.
-- Scope intentionally limited to schema/indexes only (no UI/app logic changes).
--
-- TODO(security): public.customers.wifi_password is sensitive. Before broader production use,
-- enforce encryption at rest and/or restrict read/write access to admin-only paths.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_name text not null,
  full_address text,
  site_contact_name text,
  contact_number text,
  license_key_1 text,
  license_key_2 text,
  server_port_type text check (server_port_type is null or server_port_type in ('TLS', 'Proprietary')),
  server_port_number text,
  facility_code text,
  wifi_ssid text,
  wifi_password text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.customers.wifi_password is
  'TODO(security): Sensitive value. Encrypt and/or restrict access before broader production use.';

alter table if exists public.projects
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_customer_id_fkey'
  ) then
    alter table public.projects
      add constraint projects_customer_id_fkey
      foreign key (customer_id) references public.customers(id);
  end if;
end
$$;

create index if not exists idx_customers_company_customer_name
  on public.customers (company_id, customer_name);

create index if not exists idx_projects_company_customer
  on public.projects (company_id, customer_id);
