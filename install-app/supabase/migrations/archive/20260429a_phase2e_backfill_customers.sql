-- Phase 2E-2: backfill customers from existing projects and link projects.customer_id.
-- Scope intentionally limited to data migration only (no UI/app logic changes).

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

-- 1) Create missing customers from existing project rows (deduped by company + customer_name).
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

-- 2) Link projects.customer_id to the matching customer (keep legacy customer_name/location untouched).
update public.projects p
set customer_id = c.id
from public.customers c
where p.customer_id is null
  and p.company_id = c.company_id
  and nullif(trim(p.customer_name), '') is not null
  and lower(trim(p.customer_name)) = lower(trim(c.customer_name));
