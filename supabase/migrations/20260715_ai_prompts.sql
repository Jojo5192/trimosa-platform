-- Prompt-Studio (Etappe 4): KI-Anweisungen aus dem Code in die DB —
-- im Admin einsehbar/editierbar/per KI anpassbar. Fehlt eine Zeile,
-- gilt der Code-Default. RLS ohne Policies = nur Service-Role.
create table if not exists public.ai_prompts (
  key text primary key,
  content text not null,
  updated_at timestamptz not null default now()
);
alter table public.ai_prompts enable row level security;
