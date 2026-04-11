-- ══════════════════════════════════════════════════════════════
-- TRIMOSA Smoobu Integration — Supabase Migration
-- Run this in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Add smoobu_id to listings (if not already there)
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS smoobu_id TEXT;

-- 2. Add Smoobu + guest fields to bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS smoobu_reservation_id BIGINT,
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'trimosa',
  ADD COLUMN IF NOT EXISTS adults SMALLINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS children SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_name TEXT,
  ADD COLUMN IF NOT EXISTS guest_email TEXT;

-- Unique index so webhook upserts work
CREATE UNIQUE INDEX IF NOT EXISTS bookings_smoobu_reservation_id_idx
  ON bookings (smoobu_reservation_id)
  WHERE smoobu_reservation_id IS NOT NULL;

-- 3. Messages table for guest ↔ host chat
CREATE TABLE IF NOT EXISTS messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_type         TEXT NOT NULL CHECK (sender_type IN ('guest','host','system')),
  sender_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content             TEXT NOT NULL,
  smoobu_message_id   TEXT UNIQUE,
  read_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_booking_id_idx ON messages (booking_id);

-- ── Row Level Security ──────────────────────────────────────

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Drop policies first (so re-running the script is safe)
DROP POLICY IF EXISTS "guests_see_own_booking_messages"         ON messages;
DROP POLICY IF EXISTS "hosts_see_listing_booking_messages"      ON messages;
DROP POLICY IF EXISTS "guests_insert_own_booking_messages"      ON messages;
DROP POLICY IF EXISTS "hosts_insert_listing_booking_messages"   ON messages;

-- Guests can see messages for their own bookings
CREATE POLICY "guests_see_own_booking_messages"
  ON messages FOR SELECT
  USING (
    booking_id IN (
      SELECT id FROM bookings WHERE guest_id = auth.uid()
    )
  );

-- Hosts can see messages for their listings' bookings
CREATE POLICY "hosts_see_listing_booking_messages"
  ON messages FOR SELECT
  USING (
    booking_id IN (
      SELECT b.id FROM bookings b
      JOIN listings l ON l.id = b.listing_id
      WHERE l.host_id = auth.uid()
    )
  );

-- Guests can insert messages for their own bookings
CREATE POLICY "guests_insert_own_booking_messages"
  ON messages FOR INSERT
  WITH CHECK (
    booking_id IN (
      SELECT id FROM bookings WHERE guest_id = auth.uid()
    )
    AND sender_type = 'guest'
  );

-- Hosts can insert messages for their listings' bookings
CREATE POLICY "hosts_insert_listing_booking_messages"
  ON messages FOR INSERT
  WITH CHECK (
    booking_id IN (
      SELECT b.id FROM bookings b
      JOIN listings l ON l.id = b.listing_id
      WHERE l.host_id = auth.uid()
    )
    AND sender_type = 'host'
  );

-- ══════════════════════════════════════════════════════════════
-- Multi-Host Smoobu Support
-- Run this in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- Each host stores their own Smoobu credentials
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS smoobu_api_key    TEXT,
  ADD COLUMN IF NOT EXISTS smoobu_channel_id BIGINT;
-- Note: smoobu_api_key is sensitive — ensure RLS only lets the owner read their own row
