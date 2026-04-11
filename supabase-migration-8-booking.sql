-- Migration 8: Booking types, request settings

-- Booking type + request fields
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'request', -- 'instant' | 'request'
  ADD COLUMN IF NOT EXISTS guest_price_suggestion NUMERIC,
  ADD COLUMN IF NOT EXISTS guest_note TEXT;

-- Host settings for requests
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS allow_instant_booking BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_requests        BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS min_request_nights    INT DEFAULT 1;
