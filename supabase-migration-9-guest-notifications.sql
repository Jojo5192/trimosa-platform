-- Migration 9: Guest notification preferences

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS guest_notif_booking_confirmed BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS guest_notif_booking_cancelled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS guest_notif_new_message      BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS guest_notif_payment          BOOLEAN DEFAULT TRUE;
