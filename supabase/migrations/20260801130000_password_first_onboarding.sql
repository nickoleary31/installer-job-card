-- Password-first invite onboarding fields on user_profiles.
-- Additive only. Existing profiles are marked complete so they are not locked out.

alter table public.user_profiles
  add column if not exists phone text,
  add column if not exists job_title text,
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.user_profiles.phone is 'Contact phone collected during invite onboarding.';
comment on column public.user_profiles.job_title is 'Optional job title collected during or after onboarding.';
comment on column public.user_profiles.onboarding_completed_at is
  'Set when invite onboarding finishes. Null means authenticated users must complete /auth/accept-invite.';

-- Backfill: anyone who already has a profile is treated as onboarded.
update public.user_profiles
set onboarding_completed_at = coalesce(onboarding_completed_at, updated_at, created_at, now())
where onboarding_completed_at is null;

create index if not exists idx_user_profiles_onboarding_completed_at
  on public.user_profiles (onboarding_completed_at);
