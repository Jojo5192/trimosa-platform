-- §171: Score-ENTWICKLUNG — täglicher Snapshot der Bewertungs-Scores je
-- Wohnung und Plattform (Quelle: die autoritativen listings-Spalten).
-- Grundlage für den 📈-Entwicklungs-Bereich in der Team-App und die
-- Trend-Zeile im Wochenbericht. RLS ohne Policies = nur Service-Role.
create table if not exists public.score_history (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  source text not null, -- overall | airbnb | booking | google | vrbo
  score numeric(4,2) not null,
  review_count integer not null default 0,
  captured_on date not null default current_date,
  unique (listing_id, source, captured_on)
);

alter table public.score_history enable row level security;

create index if not exists score_history_listing_idx
  on public.score_history (listing_id, source, captured_on desc);
