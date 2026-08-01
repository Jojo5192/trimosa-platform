-- 🧾 sevdesk-ENGINE (§235): Die täglichen Gast-Rechnungen laufen ab dem
-- Stichtag 02.08.2026 über sevdesk statt lexoffice (HANDOFF §235).
-- Vom Inhaber im Supabase-SQL-Editor ausführen.

-- Buchungen ohne Smoobu-Reservierung (Randfall, z. B. „auf Rechnung" vor
-- dem Smoobu-Push) dürfen jetzt auch eine Zeile bekommen
alter table public.sevdesk_invoices alter column smoobu_reservation_id drop not null;

-- Engine-Idempotenz je Buchung (mehrere NULLs kollidieren in Postgres nicht)
create unique index if not exists sevdesk_invoices_booking_idx
  on public.sevdesk_invoices (booking_id);

-- §159-Empfänger-Override aus dem Chat — Pendant zu lexoffice_invoices.recipient
alter table public.sevdesk_invoices add column if not exists recipient jsonb;
