-- 🔑 Gästemappe Phase 2: automatische Türcodes (Nuki) — §132
-- bookings.door_code  = der für diese Buchung vergebene Keypad-Code
-- listings.locks      = zugeordnete Schlösser [{provider:'nuki'|'tedee', id, label}]

alter table public.bookings add column if not exists door_code text;
alter table public.listings add column if not exists locks jsonb not null default '[]'::jsonb;
