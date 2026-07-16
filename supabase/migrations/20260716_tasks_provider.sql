-- Aufgaben-Tool + Dienstleister-Rolle (Team-App Phase 1)
-- 1) profiles.is_provider — Dienstleister (Handwerker/Reinigung/Verwaltung):
--    sehen in /team NUR Aufgaben (eigene) + Kalender, keinen Chat.
-- 2) tasks — Aufgaben mit Zuordnung (Wohnung ODER Standort ODER allgemein),
--    Priorität, Rotfrist (due_date), Zuweisung, Status.
--    KI-Vorschläge (Phase 3) landen als status='vorschlag'.

alter table public.profiles
  add column if not exists is_provider boolean not null default false;

-- Selbst-Beförderungs-Schutz: deckt jetzt alle vier Rollen-Flags ab.
-- (Service-Role hat auth.uid() = null und darf ändern.)
create or replace function public.prevent_self_admin_promotion()
returns trigger as $$
begin
  if auth.uid() is not null and (
       new.is_admin    is distinct from old.is_admin
    or new.is_host     is distinct from old.is_host
    or new.is_staff    is distinct from old.is_staff
    or new.is_provider is distinct from old.is_provider
  ) then
    raise exception 'Rollen-Flags koennen nur durch den Service geaendert werden';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_prevent_self_admin_promotion on public.profiles;
create trigger trg_prevent_self_admin_promotion
  before update on public.profiles
  for each row execute function public.prevent_self_admin_promotion();

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  source text not null default 'manuell',            -- manuell | ki_nachricht | ki_bewertung
  source_ref text,                                    -- z. B. message-/review-id des KI-Fundes
  listing_id uuid references public.listings(id) on delete set null,
  location_group text,                                -- Standort (z. B. 'Sirzenich')
  is_general boolean not null default false,          -- allgemeine Aufgabe (firmen-/standortweit)
  prio text not null default 'mittel',                -- hoch | mittel | niedrig
  status text not null default 'offen',               -- vorschlag | offen | in_arbeit | erledigt | verworfen
  assignee_id uuid references public.profiles(id) on delete set null,
  due_date date,                                      -- „Rotfrist": ueberfaellig => rot + nach oben
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint tasks_scope_check check (is_general or listing_id is not null or location_group is not null)
);

create index if not exists tasks_status_idx on public.tasks (status);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists tasks_listing_idx on public.tasks (listing_id);

-- Zugriff ausschliesslich ueber die API (Service-Role); RLS an ohne Policies = deny-all.
alter table public.tasks enable row level security;
