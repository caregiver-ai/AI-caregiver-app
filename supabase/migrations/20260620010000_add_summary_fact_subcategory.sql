alter table if exists public.summary_facts
  add column if not exists subcategory text;
