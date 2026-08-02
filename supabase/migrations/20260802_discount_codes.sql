-- 🏷 GUTSCHEINCODES (§243af): Rabattcode-Feld im Buchungsflow (Montes-
-- Unwind-Fund §240 — das alte Smoobu-Widget hatte ein Code-Feld, das neue
-- Buchungstool nicht). Die aktiven Codes verwaltet der Admin-Bereich
-- (app_settings 'discount_codes' — kein eigenes Tabellen-Schema nötig);
-- auf der Buchung wird der angewendete Code dokumentiert.
-- Vom Inhaber im Supabase-SQL-Editor ausführen.

alter table public.bookings
  add column if not exists discount_code text,
  add column if not exists discount_pct numeric(5,2);
