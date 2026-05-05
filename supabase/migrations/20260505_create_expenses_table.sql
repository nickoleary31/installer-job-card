create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null,

  amount numeric not null,
  category text not null,
  notes text,

  created_by uuid,
  created_at timestamptz default now(),

  receipt_url text,
  lost_receipt boolean default false,

  needs_review boolean default false,
  review_reason text,
  review_status text default 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz
);