-- ══════════════════════════════════════════════════════════════
-- Adds a database-level guard against overlapping confirmed bookings for
-- the same listing, as a safety net independent of the application-level
-- availability check (which only runs once, before the insert).
--
-- ⚠️ Before running, check whether overlapping confirmed bookings already
-- exist (the ALTER TABLE fails otherwise):
--
--   SELECT b1.id, b2.id, b1.listing_id, b1.check_in, b1.check_out,
--          b2.check_in, b2.check_out
--   FROM bookings b1 JOIN bookings b2
--     ON b1.listing_id = b2.listing_id AND b1.id < b2.id
--   WHERE b1.status = 'confirmed' AND b2.status = 'confirmed'
--     AND daterange(b1.check_in, b1.check_out, '[)') && daterange(b2.check_in, b2.check_out, '[)');
--
-- Resolve any conflicts manually (cancel/move one side) before running
-- this migration.
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlapping_confirmed
  EXCLUDE USING gist (
    listing_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  )
  WHERE (status = 'confirmed');

-- Only 'confirmed' bookings are protected: 'pending' requests are allowed
-- to overlap (the host picks one, declineBooking refunds the rest). The
-- guard only kicks in on confirmation; a second concurrent accept/insert
-- for the same dates then fails with Postgres error code 23P01 (handled
-- in app/api/bookings/route.ts and app/dashboard/actions.ts).
