-- Wochen-Digest: Jeden Mittwoch fasst die KI Kritik, Verbesserungsvorschläge
-- und Lob aus Gastnachrichten + Bewertungen zusammen und mailt sie ans Team.
-- Gespeicherte Ausgaben dienen als Gedächtnis für „früher schon angemerkt".
create table if not exists public.weekly_digests (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists weekly_digests_week_idx
  on public.weekly_digests (week_start desc);

-- RLS aktiv ohne Policies = deny-all für anon/authenticated; nur die
-- Service-Role (Cron/Route) liest und schreibt.
alter table public.weekly_digests enable row level security;
