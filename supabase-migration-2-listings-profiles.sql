-- ══════════════════════════════════════════════════════════════
-- TRIMOSA Migration 2 — Listing Editor + Host Profiles
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Neue Spalten für Listings
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS bathrooms     SMALLINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS amenities     TEXT[]   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS address       TEXT     DEFAULT '',
  ADD COLUMN IF NOT EXISTS latitude      NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude     NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS house_rules   TEXT     DEFAULT '',
  ADD COLUMN IF NOT EXISTS check_in_time TEXT     DEFAULT '15:00',
  ADD COLUMN IF NOT EXISTS check_out_time TEXT    DEFAULT '11:00',
  ADD COLUMN IF NOT EXISTS min_stay      SMALLINT DEFAULT 1;

-- images ist schon TEXT[], sicherstellen:
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}';

-- 2. Host-Profile Tabelle
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT    NOT NULL DEFAULT '',
  bio           TEXT    NOT NULL DEFAULT '',
  avatar_url    TEXT,
  languages     TEXT[]  DEFAULT '{}',
  location      TEXT    DEFAULT '',
  response_time TEXT    DEFAULT '',
  member_since  DATE    DEFAULT CURRENT_DATE,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger: updated_at automatisch setzen
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS für profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_public_read"  ON profiles;
DROP POLICY IF EXISTS "profiles_own_write"    ON profiles;

CREATE POLICY "profiles_public_read"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "profiles_own_write"
  ON profiles FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 3. Supabase Storage Bucket für Listing-Fotos
-- (Muss manuell in Supabase → Storage → New Bucket angelegt werden)
-- Bucket-Name: listing-images
-- Public: ja
-- File size limit: 10 MB
-- Allowed MIME types: image/jpeg, image/png, image/webp
