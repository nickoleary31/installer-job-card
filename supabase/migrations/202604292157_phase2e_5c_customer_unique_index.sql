-- Phase 2E-5C: prevent duplicate customers per company by normalized customer name.
-- Scope limited to uniqueness enforcement only; no data backfill or app changes.

create unique index if not exists idx_customers_company_normalized_customer_name
  on public.customers (company_id, lower(trim(customer_name)));
