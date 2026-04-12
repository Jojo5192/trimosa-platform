-- Fix: Drop existing policies before re-creating them
DROP POLICY IF EXISTS reviews_select ON reviews;
DROP POLICY IF EXISTS reviews_insert_host ON reviews;
DROP POLICY IF EXISTS reviews_insert_guest ON reviews;
DROP POLICY IF EXISTS reviews_update_host ON reviews;
DROP POLICY IF EXISTS reviews_delete_host ON reviews;

-- Re-enable RLS (idempotent)
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- 1. Everyone can read reviews
CREATE POLICY reviews_select ON reviews FOR SELECT USING (true);

-- 2. Hosts can insert reviews for their own listings (imports)
CREATE POLICY reviews_insert_host ON reviews FOR INSERT
  WITH CHECK (
    listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid())
  );

-- 3. Guests can insert their own reviews
CREATE POLICY reviews_insert_guest ON reviews FOR INSERT
  WITH CHECK (
    source = 'trimosa'
    AND guest_id = auth.uid()
  );

-- 4. Hosts can update reviews they imported
CREATE POLICY reviews_update_host ON reviews FOR UPDATE
  USING (
    listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid())
    AND source != 'trimosa'
  );

-- 5. Hosts can delete imported reviews (not guest reviews)
CREATE POLICY reviews_delete_host ON reviews FOR DELETE
  USING (
    listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid())
    AND source != 'trimosa'
  );

-- 6. Add platform URL fields to listings (IF NOT EXISTS = safe to re-run)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS airbnb_url TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS booking_url TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS vrbo_url TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS google_place_id TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS google_api_key TEXT;
