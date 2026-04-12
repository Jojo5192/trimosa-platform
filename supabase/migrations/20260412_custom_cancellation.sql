-- Custom cancellation policy fields on listings
-- Hosts can override the template defaults per listing.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS cancel_free_days      integer,   -- days before check-in for full refund
  ADD COLUMN IF NOT EXISTS cancel_free_percent    integer,   -- refund % during free period (0-100)
  ADD COLUMN IF NOT EXISTS cancel_partial_days    integer,   -- days before check-in for partial refund (nullable)
  ADD COLUMN IF NOT EXISTS cancel_partial_percent integer;   -- partial refund % (0-100, nullable)
