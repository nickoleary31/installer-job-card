-- Zoho FSM integration: replace the "Installer Sheetz Site Code" custom-field identity model
-- with Zoho's own Work Order Service_Address.id. Additive only — does not edit the already-
-- applied 20260908000000_zoho_fsm_phase1_foundation.sql.
--
-- Final Phase 1 Site identity model:
--   Customer Account identity: Zoho Company.id                                (unchanged)
--   Site identity:            customer_account_id + Zoho Service_Address.id   (this migration)
-- customers.customer_name is DISPLAY metadata for a Zoho-backed Site, never identity.
--
-- Production has no live Zoho-linked data yet; the isolated Preview branch's existing
-- Site-Code-model test rows (AP-4..AP-9) are disposable and are reset/recreated separately —
-- no backfill/compat path for the old model is included here.

-- ---------------------------------------------------------------------------
-- New Site machine identity.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists zoho_service_address_id text;

-- A Zoho-backed Site's address identity always travels with a Customer Account — a row can
-- never carry zoho_service_address_id without customer_account_id.
alter table public.customers
  drop constraint if exists customers_service_address_requires_account;
alter table public.customers
  add constraint customers_service_address_requires_account
  check (zoho_service_address_id is null or customer_account_id is not null);

-- Scoped to (customer_account_id, zoho_service_address_id), not zoho_service_address_id alone:
-- a Zoho record id is not assumed globally unique, and this composite matches the existing
-- customer_accounts_company_zoho_company_unique convention (composite-scoped-to-parent).
create unique index if not exists customers_customer_account_service_address_unique
  on public.customers (customer_account_id, zoho_service_address_id)
  where customer_account_id is not null and zoho_service_address_id is not null;

-- ---------------------------------------------------------------------------
-- Remove the obsolete Installer Sheetz Site Code identity model entirely. No production data
-- depends on it and Preview's Site-Code-model test rows are being reset separately.
-- ---------------------------------------------------------------------------
drop index if exists public.customers_zoho_site_code_unique;
alter table public.customers drop column if exists zoho_site_code;

-- ---------------------------------------------------------------------------
-- customer_name uniqueness was OE-wide for every Site. Under the new model, two different
-- Customer Accounts under the same OE may legitimately have a Site with the identical display
-- name (identity is customer_account_id + zoho_service_address_id, never the name) — restrict
-- the duplicate-name guard to manual/non-Zoho Sites only, where it still protects real
-- human-entry UX (see app/companies/[companyId]/customers/_lib/customerForm.ts
-- isDuplicateCustomerNameError).
-- ---------------------------------------------------------------------------
drop index if exists public.idx_customers_company_normalized_customer_name;
create unique index if not exists idx_customers_company_normalized_customer_name_manual
  on public.customers (company_id, lower(trim(customer_name)))
  where zoho_service_address_id is null;

-- ---------------------------------------------------------------------------
-- Inbound diagnostics: replace the site-code-specific column with a Service Address identity
-- column so mismatch/audit logs remain self-describing under the new model. This column exists
-- only for this integration, so it is dropped outright (no production data depends on it).
-- ---------------------------------------------------------------------------
alter table public.zoho_fsm_inbound_events
  add column if not exists zoho_service_address_id_value text;
alter table public.zoho_fsm_inbound_events
  drop column if exists zoho_site_code_value;
