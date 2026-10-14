-- 💳 Website-Audit 14.10.2026, kritischer Punkt 2 (HANDOFF §343): Sofortbuchungen wurden VOR der Zahlung mit
-- status 'confirmed' gespeichert (app/api/bookings/route.ts) — unbezahlte Checkouts blockierten den Kalender
-- über den Overlap-Schutz, im eingeloggten Pfad sogar ohne Stripe-Session (also für immer).
--
-- Neu: Sofortbuchungen entstehen als 'pending_payment' und werden erst durch den Stripe-Webhook
-- (checkout.session.completed) bzw. die Erfolgsseite 'confirmed'. Verfallene Checkouts räumen
-- checkout.session.expired und der Cron /api/bookings/sweep (alle 15 Min, > 40 Min alt) auf → 'cancelled'.

-- 1) Overlap-Schutz: pending_payment reserviert den Zeitraum während des Checkouts (≤ 30 Min Stripe-Session),
--    damit nicht zwei Gäste parallel dieselben Nächte bezahlen können.
--    (DROP und ADD in EINEM Statement: auch bei Einzelausführung nie ein Zustand ohne Overlap-Schutz)
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_no_overlapping_confirmed,
  ADD CONSTRAINT bookings_no_overlapping_confirmed
  EXCLUDE USING gist (
    listing_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  )
  WHERE (status IN ('confirmed', 'pending_payment'));

-- 2) Direkte REST-Inserts in bookings: jeder eingeloggte Nutzer konnte mit dem Anon-Key + eigenem JWT eine
--    Buchung mit status 'confirmed' schreiben (Policy bookings_guest_insert) — alle Buchungen entstehen
--    serverseitig über supabaseAdmin, die Policy hat keinen Nutzer mehr.
DROP POLICY IF EXISTS "bookings_guest_insert" ON public.bookings;

-- 3) Index für den Aufräumer
CREATE INDEX IF NOT EXISTS bookings_pending_payment_idx
  ON public.bookings (created_at) WHERE status = 'pending_payment';

-- 4) Altlasten SICHTEN (nicht automatisch): Website-Sofortbuchungen, die 'confirmed' sind, aber nie bezahlt
--    wurden und nie in Smoobu landeten — das sind die Geisterbuchungen des alten Verhaltens.
--    Erst ansehen, dann bewusst stornieren (Portal-Importe sind absichtlich unbezahlt und NICHT betroffen):
--
--   SELECT b.id, l.title, b.check_in, b.check_out, b.created_at, b.payment_status, b.stripe_checkout_session_id, b.guest_email
--   FROM bookings b JOIN listings l ON l.id = b.listing_id
--   WHERE b.status = 'confirmed' AND b.source = 'trimosa' AND b.booking_type = 'instant'
--     AND b.payment_status IS DISTINCT FROM 'paid' AND b.smoobu_reservation_id IS NULL
--     AND b.created_at < now() - interval '1 hour'
--   ORDER BY b.check_in;
--
--   Zeilen mit payment_status 'pending' UND stripe_checkout_session_id vorher im Stripe-Dashboard prüfen: Session
--   bezahlt? → NICHT stornieren, sondern payment_status/status nachtragen. Danach:
--   UPDATE bookings SET status = 'cancelled'
--   WHERE id IN ('…', '…');   -- IDs aus der Sichtung
--   Offene Aufgaben „Überbuchung" zu diesen Zeiträumen in der Team-App anschließend von Hand schließen.
