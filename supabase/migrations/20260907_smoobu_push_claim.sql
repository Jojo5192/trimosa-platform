-- §274 Doppel-Push-Schutz (7. September 2026)
-- Stripe-Webhook UND Erfolgsseite pushten bezahlte Website-Buchungen bisher
-- gleichzeitig zu Smoobu (Race → Echo-Fehlalarm „Überbuchung", schlimmstenfalls
-- doppelte Reservierung in Smoobu). Der Claim-Zeitstempel macht den Push
-- atomar: nur EIN Pfad bekommt die Zeile zurück und darf pushen.
-- Idempotent; Code ist deploy-sicher (ohne Spalte → altes Verhalten).
alter table public.bookings
  add column if not exists smoobu_push_claimed_at timestamptz;
