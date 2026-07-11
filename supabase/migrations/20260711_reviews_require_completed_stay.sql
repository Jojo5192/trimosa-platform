-- ══════════════════════════════════════════════════════════════
-- Restricts guest-authored ('trimosa'-source) review inserts to a
-- reference of the reviewer's own completed, confirmed booking for that
-- exact listing. Also caps it to one review per booking.
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS reviews_insert_guest ON reviews;

CREATE POLICY reviews_insert_guest ON reviews FOR INSERT
  WITH CHECK (
    source = 'trimosa'
    AND guest_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_id
        AND b.guest_id = auth.uid()
        AND b.listing_id = listing_id
        AND b.status = 'confirmed'
        AND b.check_out < CURRENT_DATE
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_booking_idx
  ON reviews (booking_id)
  WHERE source = 'trimosa';
