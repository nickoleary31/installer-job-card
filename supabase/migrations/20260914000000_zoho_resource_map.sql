-- Zoho FSM resource-sync foundation: PERMANENT IDENTITY MAPPING ONLY. No auto-assignment yet.
--
-- Maps a stable Zoho Service Resource id (see $Service_Resources[].id on a Service Appointment,
-- already captured verbatim in zoho_fsm_service_appointments.raw_snapshot) to an Installer
-- Sheetz user. Never map by name, and never by any email field observed on a Service
-- Appointment (those are display/contact data, not identity, and can belong to an unrelated
-- person such as the SA's customer contact) — see lib/zoho-fsm/resource-map.ts.
--
-- Same "integration state, not business data" convention as the other zoho_fsm_* adapter tables
-- in 20260908000000_zoho_fsm_phase1_foundation.sql: RLS enabled, zero client policies, explicit
-- grant revocation — only server code using the service-role client (gated by
-- authorizeGlobalAdmin, see lib/company-users/admin-api.ts) can read or write this table.
create table if not exists public.zoho_resource_map (
  id uuid primary key default gen_random_uuid(),
  zoho_resource_id text not null,
  -- Informational only, never used as identity: the underlying Zoho "user" id from
  -- $Service_Resources[].parent_id, for admin/debugging context.
  zoho_user_id text,
  user_id uuid not null references auth.users(id) on delete cascade,
  mapped_by uuid references auth.users(id),
  mapped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zoho_resource_map_zoho_resource_id_unique unique (zoho_resource_id)
);

create index if not exists idx_zoho_resource_map_user
  on public.zoho_resource_map (user_id);

alter table public.zoho_resource_map enable row level security;
revoke all on public.zoho_resource_map from anon, authenticated;
