-- Aufgaben Phase 4: Fotos, wiederkehrende Aufgaben, Kommentare.
-- 1) tasks.photos    — Array von {url, by, at} (Upload über die API in den
--    bestehenden listing-images-Bucket unter tasks/<taskId>/…)
-- 2) tasks.recur_days — Wiederholungs-Intervall in Tagen (null = einmalig).
--    Beim Erledigen wird automatisch die nächste Ausgabe der Aufgabe angelegt
--    (Rotfrist = Erledigungstag + Intervall); die alte bleibt als Historie.
-- 3) task_comments   — Kommentare je Aufgabe (Team + Zugewiesene).

alter table public.tasks
  add column if not exists photos jsonb not null default '[]';

alter table public.tasks
  add column if not exists recur_days integer;

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists task_comments_task_idx on public.task_comments (task_id);

-- Zugriff ausschliesslich ueber die API (Service-Role); RLS an ohne Policies = deny-all.
alter table public.task_comments enable row level security;
