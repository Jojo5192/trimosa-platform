-- §255: Reinigungs-Dauer — Start (erste Türöffnung ohne Gast-Codes am
-- Meldungstag, aus dem Schloss-Protokoll) + Dauer bis zur NFC-Fertigmeldung.
alter table cleaning_confirmations add column if not exists started_at timestamptz;
alter table cleaning_confirmations add column if not exists duration_min int;
