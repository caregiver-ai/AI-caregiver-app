alter table if exists public.conversation_turns
  add column if not exists source_language text,
  add column if not exists source_content text,
  add column if not exists translated_at timestamptz;
