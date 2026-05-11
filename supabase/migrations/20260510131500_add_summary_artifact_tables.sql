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

create index if not exists idx_summary_facts_session_id
on public.summary_facts(session_id);

create index if not exists idx_summary_section_summaries_session_id
on public.summary_section_summaries(session_id);

create unique index if not exists idx_summary_facts_session_id_fact_id
on public.summary_facts(session_id, fact_id);

create unique index if not exists idx_summary_section_summaries_session_id_section_title
on public.summary_section_summaries(session_id, section_title);

alter table if exists public.summary_facts enable row level security;
alter table if exists public.summary_section_summaries enable row level security;
