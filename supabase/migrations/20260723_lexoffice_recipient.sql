-- 🧾 §159: Rechnungsempfänger-Override je Buchung — vom Gast mitgeteilte
-- Rechnungsdaten (Chat/bei Buchung) werden hier gespeichert und haben beim
-- Erstellen/Neu-Ausstellen Vorrang vor den Profildaten.
alter table public.lexoffice_invoices
  add column if not exists recipient jsonb;
