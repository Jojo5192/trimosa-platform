-- §265: Push-Historie — jede versendete Push-Mitteilung wird je Empfänger
-- protokolliert, damit die Team-App einen anklickbaren zeitlichen Verlauf
-- zeigen kann („verpasste Pushes nachschlagen"). Aufbewahrung: der tägliche
-- 3:40-Cron löscht Einträge älter als 30 Tage.
create table if not exists public.push_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  url text,
  category text
);

create index if not exists push_log_user_created_idx
  on public.push_log (user_id, created_at desc);

-- RLS ohne Policies = deny-all; nur die Service-Role (API-Routen) liest/schreibt.
alter table public.push_log enable row level security;
