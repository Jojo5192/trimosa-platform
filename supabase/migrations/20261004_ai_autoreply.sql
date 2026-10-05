-- 🤖 KI-Auto-Antworten (Phase 2, Pascal 26.9.2026)
-- Protokoll der Auto-Antwort-Entscheidungen (Schatten + aktiv), Kennzeichnung automatisch
-- gesendeter Nachrichten, Eingangszeit je Nachricht (messages.inserted_at) und Schalter-Zeile.
-- Idempotent (darf auch ein zweites Mal ausgeführt werden).
-- RLS aktiv OHNE Policies = nur Service-Role (das Protokoll enthält Gast-Texte).
-- Der Code ist deploy-sicher: ohne diese Migration bleibt das System still AUS — auch wenn in
-- app_settings bereits ein Modus gespeichert wäre (Probe-Select auf die Tabelle vor jedem Lauf).

create table if not exists public.ai_autoreply_log (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  booking_id        uuid not null references public.bookings(id) on delete cascade,
  listing_id        uuid references public.listings(id) on delete set null,
  -- die (letzte) Gast-Nachricht, auf die sich die Entscheidung bezieht
  guest_message_id  uuid not null references public.messages(id) on delete cascade,
  -- wirksamer Modus des Laufs ('aktiv' nur, wenn das Tor im Code erfüllt war)
  modus             text not null check (modus in ('schatten', 'aktiv')),
  kategorie         text,
  konfidenz         smallint check (konfidenz between 0 and 100),
  detail            jsonb,
  gast_text         text,          -- deutsche Fassung der Gast-Nachricht(en)
  gast_lang         text,
  entwurf           text,          -- deutscher KI-Entwurf
  gesendet_text     text,          -- tatsächlich gesendete Fassung (Gastsprache)
  -- laeuft = Claim (Prüfung läuft) · sendet = Sende-Claim · haette_gesendet = Schatten-Treffer
  -- vorrang = inhaltlich ok, aber Mensch hatte Vorrang · abgelehnt = nicht sendbar
  -- gesendet = wirklich gesendet · fehler = Abbruch/Technik (nie automatisch wiederholt)
  entscheidung      text not null default 'laeuft'
                    check (entscheidung in ('laeuft', 'sendet', 'haette_gesendet', 'vorrang', 'abgelehnt', 'gesendet', 'fehler')),
  grund             text,
  kanal             text,
  sent_message_id   uuid references public.messages(id) on delete set null,
  gesendet_at       timestamptz,
  -- Bewertung durch einen Menschen (Admin/Gastgeber) — Grundlage des Tors für »Aktiv«
  bewertung         text check (bewertung in ('richtig', 'falsch')),
  bewertet_von      uuid references auth.users(id) on delete set null,
  bewertet_name     text,
  bewertet_at       timestamptz
);

-- Doppelversand-Schutz: je Gast-Nachricht genau EINE Entscheidung (Claim-Insert vor Prüfung und Versand)
create unique index if not exists ai_autoreply_log_guest_msg_uidx
  on public.ai_autoreply_log (guest_message_id);
create index if not exists ai_autoreply_log_created_idx
  on public.ai_autoreply_log (created_at desc);
create index if not exists ai_autoreply_log_booking_idx
  on public.ai_autoreply_log (booking_id, created_at desc);
create index if not exists ai_autoreply_log_bewertet_idx
  on public.ai_autoreply_log (bewertet_at desc) where bewertung is not null;

alter table public.ai_autoreply_log enable row level security;

-- Kennzeichnung im Team-Thread: automatisch gesendete Host-Nachricht (Gäste bekommen das Feld nie)
alter table public.messages
  add column if not exists ai_auto boolean not null default false;

-- Eingangszeit in UNSERER Datenbank (created_at ist bei Smoobu-Nachrichten die Zeit im Portal).
-- Die KI-Auto-Antwort wartet, bis eine Gast-Nachricht dem Team mindestens 10 Minuten SICHTBAR war –
-- auch wenn der Abgleich sie verspätet nachholt. Bestehende Zeilen erhalten den Zeitpunkt dieser
-- Migration; neue Zeilen füllt die Datenbank selbst (kein Schreibpfad muss angepasst werden).
-- Ohne diese Spalte sendet das System nicht (Grund im Protokoll: „Eingangszeit nicht prüfbar").
alter table public.messages
  add column if not exists inserted_at timestamptz not null default now();

-- Schalter ausdrücklich AUS anlegen (eine fehlende Zeile gilt im Code ebenfalls als AUS)
insert into public.app_settings (key, value)
values ('ai_autoreply', '{"mode": "aus"}'::jsonb)
on conflict (key) do nothing;
