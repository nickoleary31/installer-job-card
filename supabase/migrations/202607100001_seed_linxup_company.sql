-- Seed LinxUp company for company-scoped install form.
-- Idempotent: safe to run multiple times.
-- Also adds optional contact_email on customers for project/site prefill.

alter table if exists public.customers
  add column if not exists contact_email text;

comment on column public.customers.contact_email is
  'Optional site/primary contact email used for LinxUp and future company forms.';

do $$
declare
  v_company_id uuid;
begin
  select id into v_company_id
  from public.companies
  where name = 'LinxUp'
  limit 1;

  if v_company_id is null then
    insert into public.companies (name)
    values ('LinxUp')
    returning id into v_company_id;
  end if;
end
$$;
