-- Persönliche Gastgeber-Empfehlungen für Reiseführer-Inhalte (POIs,
-- Kulinarik-Adressen, Komoot-Touren). Gepflegt über /dashboard/empfehlungen
-- (nur Admins = Johannes/Pascal/Dominik), öffentlich angezeigt auf den
-- Regions-/Erlebnis-Seiten als Sprechblase mit Gesicht.
--
-- item_key referenziert die statischen Einträge in lib/regions.ts:
--   poi       → Poi.slug
--   kulinarik → KulinarikTipp.name
--   tour      → KomootTour.embedUrl

create table if not exists public.empfehlungen (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('poi', 'kulinarik', 'tour')),
  item_key text not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  comment text not null check (char_length(comment) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_type, item_key, author_id)
);

alter table public.empfehlungen enable row level security;

-- Öffentlich lesbar (die Website zeigt die Empfehlungen jedem Besucher)
drop policy if exists empfehlungen_public_read on public.empfehlungen;
create policy empfehlungen_public_read on public.empfehlungen
  for select using (true);

-- Schreiben nur Admins, und nur als sie selbst
drop policy if exists empfehlungen_admin_write on public.empfehlungen;
create policy empfehlungen_admin_write on public.empfehlungen
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    and author_id = auth.uid()
  );
