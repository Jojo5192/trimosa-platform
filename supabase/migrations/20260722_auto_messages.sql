-- 📨 Auto-Nachrichten-Engine (Gästemappe Phase 3, §145)
-- Vorlagen für automatische Gäste-Nachrichten + Versand-Protokoll (Doppel-
-- versand-Schutz). RLS deny-all → nur Service-Role greift zu.

create table if not exists public.auto_messages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default '',
  enabled       boolean not null default true,
  -- 'nach_buchung' | 'vor_anreise' | 'nach_anreise' | 'vor_abreise' | 'nach_abreise'
  trigger_type  text not null default 'vor_anreise',
  offset_days   int not null default 0,   -- Tage vor/nach dem Bezugspunkt
  send_hour     int not null default 10,  -- Uhrzeit (lokal) des Versands
  listing_id    uuid references public.listings(id) on delete cascade, -- null = alle Wohnungen
  channel_filter text[],                  -- null = alle Kanäle; sonst z. B. {airbnb,booking}
  min_nights    int,                      -- optional: erst ab X Nächten
  body          text not null default '', -- deutscher Quelltext mit Platzhaltern
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.auto_messages enable row level security;

-- Versand-Protokoll: verhindert doppelten Versand derselben Vorlage je Buchung
create table if not exists public.auto_message_log (
  id              uuid primary key default gen_random_uuid(),
  auto_message_id uuid not null references public.auto_messages(id) on delete cascade,
  booking_id      uuid not null references public.bookings(id) on delete cascade,
  sent_at         timestamptz not null default now(),
  channel         text,
  unique (auto_message_id, booking_id)
);
alter table public.auto_message_log enable row level security;
