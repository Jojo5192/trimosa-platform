-- Review-sync support: vrbo score columns (airbnb/booking/google already exist)
-- and a sync timestamp so the daily cron can rotate through listings.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS vrbo_score numeric;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS vrbo_review_count integer;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS reviews_synced_at timestamptz;
