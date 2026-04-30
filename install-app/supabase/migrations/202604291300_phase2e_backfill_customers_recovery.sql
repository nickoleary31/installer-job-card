-- Phase 2E-2 recovery: backfill customers from projects and link projects.customer_id.
-- This migration is intentionally idempotent and safe to re-run.
-- Scope limited to data backfill/linking only (no UI/app logic changes).

do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'customers'
  ) then
    raise exception 'public.customers does not exist. Run Phase 2E-1 migration first.';
  end if;
end
$$;

-- 1) Backfill missing customers from existing project rows.
-- Deduplicate by (company_id + customer_name) using case-insensitive trimmed comparison.
with source_projects as (
  select
    p.company_id,
    trim(p.customer_name) as customer_name,
    max(nullif(trim(p.location), '')) as full_address
  from public.projects p
  where nullif(trim(p.customer_name), '') is not null
  group by p.company_id, trim(p.customer_name)
)
insert into public.customers (
  company_id,
  customer_name,
  full_address,
  created_at,
  updated_at
)
select
  s.company_id,
  s.customer_name,
  s.full_address,
  now(),
  now()
from source_projects s
where not exists (
  select 1
  from public.customers c
  where c.company_id = s.company_id
    and lower(trim(c.customer_name)) = lower(s.customer_name)
);

-- 2) Populate projects.customer_id from matching customer rows.
-- Keep legacy projects.customer_name and projects.location unchanged.
update public.projects p
set customer_id = c.id
from public.customers c
where p.customer_id is null
  and p.company_id = c.company_id
  and nullif(trim(p.customer_name), '') is not null
  and lower(trim(p.customer_name)) = lower(trim(c.customer_name));
