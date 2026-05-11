create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  caregiver_name text,
  caregiver_first_name text,
  caregiver_last_name text,
  caregiver_age integer,
  caregiver_is_55_or_older boolean,
  caregiver_phone text,
  care_recipient_name text,
  care_recipient_first_name text,
  care_recipient_last_name text,
  care_recipient_preferred_name text,
  care_recipient_age integer,
  care_recipient_date_of_birth date,
  draft_json jsonb,
  consented boolean not null default false,
  status text not null default 'in_progress',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table if exists public.users add column if not exists auth_user_id uuid;
alter table if exists public.sessions add column if not exists caregiver_name text;
alter table if exists public.sessions add column if not exists caregiver_first_name text;
alter table if exists public.sessions add column if not exists caregiver_last_name text;
alter table if exists public.sessions add column if not exists caregiver_age integer;
alter table if exists public.sessions add column if not exists caregiver_is_55_or_older boolean;
alter table if exists public.sessions add column if not exists caregiver_phone text;
alter table if exists public.sessions add column if not exists care_recipient_name text;
alter table if exists public.sessions add column if not exists care_recipient_first_name text;
alter table if exists public.sessions add column if not exists care_recipient_last_name text;
alter table if exists public.sessions add column if not exists care_recipient_preferred_name text;
alter table if exists public.sessions add column if not exists care_recipient_age integer;
alter table if exists public.sessions add column if not exists care_recipient_date_of_birth date;
alter table if exists public.sessions add column if not exists draft_json jsonb;
alter table if exists public.sessions add column if not exists updated_at timestamptz not null default now();

create table if not exists public.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  role text not null check (role in ('assistant', 'user')),
  prompt_type text not null check (prompt_type in ('initial', 'follow_up', 'section_prompt', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id) on delete cascade,
  summary_json jsonb not null,
  summary_text text not null,
  edited_json jsonb,
  confirmed_at timestamptz
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  usefulness_rating text,
  comments text,
  created_at timestamptz not null default now()
);

create table if not exists public.summary_facts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  source_turns_hash text not null,
  fact_id text not null,
  entry_id text not null,
  section_title text not null,
  fact_kind text not null,
  statement text not null,
  safety_relevant boolean not null default false,
  concept_keys jsonb not null default '[]'::jsonb,
  source_entry_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.summary_section_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  source_turns_hash text not null,
  section_title text not null,
  items_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sessions_user_id on public.sessions(user_id);
create index if not exists idx_conversation_turns_session_id on public.conversation_turns(session_id);
create index if not exists idx_feedback_session_id on public.feedback(session_id);
create index if not exists idx_summary_facts_session_id on public.summary_facts(session_id);
create index if not exists idx_summary_section_summaries_session_id on public.summary_section_summaries(session_id);
create unique index if not exists idx_summary_facts_session_id_fact_id
on public.summary_facts(session_id, fact_id);
create unique index if not exists idx_summary_section_summaries_session_id_section_title
on public.summary_section_summaries(session_id, section_title);
create unique index if not exists idx_users_auth_user_id on public.users(auth_user_id)
where auth_user_id is not null;

-- All database access for this app goes through server-side routes.
-- Enabling RLS prevents public API access from anon/authenticated clients.
alter table if exists public.users enable row level security;
alter table if exists public.sessions enable row level security;
alter table if exists public.conversation_turns enable row level security;
alter table if exists public.summaries enable row level security;
alter table if exists public.feedback enable row level security;
alter table if exists public.summary_facts enable row level security;
alter table if exists public.summary_section_summaries enable row level security;
