-- Migration 10: Guest address fields, host_name in conversations, payment columns

-- Structured guest address (for booking/invoice purposes)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS guest_first_name TEXT,
  ADD COLUMN IF NOT EXISTS guest_last_name  TEXT,
  ADD COLUMN IF NOT EXISTS guest_street     TEXT,
  ADD COLUMN IF NOT EXISTS guest_city       TEXT,
  ADD COLUMN IF NOT EXISTS guest_zip        TEXT,
  ADD COLUMN IF NOT EXISTS guest_country    TEXT DEFAULT 'Deutschland';

-- Host name in conversations (so guests know who they're talking to)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS host_name TEXT;

-- Payment tracking on bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id   TEXT,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_status             TEXT DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS paid_at                    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_refund_id           TEXT;

-- Status flow: unpaid → paid → (refunded on cancellation)
-- booking status: payment_pending → confirmed (instant) | pending (request) → confirmed | cancelled
