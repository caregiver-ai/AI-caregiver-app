create table if not exists public.care_record_workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_care_record_workspaces_user_id
  on public.care_record_workspaces(user_id);

create table if not exists public.care_record_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.care_record_workspaces(id) on delete cascade,
  category text not null,
  title text not null,
  fields_json jsonb not null default '[]'::jsonb,
  notes text,
  source_type text,
  source_label text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_care_record_items_workspace_id
  on public.care_record_items(workspace_id);

create index if not exists idx_care_record_items_category
  on public.care_record_items(workspace_id, category);

alter table if exists public.care_record_workspaces enable row level security;
alter table if exists public.care_record_items enable row level security;
