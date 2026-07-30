-- Phase 1 Form/Product Admin: database-backed company product configuration.
-- DO NOT apply until reviewed. Does not remove or alter registry fallbacks.
-- Authorization: RLS + is_global_admin(); mutations also gated in admin API (service role).

create or replace function public.is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.global_role = 'admin'
      and coalesce(up.is_active, true) = true
  );
$$;

revoke all on function public.is_global_admin() from public;
grant execute on function public.is_global_admin() to authenticated;

create table if not exists public.company_form_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Stable product identity (never rename after create). Used as section/selection key.
  product_key text not null,
  display_label text not null,
  -- Registry form id to reuse (ppd, speed_ssc, vac4, linxup_vehicle_tracker, …).
  base_form_id text not null,
  section_key text not null,
  submission_type text not null,
  draft_key text not null,
  allow_primary boolean not null default true,
  allow_additional boolean not null default true,
  active boolean not null default true,
  display_order integer not null default 100,
  -- Optional: { "allowedAdditionalProductKeys": ["…"], "maxAdditionalCount": 1 }
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_form_products_company_product_key unique (company_id, product_key),
  constraint company_form_products_product_key_format check (product_key ~ '^[a-z][a-z0-9_]*$'),
  constraint company_form_products_display_label_nonempty check (length(trim(display_label)) > 0),
  constraint company_form_products_base_form_id_nonempty check (length(trim(base_form_id)) > 0),
  constraint company_form_products_section_key_nonempty check (length(trim(section_key)) > 0)
);

create index if not exists idx_company_form_products_company_active_order
  on public.company_form_products (company_id, active, display_order);

create index if not exists idx_company_form_products_base_form
  on public.company_form_products (base_form_id);

create or replace function public.set_company_form_products_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_company_form_products_updated_at on public.company_form_products;
create trigger trg_company_form_products_updated_at
  before update on public.company_form_products
  for each row
  execute function public.set_company_form_products_updated_at();

alter table public.company_form_products enable row level security;

-- Technicians/members: read products for companies they belong to.
-- Global admins: read all.
drop policy if exists company_form_products_select on public.company_form_products;
create policy company_form_products_select
  on public.company_form_products
  for select
  to authenticated
  using (
    public.is_global_admin()
    or exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = company_form_products.company_id
        and cm.user_id = auth.uid()
        and cm.is_active = true
    )
  );

-- Writes: global admin only (admin UI also uses service-role API).
drop policy if exists company_form_products_insert on public.company_form_products;
create policy company_form_products_insert
  on public.company_form_products
  for insert
  to authenticated
  with check (public.is_global_admin());

drop policy if exists company_form_products_update on public.company_form_products;
create policy company_form_products_update
  on public.company_form_products
  for update
  to authenticated
  using (public.is_global_admin())
  with check (public.is_global_admin());

drop policy if exists company_form_products_delete on public.company_form_products;
create policy company_form_products_delete
  on public.company_form_products
  for delete
  to authenticated
  using (public.is_global_admin());

comment on table public.company_form_products is
  'Phase 1 admin-managed company products. When rows exist for a company, they override registry assignments; otherwise registry fallback applies.';

comment on column public.company_form_products.product_key is
  'Stable identity; immutable after create. Used as hardwareSelection / selectedSections value.';

comment on column public.company_form_products.base_form_id is
  'References a hardcoded registry form implementation id (not duplicated UI).';
