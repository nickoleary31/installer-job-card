-- Seed a second company/project for testing.
-- Idempotent: safe to run multiple times.

do $$
declare
  v_company_id uuid;
begin
  select id into v_company_id
  from public.companies
  where name = 'Matrix'
  limit 1;

  if v_company_id is null then
    insert into public.companies (name)
    values ('Matrix')
    returning id into v_company_id;
  end if;

  if not exists (
    select 1
    from public.projects
    where company_id = v_company_id
      and project_name = 'Test Project'
  ) then
    insert into public.projects (
      company_id,
      project_name,
      customer_name,
      location,
      external_recipient_emails,
      active
    )
    values (
      v_company_id,
      'Test Project',
      'Matrix Test',
      'Atlanta, GA',
      '{}',
      true
    );
  end if;
end
$$;

