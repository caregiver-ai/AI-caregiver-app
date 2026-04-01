alter table if exists public.users
  add column if not exists auth_user_id uuid;

create unique index if not exists idx_users_auth_user_id on public.users(auth_user_id)
where auth_user_id is not null;

alter table if exists public.sessions
  add column if not exists caregiver_first_name text,
  add column if not exists caregiver_last_name text,
  add column if not exists caregiver_is_55_or_older boolean,
  add column if not exists care_recipient_first_name text,
  add column if not exists care_recipient_last_name text,
  add column if not exists care_recipient_preferred_name text,
  add column if not exists care_recipient_date_of_birth date,
  add column if not exists draft_json jsonb,
  add column if not exists updated_at timestamptz not null default now();
