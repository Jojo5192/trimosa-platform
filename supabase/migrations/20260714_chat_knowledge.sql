-- Lernende Chat-Wissensbasis:
-- 1) smoobu_message_archive — Historien-Import aller Gast-Konversationen der
--    letzten Jahre aus Smoobu (Backfill über /dashboard/admin, Etappen-Läufe).
-- 2) chat_knowledge — von Claude destillierte FAQ-Wissensdokumente (je Wohnung
--    + eines global), Quelle für die ✨-Antwortvorschläge im Chat.
-- Beide Tabellen: RLS aktiv OHNE Policies = nur Service-Role (Server) liest/schreibt.

create table if not exists public.smoobu_message_archive (
  id uuid primary key default gen_random_uuid(),
  smoobu_reservation_id bigint not null,
  smoobu_message_id text not null unique,
  apartment_id bigint,
  listing_id uuid references public.listings(id) on delete set null,
  sender_type text not null check (sender_type in ('host', 'guest')),
  content text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_smsg_archive_listing on public.smoobu_message_archive (listing_id, sender_type);
alter table public.smoobu_message_archive enable row level security;

create table if not exists public.chat_knowledge (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('listing', 'global')),
  listing_id uuid references public.listings(id) on delete cascade,
  content text not null,
  source_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (scope, listing_id)
);
alter table public.chat_knowledge enable row level security;
