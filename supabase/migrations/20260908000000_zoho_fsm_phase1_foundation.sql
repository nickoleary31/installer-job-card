-- Zoho FSM integration, Phase 1: inbound foundation.
-- Adds the true Customer/dealer entity, extends the existing V1 `customers` table (which
-- continues to function as Site), and adds the isolated Zoho FSM adapter tables.
-- Scope intentionally limited to Phase 1 (inbound linking only) — no outbound/document-sync
-- columns, no asset/service-line-item columns. See project docs discussion for later phases.

-- ---------------------------------------------------------------------------
-- True Customer/dealer entity (e.g. "Shoppas"). Sits between companies (OE, e.g. Blaxtair)
-- and the existing `customers` table (which represents a Site, e.g. "GM - Voltova Roanoke").
-- This is a real business entity, not integration state, so it follows the same no-RLS,
-- app-enforced convention already used by companies/customers/projects.
-- ---------------------------------------------------------------------------
create table if not exists public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  zoho_company_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_accounts_company_zoho_company_unique unique (company_id, zoho_company_id)
);

create index if not exists idx_customer_accounts_company on public.customer_accounts (company_id);

-- ---------------------------------------------------------------------------
-- Extend the existing `customers` table (Site). All additions are nullable so existing
-- rows and every manually-created project/site continue functioning identically.
-- ---------------------------------------------------------------------------
alter table if exists public.customers
  add column if not exists customer_account_id uuid references public.customer_accounts(id),
  add column if not exists zoho_site_code text,
  add column if not exists end_customer_name text;

-- Installer Sheetz Site Code is the canonical Site identity for Zoho-linked sites.
-- Scoped to company_id (the OE) so a duplicate code can never be silently registered
-- anywhere under the same OE. Partial index: existing/manual sites (null code) are untouched.
create unique index if not exists customers_zoho_site_code_unique
  on public.customers (company_id, zoho_site_code)
  where zoho_site_code is not null;

-- ---------------------------------------------------------------------------
-- Zoho FSM adapter tables (integration state/config, not business data).
-- RLS enabled with zero client policies + explicit grant revocation: normal anon/authenticated
-- Supabase clients cannot read or write these tables under any circumstance. Only server code
-- using the service-role client can. This deliberately diverges from the rest of the app's
-- no-RLS convention, scoped narrowly to these tables, per explicit product decision.
-- ---------------------------------------------------------------------------

-- Explicit, data-driven mapping from the Zoho Work Order custom field value
-- ("Installer Sheetz Company", e.g. "Blaxtair") to an Installer Sheetz companies.id.
-- No company UUIDs are hardcoded in application code — this table is the only source of truth.
create table if not exists public.zoho_fsm_installer_company_map (
  id uuid primary key default gen_random_uuid(),
  zoho_value text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zoho_fsm_installer_company_map_zoho_value_unique unique (zoho_value)
);

alter table public.zoho_fsm_installer_company_map enable row level security;
revoke all on public.zoho_fsm_installer_company_map from anon, authenticated;

-- Canonical, mutable relationship: one row per successfully linked Zoho Service Appointment,
-- one Zoho SA = one Installer Sheetz project. zoho_service_appointment_id is the external
-- idempotency identity — repeated webhook delivery for the same SA must reuse this row rather
-- than creating a duplicate project/site/customer_account.
create table if not exists public.zoho_fsm_service_appointments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  zoho_work_order_id text not null,
  zoho_service_appointment_id text not null unique,
  zoho_work_order_number text,
  zoho_service_appointment_number text,
  zoho_company_id text not null,
  raw_snapshot jsonb not null default '{}'::jsonb,
  inbound_status text not null default 'created',
  inbound_last_event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_zoho_fsm_service_appointments_company
  on public.zoho_fsm_service_appointments (company_id);

alter table public.zoho_fsm_service_appointments enable row level security;
revoke all on public.zoho_fsm_service_appointments from anon, authenticated;

-- Webhook intake diagnostics/outcomes only — including events that never produce a project
-- (not opted in, missing/unknown company mapping, missing site code). Mutable sync state for
-- an already-created link lives solely in zoho_fsm_service_appointments; this table is never
-- updated after insert, only appended to.
create table if not exists public.zoho_fsm_inbound_events (
  id uuid primary key default gen_random_uuid(),
  zoho_work_order_id text,
  zoho_service_appointment_id text,
  installer_sheetz_company_value text,
  zoho_site_code_value text,
  outcome text not null,
  detail text,
  project_id uuid references public.projects(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_zoho_fsm_inbound_events_sa
  on public.zoho_fsm_inbound_events (zoho_service_appointment_id, created_at desc);

alter table public.zoho_fsm_inbound_events enable row level security;
revoke all on public.zoho_fsm_inbound_events from anon, authenticated;
