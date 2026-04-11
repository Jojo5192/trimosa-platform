-- ══════════════════════════════════════════════════════════════
-- Migration 5: Platform Settings
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_settings (
  id                   INT PRIMARY KEY DEFAULT 1,  -- single row
  platform_markup_pct  NUMERIC(5,2)  NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert the default row if not exists
INSERT INTO platform_settings (id, platform_markup_pct)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- RLS: public read (needed for availability API), only authenticated hosts can update
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_public_read"  ON platform_settings;
DROP POLICY IF EXISTS "settings_host_update"  ON platform_settings;

CREATE POLICY "settings_public_read"
  ON platform_settings FOR SELECT
  USING (true);

CREATE POLICY "settings_host_update"
  ON platform_settings FOR UPDATE
  USING (auth.role() = 'authenticated');
