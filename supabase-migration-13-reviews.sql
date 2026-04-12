-- Migration 13: Reviews system
-- Adds reviews table + platform URL fields on listings

-- 1. Reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'trimosa',  -- 'trimosa', 'airbnb', 'booking', 'google', 'vrbo'
  source_review_id TEXT,                    -- external ID to prevent duplicates
  author_name TEXT NOT NULL,
  author_avatar TEXT,                       -- URL to avatar image
  rating NUMERIC(2,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  language TEXT DEFAULT 'de',
  review_date DATE NOT NULL,
  verified BOOLEAN DEFAULT false,           -- true if verified TRIMOSA stay
  booking_id UUID,                          -- links to booking for TRIMOSA reviews
  guest_id UUID,                            -- user id for TRIMOSA reviews
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(listing_id, source, source_review_id)  -- prevent duplicate external reviews
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_reviews_listing ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_source ON reviews(listing_id, source);
CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(listing_id, review_date DESC);

-- RLS policies
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Anyone can read reviews
CREATE POLICY reviews_select ON reviews FOR SELECT USING (true);

-- Hosts can insert reviews for their own listings (manual import)
CREATE POLICY reviews_insert_host ON reviews FOR INSERT
  WITH CHECK (
    listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid())
    OR guest_id = auth.uid()
  );

-- Hosts can update reviews they imported
CREATE POLICY reviews_update_host ON reviews FOR UPDATE
  USING (
    listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid())
    AND source != 'trimosa'
  );

-- Hosts can delete imported reviews (not guest reviews)
CREATE POLICY reviews_delete_host ON reviews FOR DELETE
  USING (
    listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid())
    AND source != 'trimosa'
  );

-- 2. Add platform URL fields to listings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS airbnb_url TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS booking_url TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS vrbo_url TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS google_place_id TEXT;
